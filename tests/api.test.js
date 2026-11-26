const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createDatabase } = require('../src/db/connection');
const { seedDatabase } = require('../src/db/seed');
const { createApp } = require('../src/app');

async function startFixture() {
  const db = createDatabase(':memory:');
  seedDatabase(db);

  // Um técnico da Unidade Rialma é criado para conferir o bloqueio de atribuição fora da unidade.
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, is_external, created_at)
    VALUES (?, ?, ?, ?, 'TECNICO', 0, ?)
  `).run('user-tecnico-unidade-2', 'Técnico Rialma', 'tecnico.rialma@demo.local', 'salt:hash', new Date().toISOString());
  db.prepare('INSERT INTO user_units (user_id, unit_id) VALUES (?, 2)').run('user-tecnico-unidade-2');

  const server = http.createServer(createApp({ db }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function request(method, route, { token, body, expectedStatus } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json();
    if (expectedStatus !== undefined) {
      assert.equal(response.status, expectedStatus, `${method} ${route}: ${JSON.stringify(payload)}`);
    }
    return { status: response.status, body: payload };
  }

  return {
    db,
    server,
    baseUrl,
    request,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      db.close();
    }
  };
}

test('API de ocorrências — cobertura das regras RN1 a RN10', async (t) => {
  const fixture = await startFixture();
  const { request, db } = fixture;

  try {
    const login = async (email) => {
      const result = await request('POST', '/api/v1/auth/login', {
        body: { email, password: 'Demo@123' },
        expectedStatus: 200
      });
      return result.body.token;
    };

    const requesterToken = await login('solicitante@demo.local');
    const supervisorToken = await login('supervisor@demo.local');
    const technicianToken = await login('tecnico@demo.local');
    const externalToken = await login('terceirizado@demo.local');
    const responsibleToken = await login('responsavel@demo.local');

    await t.test('Autenticação e escopo básico', async () => {
      await request('GET', '/api/v1/auth/me', { token: requesterToken, expectedStatus: 200 });
      const noToken = await request('GET', '/api/v1/ocorrencias');
      assert.equal(noToken.status, 401);
      const externalUnits = await request('GET', '/api/v1/unidades', { token: externalToken, expectedStatus: 200 });
      assert.deepEqual(externalUnits.body.data.map((unit) => unit.id), [1]);
    });

    let occurrenceId;
    let duplicateId;
    let foreignUnitOccurrenceId;

    await t.test('RN1 / CT01 — cadastro e validação de campos obrigatórios', async () => {
      const invalid = await request('POST', '/api/v1/ocorrencias', {
        token: requesterToken,
        body: { unitId: 1, description: 'Falta de energia', occurredAt: new Date().toISOString() }
      });
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');

      const created = await request('POST', '/api/v1/ocorrencias', {
        token: requesterToken,
        expectedStatus: 201,
        body: {
          unitId: 1,
          description: 'Queda de energia no bloco administrativo.',
          location: 'Prédio Administrativo',
          occurredAt: new Date().toISOString(),
          category: 'ELÉTRICA'
        }
      });
      occurrenceId = created.body.data.id;
      assert.equal(created.body.data.status, 'ABERTA');
      assert.equal(created.body.data.prioridade, null);
    });

    await t.test('RN2 / CT02 — relaciona duplicidade e rejeita local diferente', async () => {
      const duplicate = await request('POST', '/api/v1/ocorrencias', {
        token: requesterToken,
        expectedStatus: 201,
        body: {
          unitId: 1,
          description: 'Outro relato de queda de energia.',
          location: 'Prédio Administrativo',
          occurredAt: new Date().toISOString(),
          category: 'ELÉTRICA'
        }
      });
      duplicateId = duplicate.body.data.id;
      await request('POST', `/api/v1/ocorrencias/${occurrenceId}/relacionadas`, {
        token: requesterToken,
        body: { relatedOccurrenceId: duplicateId, confirmedSameProblem: true }
      }).then((result) => assert.equal(result.status, 403));
      await request('POST', `/api/v1/ocorrencias/${occurrenceId}/relacionadas`, {
        token: supervisorToken,
        body: { relatedOccurrenceId: duplicateId, confirmedSameProblem: true },
        expectedStatus: 201
      });
      const sameRelationAgain = await request('POST', `/api/v1/ocorrencias/${occurrenceId}/relacionadas`, {
        token: supervisorToken,
        body: { relatedOccurrenceId: duplicateId, confirmedSameProblem: true }
      });
      assert.equal(sameRelationAgain.status, 409);

      const foreignUnit = await request('POST', '/api/v1/ocorrencias', {
        token: supervisorToken,
        expectedStatus: 201,
        body: {
          unitId: 2,
          description: 'Queda de energia no prédio administrativo.',
          location: 'Prédio Administrativo',
          occurredAt: new Date().toISOString(),
          category: 'ELÉTRICA'
        }
      });
      foreignUnitOccurrenceId = foreignUnit.body.data.id;
      const anotherPlace = await request('POST', '/api/v1/ocorrencias', {
        token: requesterToken,
        expectedStatus: 201,
        body: {
          unitId: 1,
          description: 'Queda de energia no galpão.',
          location: 'Galpão de estoque',
          occurredAt: new Date().toISOString(),
          category: 'ELÉTRICA'
        }
      });
      const mismatch = await request('POST', `/api/v1/ocorrencias/${occurrenceId}/relacionadas`, {
        token: supervisorToken,
        body: { relatedOccurrenceId: anotherPlace.body.data.id, confirmedSameProblem: true }
      });
      assert.equal(mismatch.status, 409);
    });

    await t.test('RN3 / CT03 — somente supervisor altera prioridade', async () => {
      const denied = await request('PATCH', `/api/v1/ocorrencias/${occurrenceId}/prioridade`, {
        token: requesterToken,
        body: { priority: 'ALTA' }
      });
      assert.equal(denied.status, 403);
      const updated = await request('PATCH', `/api/v1/ocorrencias/${occurrenceId}/prioridade`, {
        token: supervisorToken,
        body: { priority: 'ALTA' },
        expectedStatus: 200
      });
      assert.equal(updated.body.data.prioridade, 'ALTA');
    });

    await t.test('RN4 / CT04 — atribuição considera o vínculo do técnico com a unidade', async () => {
      const outsideUnit = await request('PUT', `/api/v1/ocorrencias/${occurrenceId}/atribuicao`, {
        token: supervisorToken,
        body: { technicianId: 'user-tecnico-unidade-2' }
      });
      assert.equal(outsideUnit.status, 409);
      const assigned = await request('PUT', `/api/v1/ocorrencias/${occurrenceId}/atribuicao`, {
        token: supervisorToken,
        body: { technicianId: 'user-tecnico-01' },
        expectedStatus: 200
      });
      assert.equal(assigned.body.data.status, 'EM_ATENDIMENTO');
      assert.equal(assigned.body.data.tecnicoResponsavel.id, 'user-tecnico-01');
    });

    await t.test('RN5 / CT06 — somente o técnico atribuído registra diagnóstico e solução', async () => {
      const denied = await request('POST', `/api/v1/ocorrencias/${occurrenceId}/atendimentos`, {
        token: externalToken,
        body: { diagnosis: 'Diagnóstico', solution: 'Solução' }
      });
      assert.equal(denied.status, 403);
      const service = await request('POST', `/api/v1/ocorrencias/${occurrenceId}/atendimentos`, {
        token: technicianToken,
        body: { diagnosis: 'Disjuntor do quadro desarmado.', solution: 'Disjuntor substituído e alimentação normalizada.' },
        expectedStatus: 201
      });
      assert.ok(service.body.data.id);
    });

    await t.test('RN6 / CT07 — pausa e retomada preservam o motivo e os horários', async () => {
      const pause = await request('POST', `/api/v1/ocorrencias/${occurrenceId}/pausas`, {
        token: technicianToken,
        body: { reason: 'Aguardando peça de reposição.' },
        expectedStatus: 201
      });
      assert.equal(pause.body.data.status, 'PAUSADA');
      const metricsWhilePaused = await request('GET', `/api/v1/ocorrencias/${occurrenceId}/indicadores`, {
        token: requesterToken,
        expectedStatus: 200
      });
      assert.equal(metricsWhilePaused.body.quantidadeDePausas, 1);
      await request('POST', `/api/v1/ocorrencias/${occurrenceId}/retomadas`, {
        token: technicianToken,
        expectedStatus: 200
      });
      const status = await request('GET', `/api/v1/ocorrencias/${occurrenceId}`, {
        token: requesterToken,
        expectedStatus: 200
      });
      assert.equal(status.body.data.status, 'EM_ATENDIMENTO');
    });

    await t.test('RN7 / CT08 — exige solução registrada para finalizar', async () => {
      const noService = await request('POST', '/api/v1/ocorrencias', {
        token: requesterToken,
        expectedStatus: 201,
        body: {
          unitId: 1,
          description: 'Lâmpada queimada na sala de reunião.',
          location: 'Sala de reunião',
          occurredAt: new Date().toISOString(),
          category: 'ELÉTRICA'
        }
      });
      const noServiceId = noService.body.data.id;
      await request('PATCH', `/api/v1/ocorrencias/${noServiceId}/prioridade`, {
        token: supervisorToken, body: { priority: 'MEDIA' }, expectedStatus: 200
      });
      await request('PUT', `/api/v1/ocorrencias/${noServiceId}/atribuicao`, {
        token: supervisorToken, body: { technicianId: 'user-tecnico-01' }, expectedStatus: 200
      });
      const rejected = await request('POST', `/api/v1/ocorrencias/${noServiceId}/finalizacao`, { token: technicianToken });
      assert.equal(rejected.status, 409);
      assert.equal(rejected.body.error.code, 'SERVICE_SOLUTION_REQUIRED');

      const finalized = await request('POST', `/api/v1/ocorrencias/${occurrenceId}/finalizacao`, {
        token: technicianToken,
        expectedStatus: 200
      });
      assert.equal(finalized.body.data.status, 'AGUARDANDO_CONFIRMACAO');
    });

    await t.test('RN8 / CT09 — somente responsável da unidade confirma a solução', async () => {
      const denied = await request('POST', `/api/v1/ocorrencias/${occurrenceId}/confirmacoes`, {
        token: requesterToken,
        body: { confirmed: true }
      });
      assert.equal(denied.status, 403);
      const confirmation = await request('POST', `/api/v1/ocorrencias/${occurrenceId}/confirmacoes`, {
        token: responsibleToken,
        body: { confirmed: true },
        expectedStatus: 200
      });
      assert.equal(confirmation.body.data.status, 'ENCERRADA');
    });

    await t.test('RN9 / CT10 — reabre sem remover atendimentos e decisões anteriores', async () => {
      const reopened = await request('POST', `/api/v1/ocorrencias/${occurrenceId}/reaberturas`, {
        token: responsibleToken,
        body: { reason: 'A queda de energia voltou no mesmo prédio.' },
        expectedStatus: 200
      });
      assert.equal(reopened.body.data.status, 'REABERTA');
      assert.equal(reopened.body.data.atendimentos.length, 1);
      assert.equal(reopened.body.data.encerradoEm, null);
      const history = await request('GET', `/api/v1/ocorrencias/${occurrenceId}/historico`, {
        token: responsibleToken,
        expectedStatus: 200
      });
      assert.ok(history.body.data.some((event) => event.acao === 'OCORRENCIA_REABERTA'));
      assert.ok(history.body.data.some((event) => event.acao === 'SOLUCAO_ACEITA'));
    });

    await t.test('RN10 / CT05 — limita consulta por unidade e protege anexos internos', async () => {
      const hidden = await request('GET', `/api/v1/ocorrencias/${foreignUnitOccurrenceId}`, {
        token: externalToken
      });
      assert.equal(hidden.status, 404);
      const notVisible = await request('GET', `/api/v1/ocorrencias/${foreignUnitOccurrenceId}`, {
        token: requesterToken
      });
      assert.equal(notVisible.status, 404);

      await request('POST', `/api/v1/ocorrencias/${occurrenceId}/anexos`, {
        token: requesterToken,
        body: { fileName: 'foto-geral.jpg', description: 'Foto externa do local', visibility: 'PUBLIC' },
        expectedStatus: 201
      });
      await request('POST', `/api/v1/ocorrencias/${occurrenceId}/anexos`, {
        token: requesterToken,
        body: { fileName: 'quadro-interno.jpg', description: 'Informação restrita à unidade', visibility: 'UNIT_ONLY' },
        expectedStatus: 201
      });
      const attachments = await request('GET', `/api/v1/ocorrencias/${occurrenceId}/anexos`, {
        token: externalToken,
        expectedStatus: 200
      });
      assert.equal(attachments.body.data.length, 1);
      assert.equal(attachments.body.data[0].visibilidade, 'PUBLIC');
      const internalAttachments = await request('GET', `/api/v1/ocorrencias/${occurrenceId}/anexos`, {
        token: requesterToken,
        expectedStatus: 200
      });
      assert.equal(internalAttachments.body.data.length, 2);
    });

    await t.test('Contrato e recursos auxiliares', async () => {
      await request('GET', '/health', { expectedStatus: 200 });
      await request('GET', '/openapi.json', { expectedStatus: 200 });
      const collection = await request('GET', '/api/v1/ocorrencias?page=1&limit=10', {
        token: requesterToken,
        expectedStatus: 200
      });
      assert.ok(collection.body.paginacao.total >= 3);
      assert.equal(db.prepare('SELECT COUNT(*) AS total FROM status_history WHERE occurrence_id = ?').get(occurrenceId).total >= 5, true);
    });
  } finally {
    await fixture.close();
  }
});

test('Swagger UI está disponível em /docs', async () => {
  const fixture = await startFixture();
  try {
    const page = await fetch(`${fixture.baseUrl}/docs`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(await page.text(), /SwaggerUIBundle/);
    const bundle = await fetch(`${fixture.baseUrl}/docs/swagger-ui-bundle.js`);
    assert.equal(bundle.status, 200);
    assert.match(bundle.headers.get('content-type'), /javascript/);
    const blocked = await fetch(`${fixture.baseUrl}/docs/package.json`);
    assert.equal(blocked.status, 404);
    const spec = await (await fetch(`${fixture.baseUrl}/openapi.json`)).json();
    assert.ok(spec.components.securitySchemes.BearerAuth);
  } finally {
    await fixture.close();
  }
});
