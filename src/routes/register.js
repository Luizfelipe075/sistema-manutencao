const { response } = require('../http/router');
const { verifyPassword, createToken } = require('../utils/security');
const HttpError = require('../utils/http-error');
const {
  requiredText,
  optionalText,
  requiredIsoDate,
  enumValue,
  positiveInteger
} = require('../utils/validation');
const {
  nowIso,
  addHistory,
  changeStatus,
  getOccurrence,
  assertRole,
  assertUnitAccess,
  assertAssignedTechnician,
  toOccurrenceDto,
  ensureSupervisor,
  randomUUID
} = require('../services/occurrence.service');

const PRIORITIES = ['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'];
const ATTACHMENT_VISIBILITIES = ['PUBLIC', 'UNIT_ONLY'];

function registerRoutes(router, db) {
  router.add('GET', '/api', {}, () => ({
    nome: 'API de Ocorrências de Manutenção',
    versao: '1.0.0',
    documentacao: '/docs',
    openapi: '/openapi.json'
  }));

  router.add('GET', '/health', {}, () => ({
    status: 'ok',
    servico: 'api-ocorrencias-manutencao',
    data: nowIso()
  }));

  router.add('POST', '/api/v1/auth/login', {}, ({ body }) => {
    const email = requiredText(body.email, 'email', 180).toLowerCase();
    const password = requiredText(body.password, 'password', 200);
    const user = db.prepare(`
      SELECT id, name, email, password_hash AS passwordHash, role, is_external AS isExternal
      FROM users WHERE email = ? COLLATE NOCASE
    `).get(email);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha inválidos.');
    }

    const unitRows = db.prepare('SELECT unit_id FROM user_units WHERE user_id = ? ORDER BY unit_id').all(user.id);
    return {
      token: createToken(user.id),
      tipo: 'Bearer',
      expiraEm: process.env.JWT_EXPIRES_IN || '8h',
      usuario: {
        id: user.id,
        nome: user.name,
        email: user.email,
        perfil: user.role,
        terceirizado: Boolean(user.isExternal),
        unidadesPermitidas: unitRows.map((item) => item.unit_id)
      }
    };
  });

  router.add('GET', '/api/v1/auth/me', { auth: true }, ({ user }) => ({
    id: user.id,
    nome: user.name,
    email: user.email,
    perfil: user.role,
    terceirizado: user.isExternal,
    unidadesPermitidas: user.unitIds
  }));

  router.add('GET', '/api/v1/unidades', { auth: true }, ({ user }) => {
    if (user.unitIds.length === 0) return { data: [] };
    const placeholders = user.unitIds.map(() => '?').join(', ');
    const units = db.prepare(`SELECT id, code, name FROM units WHERE id IN (${placeholders}) ORDER BY id`)
      .all(...user.unitIds);
    return { data: units };
  });

  router.add('GET', '/api/v1/tecnicos', { auth: true, roles: ['SUPERVISOR'] }, ({ user, query }) => {
    const unitId = positiveInteger(query.get('unidadeId') ?? undefined, 'unidadeId');
    assertUnitAccess(user, unitId);
    const technicians = db.prepare(`
      SELECT u.id, u.name AS nome, u.email, u.is_external AS terceirizado
      FROM users u
      JOIN user_units uu ON uu.user_id = u.id
      WHERE u.role = 'TECNICO' AND uu.unit_id = ?
      ORDER BY u.name
    `).all(unitId);
    return { data: technicians.map((item) => ({ ...item, terceirizado: Boolean(item.terceirizado) })) };
  });

  // RN1 — Cadastro de chamado.
  router.add('POST', '/api/v1/ocorrencias', { auth: true, roles: ['SOLICITANTE', 'SUPERVISOR', 'RESPONSAVEL_UNIDADE'] }, ({ user, body }) => {
    const unitId = positiveInteger(body.unitId, 'unitId');
    assertUnitAccess(user, unitId);
    const description = requiredText(body.description, 'description', 2000);
    const location = requiredText(body.location, 'location', 180);
    const occurredAt = requiredIsoDate(body.occurredAt, 'occurredAt');
    const category = optionalText(body.category, 'category', 100);
    const id = randomUUID();
    const createdAt = nowIso();

    const create = db.transaction(() => {
      db.prepare(`
        INSERT INTO occurrences
          (id, unit_id, requester_id, description, location, occurred_at, category,
           priority, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'ABERTA', ?, ?)
      `).run(id, unitId, user.id, description, location, occurredAt, category, createdAt, createdAt);
      db.prepare(`
        INSERT INTO status_history
          (occurrence_id, previous_status, new_status, changed_by, reason, changed_at)
        VALUES (?, NULL, 'ABERTA', ?, 'Abertura do chamado', ?)
      `).run(id, user.id, createdAt);
      addHistory(db, id, 'OCORRENCIA_CRIADA', user.id, { unitId, location });
    });
    create();

    const occurrence = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(id);
    return response(201, { data: toOccurrenceDto(db, occurrence) });
  });

  router.add('GET', '/api/v1/ocorrencias', { auth: true }, ({ user, query }) => {
    if (user.unitIds.length === 0) return { data: [], paginacao: { pagina: 1, limite: 20, total: 0 } };
    const page = positiveInteger(query.get('page') ?? undefined, 'page', 1);
    const limit = Math.min(positiveInteger(query.get('limit') ?? undefined, 'limit', 20), 100);
    const placeholders = user.unitIds.map(() => '?').join(', ');
    const conditions = [`unit_id IN (${placeholders})`];
    const params = [...user.unitIds];

    if (query.has('status')) {
      conditions.push('status = ?');
      params.push(requiredText(query.get('status'), 'status', 40));
    }
    if (query.has('prioridade')) {
      conditions.push('priority = ?');
      params.push(enumValue(query.get('prioridade'), PRIORITIES, 'prioridade'));
    }

    const where = conditions.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS total FROM occurrences WHERE ${where}`).get(...params).total;
    const rows = db.prepare(`
      SELECT * FROM occurrences WHERE ${where}
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(...params, limit, (page - 1) * limit);

    return {
      data: rows.map((row) => toOccurrenceDto(db, row)),
      paginacao: { pagina: page, limite: limit, total }
    };
  });

  router.add('GET', '/api/v1/ocorrencias/:id', { auth: true }, ({ user, params }) => {
    const occurrence = getOccurrence(db, params.id, user);
    return { data: toOccurrenceDto(db, occurrence) };
  });

  router.add('GET', '/api/v1/ocorrencias/:id/historico', { auth: true }, ({ user, params }) => {
    getOccurrence(db, params.id, user);
    const rows = db.prepare(`
      SELECT h.id, h.action AS acao, h.details_json AS detalhesJson,
             h.created_at AS criadoEm, u.id AS usuarioId, u.name AS usuario
      FROM occurrence_history h
      JOIN users u ON u.id = h.actor_id
      WHERE h.occurrence_id = ?
      ORDER BY h.created_at ASC, h.id ASC
    `).all(params.id);
    return { data: rows.map((row) => ({
      id: row.id,
      acao: row.acao,
      detalhes: JSON.parse(row.detalhesJson),
      criadoEm: row.criadoEm,
      usuario: { id: row.usuarioId, nome: row.usuario }
    })) };
  });

  router.add('GET', '/api/v1/ocorrencias/:id/indicadores', { auth: true }, ({ user, params }) => {
    const occurrence = getOccurrence(db, params.id, user);
    const pauses = db.prepare(`
      SELECT started_at AS startedAt, ended_at AS endedAt
      FROM service_pauses WHERE occurrence_id = ?
    `).all(occurrence.id);
    const pausedMinutes = pauses.reduce((sum, pause) => {
      const start = new Date(pause.startedAt).getTime();
      const end = pause.endedAt ? new Date(pause.endedAt).getTime() : Date.now();
      return sum + Math.max(0, Math.floor((end - start) / 60000));
    }, 0);
    return {
      ocorrenciaId: occurrence.id,
      statusAtual: occurrence.status,
      tempoAtendimentoMinutos: toOccurrenceDto(db, occurrence).metricas.tempoAtendimentoMinutos,
      tempoPausadoMinutos: pausedMinutes,
      quantidadeDePausas: pauses.length,
      quantidadeDeReaberturas: db.prepare(`
        SELECT COUNT(*) AS total FROM status_history
        WHERE occurrence_id = ? AND new_status = 'REABERTA'
      `).get(occurrence.id).total
    };
  });

  router.add('GET', '/api/v1/ocorrencias/:id/anexos', { auth: true }, ({ user, params }) => {
    getOccurrence(db, params.id, user);
    const visibilityFilter = user.isExternal ? "AND visibility = 'PUBLIC'" : '';
    const rows = db.prepare(`
      SELECT id, file_name AS nomeArquivo, description AS descricao,
             visibility AS visibilidade, created_at AS criadoEm
      FROM attachments
      WHERE occurrence_id = ? ${visibilityFilter}
      ORDER BY created_at ASC
    `).all(params.id);
    return { data: rows };
  });

  router.add('POST', '/api/v1/ocorrencias/:id/anexos', { auth: true, roles: ['SOLICITANTE', 'SUPERVISOR', 'RESPONSAVEL_UNIDADE'] }, ({ user, params, body }) => {
    const occurrence = getOccurrence(db, params.id, user);
    const fileName = requiredText(body.fileName, 'fileName', 180);
    const description = optionalText(body.description, 'description', 500);
    const visibility = enumValue(body.visibility || 'PUBLIC', ATTACHMENT_VISIBILITIES, 'visibility');
    const id = randomUUID();
    const createdAt = nowIso();
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO attachments (id, occurrence_id, file_name, description, visibility, uploaded_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, occurrence.id, fileName, description, visibility, user.id, createdAt);
      addHistory(db, occurrence.id, 'ANEXO_ADICIONADO', user.id, { attachmentId: id, visibility });
    });
    transaction();
    return response(201, { data: { id, fileName, description, visibility, createdAt } });
  });

  // RN2 — Duplicidades só são vinculadas depois da confirmação do supervisor.
  router.add('POST', '/api/v1/ocorrencias/:id/relacionadas', { auth: true, roles: ['SUPERVISOR'] }, ({ user, params, body }) => {
    const occurrence = getOccurrence(db, params.id, user);
    const relatedId = requiredText(body.relatedOccurrenceId, 'relatedOccurrenceId', 80);
    if (body.confirmedSameProblem !== true) {
      throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'O supervisor precisa confirmar que os registros tratam do mesmo problema.');
    }
    const related = getOccurrence(db, relatedId, user);
    const sameLocation = occurrence.location.trim().toLocaleLowerCase('pt-BR')
      === related.location.trim().toLocaleLowerCase('pt-BR');
    if (occurrence.unit_id !== related.unit_id || !sameLocation) {
      throw new HttpError(409, 'DUPLICATE_LINK_CONFLICT', 'Chamados de unidades ou locais diferentes não podem ser relacionados como duplicados.');
    }
    if (occurrence.id === related.id) throw new HttpError(400, 'INVALID_RELATION', 'Uma ocorrência não pode ser relacionada a ela mesma.');

    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO related_occurrences
          (occurrence_id, related_occurrence_id, relation_type, confirmed_same_problem, created_by, created_at)
        VALUES (?, ?, 'DUPLICADA', 1, ?, ?)
      `).run(occurrence.id, related.id, user.id, nowIso());
      db.prepare(`
        INSERT INTO related_occurrences
          (occurrence_id, related_occurrence_id, relation_type, confirmed_same_problem, created_by, created_at)
        VALUES (?, ?, 'DUPLICADA', 1, ?, ?)
      `).run(related.id, occurrence.id, user.id, nowIso());
      addHistory(db, occurrence.id, 'DUPLICIDADE_RELACIONADA', user.id, { relatedOccurrenceId: related.id });
      addHistory(db, related.id, 'DUPLICIDADE_RELACIONADA', user.id, { relatedOccurrenceId: occurrence.id });
    });
    try {
      transaction();
    } catch (error) {
      if (String(error.message || '').includes('UNIQUE constraint failed')) {
        throw new HttpError(409, 'RELATION_ALREADY_EXISTS', 'Essas ocorrências já estão relacionadas.');
      }
      throw error;
    }
    return response(201, { data: { ocorrenciaId: occurrence.id, relacionadaAoId: related.id, tipo: 'DUPLICADA' } });
  });

  // RN3 — A prioridade é definida pelo supervisor durante a triagem.
  router.add('PATCH', '/api/v1/ocorrencias/:id/prioridade', { auth: true, roles: ['SUPERVISOR'] }, ({ user, params, body }) => {
    const occurrence = getOccurrence(db, params.id, user);
    const priority = enumValue(body.priority, PRIORITIES, 'priority');
    const transaction = db.transaction(() => {
      db.prepare('UPDATE occurrences SET priority = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(priority, nowIso(), occurrence.id);
      addHistory(db, occurrence.id, 'PRIORIDADE_ALTERADA', user.id, { de: occurrence.priority, para: priority });
    });
    transaction();
    const updated = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
    return { data: toOccurrenceDto(db, updated) };
  });

  // RN4 — Atribuição restrita a técnicos com vínculo ativo na unidade.
  router.add('PUT', '/api/v1/ocorrencias/:id/atribuicao', { auth: true, roles: ['SUPERVISOR'] }, ({ user, params, body }) => {
    const occurrence = getOccurrence(db, params.id, user);
    if (!occurrence.priority) throw new HttpError(409, 'PRIORITY_REQUIRED', 'Defina a prioridade antes de atribuir um técnico.');
    if (!['ABERTA', 'REABERTA', 'EM_ATENDIMENTO'].includes(occurrence.status)) {
      throw new HttpError(409, 'INVALID_OCCURRENCE_STATUS', 'A atribuição só pode ser feita em chamados abertos ou em atendimento.');
    }
    const technicianId = requiredText(body.technicianId, 'technicianId', 80);
    const technician = db.prepare('SELECT id, role FROM users WHERE id = ?').get(technicianId);
    if (!technician || technician.role !== 'TECNICO') {
      throw new HttpError(400, 'INVALID_TECHNICIAN', 'O responsável informado não é um técnico cadastrado.');
    }
    const hasUnitAccess = db.prepare('SELECT 1 FROM user_units WHERE user_id = ? AND unit_id = ?')
      .get(technicianId, occurrence.unit_id);
    if (!hasUnitAccess) throw new HttpError(409, 'TECHNICIAN_OUTSIDE_UNIT', 'O técnico não possui autorização para esta unidade.');

    const transaction = db.transaction(() => {
      db.prepare(`
        UPDATE occurrences SET assigned_technician_id = ?, updated_at = ?, version = version + 1 WHERE id = ?
      `).run(technicianId, nowIso(), occurrence.id);
      addHistory(db, occurrence.id, 'TECNICO_ATRIBUIDO', user.id, { de: occurrence.assigned_technician_id, para: technicianId });
      if (['ABERTA', 'REABERTA'].includes(occurrence.status)) {
        const refreshed = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
        changeStatus(db, refreshed, 'EM_ATENDIMENTO', user.id, 'Técnico atribuído');
      }
    });
    transaction();
    const updated = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
    return { data: toOccurrenceDto(db, updated) };
  });

  // RN5 — O técnico atribuído registra diagnóstico, solução e data do serviço.
  router.add('POST', '/api/v1/ocorrencias/:id/atendimentos', { auth: true }, ({ user, params, body }) => {
    const occurrence = getOccurrence(db, params.id, user);
    assertAssignedTechnician(occurrence, user);
    if (occurrence.status !== 'EM_ATENDIMENTO') {
      throw new HttpError(409, 'INVALID_OCCURRENCE_STATUS', 'O serviço só pode ser registrado enquanto o chamado estiver em atendimento.');
    }
    const diagnosis = requiredText(body.diagnosis, 'diagnosis', 1500);
    const solution = requiredText(body.solution, 'solution', 2000);
    const performedAt = body.performedAt ? requiredIsoDate(body.performedAt, 'performedAt') : nowIso();
    const id = randomUUID();
    const createdAt = nowIso();
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO service_records (id, occurrence_id, technician_id, diagnosis, solution, performed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, occurrence.id, user.id, diagnosis, solution, performedAt, createdAt);
      addHistory(db, occurrence.id, 'SERVICO_REGISTRADO', user.id, { serviceRecordId: id });
    });
    transaction();
    return response(201, { data: { id, occurrenceId: occurrence.id, diagnosis, solution, performedAt } });
  });

  // RN6 — Períodos de espera ficam separados do tempo de execução do serviço.
  router.add('POST', '/api/v1/ocorrencias/:id/pausas', { auth: true, roles: ['TECNICO', 'SUPERVISOR'] }, ({ user, params, body }) => {
    const occurrence = getOccurrence(db, params.id, user);
    if (user.role === 'TECNICO') assertAssignedTechnician(occurrence, user);
    if (occurrence.status !== 'EM_ATENDIMENTO') {
      throw new HttpError(409, 'INVALID_OCCURRENCE_STATUS', 'Só é possível pausar um chamado que esteja em atendimento.');
    }
    const reason = requiredText(body.reason, 'reason', 500);
    const id = randomUUID();
    const startedAt = nowIso();
    const transaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO service_pauses (id, occurrence_id, started_by, reason, started_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, occurrence.id, user.id, reason, startedAt);
      const refreshed = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
      changeStatus(db, refreshed, 'PAUSADA', user.id, reason);
      addHistory(db, occurrence.id, 'ATENDIMENTO_PAUSADO', user.id, { pauseId: id, reason });
    });
    transaction();
    return response(201, { data: { id, occurrenceId: occurrence.id, reason, startedAt, status: 'PAUSADA' } });
  });

  router.add('POST', '/api/v1/ocorrencias/:id/retomadas', { auth: true, roles: ['TECNICO', 'SUPERVISOR'] }, ({ user, params }) => {
    const occurrence = getOccurrence(db, params.id, user);
    if (user.role === 'TECNICO') assertAssignedTechnician(occurrence, user);
    if (occurrence.status !== 'PAUSADA') throw new HttpError(409, 'OCCURRENCE_NOT_PAUSED', 'O chamado não possui uma pausa em andamento.');
    const activePause = db.prepare('SELECT id FROM service_pauses WHERE occurrence_id = ? AND ended_at IS NULL').get(occurrence.id);
    if (!activePause) throw new HttpError(409, 'ACTIVE_PAUSE_NOT_FOUND', 'Não existe uma pausa ativa para encerrar.');
    const endedAt = nowIso();
    const transaction = db.transaction(() => {
      db.prepare('UPDATE service_pauses SET ended_at = ?, ended_by = ? WHERE id = ?').run(endedAt, user.id, activePause.id);
      const refreshed = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
      changeStatus(db, refreshed, 'EM_ATENDIMENTO', user.id, 'Atendimento retomado');
      addHistory(db, occurrence.id, 'ATENDIMENTO_RETOMADO', user.id, { pauseId: activePause.id });
    });
    transaction();
    return { data: { occurrenceId: occurrence.id, pauseId: activePause.id, endedAt, status: 'EM_ATENDIMENTO' } };
  });

  // RN7 — Sem solução registrada, a API não encaminha o chamado para aceite.
  router.add('POST', '/api/v1/ocorrencias/:id/finalizacao', { auth: true }, ({ user, params }) => {
    const occurrence = getOccurrence(db, params.id, user);
    assertAssignedTechnician(occurrence, user);
    if (occurrence.status !== 'EM_ATENDIMENTO') {
      throw new HttpError(409, 'INVALID_OCCURRENCE_STATUS', 'O chamado não está em atendimento e não pode ser finalizado.');
    }
    const service = db.prepare(`
      SELECT id, solution FROM service_records
      WHERE occurrence_id = ? ORDER BY performed_at DESC, created_at DESC LIMIT 1
    `).get(occurrence.id);
    if (!service || !service.solution.trim()) {
      throw new HttpError(409, 'SERVICE_SOLUTION_REQUIRED', 'Registre a solução do serviço antes de finalizar o chamado.');
    }
    const transaction = db.transaction(() => {
      changeStatus(db, occurrence, 'AGUARDANDO_CONFIRMACAO', user.id, 'Serviço concluído; aguardando aceite da unidade');
      addHistory(db, occurrence.id, 'FINALIZACAO_SOLICITADA', user.id, { serviceRecordId: service.id });
    });
    transaction();
    const updated = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
    return { data: toOccurrenceDto(db, updated) };
  });

  // RN8 — Apenas o responsável autorizado da unidade confirma a solução.
  router.add('POST', '/api/v1/ocorrencias/:id/confirmacoes', { auth: true, roles: ['RESPONSAVEL_UNIDADE'] }, ({ user, params, body }) => {
    const occurrence = getOccurrence(db, params.id, user);
    if (occurrence.status !== 'AGUARDANDO_CONFIRMACAO') {
      throw new HttpError(409, 'INVALID_OCCURRENCE_STATUS', 'O chamado ainda não está aguardando confirmação da unidade.');
    }
    if (typeof body.confirmed !== 'boolean') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'O campo confirmed deve ser verdadeiro ou falso.');
    }
    const reason = optionalText(body.reason, 'reason', 500);
    if (!body.confirmed && !reason) throw new HttpError(400, 'REASON_REQUIRED', 'Informe o motivo para não aceitar a solução.');
    const newStatus = body.confirmed ? 'ENCERRADA' : 'EM_ATENDIMENTO';
    const transaction = db.transaction(() => {
      changeStatus(db, occurrence, newStatus, user.id,
        body.confirmed ? 'Solução aceita pela unidade' : reason,
        { closed_at: body.confirmed ? nowIso() : null });
      addHistory(db, occurrence.id, body.confirmed ? 'SOLUCAO_ACEITA' : 'SOLUCAO_RECUSADA', user.id, {
        confirmed: body.confirmed,
        reason
      });
    });
    transaction();
    const updated = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
    return { data: toOccurrenceDto(db, updated) };
  });

  // RN9 — A reabertura é um novo evento; nenhum atendimento anterior é removido.
  router.add('POST', '/api/v1/ocorrencias/:id/reaberturas', { auth: true, roles: ['RESPONSAVEL_UNIDADE', 'SUPERVISOR'] }, ({ user, params, body }) => {
    const occurrence = getOccurrence(db, params.id, user);
    if (occurrence.status !== 'ENCERRADA') throw new HttpError(409, 'OCCURRENCE_NOT_CLOSED', 'Somente um chamado encerrado pode ser reaberto.');
    const reason = requiredText(body.reason, 'reason', 500);
    const transaction = db.transaction(() => {
      changeStatus(db, occurrence, 'REABERTA', user.id, reason, { closed_at: null });
      addHistory(db, occurrence.id, 'OCORRENCIA_REABERTA', user.id, { reason });
    });
    transaction();
    const updated = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
    return { data: toOccurrenceDto(db, updated) };
  });
}

module.exports = { registerRoutes };
