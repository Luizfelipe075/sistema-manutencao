'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const STATUS = { ABERTA: 'Aberta', EM_ATENDIMENTO: 'Em atendimento', PAUSADA: 'Pausada', AGUARDANDO_CONFIRMACAO: 'Aguardando confirmação', ENCERRADA: 'Encerrada', REABERTA: 'Reaberta' };
const ROLES = { SOLICITANTE: 'Solicitante', SUPERVISOR: 'Supervisor', TECNICO: 'Técnico', RESPONSAVEL_UNIDADE: 'Responsável da unidade' };
const PRIO = ['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'];
const DEMO = [['solicitante', 'Solicitante'], ['supervisor', 'Supervisor'], ['tecnico', 'Técnico'], ['responsavel', 'Responsável'], ['terceirizado', 'Terceirizado']];
const ACTION_LABEL = { OCORRENCIA_CRIADA: 'Ocorrência criada', DUPLICIDADE_RELACIONADA: 'Duplicidade relacionada', PRIORIDADE_ALTERADA: 'Prioridade alterada', TECNICO_ATRIBUIDO: 'Técnico atribuído', SERVICO_REGISTRADO: 'Serviço registrado', ATENDIMENTO_PAUSADO: 'Atendimento pausado', ATENDIMENTO_RETOMADO: 'Atendimento retomado', FINALIZACAO_SOLICITADA: 'Finalização solicitada', SOLUCAO_ACEITA: 'Solução aceita', SOLUCAO_RECUSADA: 'Solução recusada', OCORRENCIA_REABERTA: 'Ocorrência reaberta', ANEXO_ADICIONADO: 'Anexo adicionado' };

const S = { token: sessionStorage.getItem('token'), user: JSON.parse(sessionStorage.getItem('user') || 'null'), units: [], list: [], page: 1, total: 0, limit: 10, status: '', prioridade: '' };

function toast(msg, err) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}

async function api(method, path, body) {
  const res = await fetch('/api/v1' + path, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && S.token) logout(true);
    const e = new Error(json.error?.message || 'Erro ' + res.status);
    e.code = json.error?.code; e.status = res.status;
    throw e;
  }
  return json;
}
const run = async (fn, okMsg) => { try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(`${e.message}${e.code ? ' (' + e.code + ')' : ''}`, true); return null; } };

/* Janela de formulário reutilizável: devolve os valores ou null se cancelar. */
function ask(title, fields, { submit = 'Salvar', cls = '', info = '' } = {}) {
  return new Promise((resolve) => {
    const dlg = $('#dlg'), form = $('#dlgForm');
    form.innerHTML = `<h2>${esc(title)}</h2>${info ? `<p class="m">${esc(info)}</p>` : ''}` + fields.map((f) => {
      const id = 'f_' + f.name, req = f.required ? 'required' : '';
      let input;
      if (f.type === 'select') input = `<select id="${id}" ${req}>${(f.options || []).map((o) => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join('')}</select>`;
      else if (f.type === 'textarea') input = `<textarea id="${id}" rows="3" ${req} maxlength="${f.max || 2000}"></textarea>`;
      else input = `<input id="${id}" type="${f.type || 'text'}" value="${esc(f.value || '')}" ${req}>`;
      return `<label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}`;
    }).join('') + `<div class="row"><button type="button" class="sec" id="cx">Cancelar</button><button type="submit" class="${cls}">${esc(submit)}</button></div>`;
    let done = false;
    const finish = (v) => { if (done) return; done = true; dlg.close(); resolve(v); };
    form.onsubmit = (e) => { e.preventDefault(); const v = {}; fields.forEach((f) => { v[f.name] = $('#f_' + f.name).value.trim(); }); finish(v); };
    $('#cx').onclick = () => finish(null);
    dlg.oncancel = () => finish(null);
    dlg.showModal();
  });
}

function logout(silent) {
  sessionStorage.clear();
  Object.assign(S, { token: null, user: null, units: [], list: [], page: 1 });
  if (!silent) toast('Sessão encerrada.');
  render();
}

async function login(email, password) {
  const r = await run(() => api('POST', '/auth/login', { email, password }));
  if (!r) return;
  S.token = r.token; S.user = r.usuario;
  sessionStorage.setItem('token', S.token);
  sessionStorage.setItem('user', JSON.stringify(S.user));
  render();
}

function render() {
  const app = $('#app');
  if (!S.token || !S.user) {
    app.innerHTML = `<div class="login"><div class="card"><h1>Manutenção</h1><p class="m">Gestão de ocorrências em rede de unidades.</p>
      <form id="lf"><label>E-mail</label><input id="em" type="email" required autocomplete="username" value="solicitante@demo.local">
      <label>Senha</label><input id="pw" type="password" required autocomplete="current-password" value="Demo@123">
      <div class="row"><button type="submit">Entrar</button></div></form>
      <h3>Contas de demonstração</h3><div class="demo">${DEMO.map(([k, t]) => `<button class="sec" data-demo="${k}">${t}</button>`).join('')}</div>
      <p class="m">Senha de todas: <code>Demo@123</code></p></div></div>`;
    $('#lf').onsubmit = (e) => { e.preventDefault(); login($('#em').value, $('#pw').value); };
    app.querySelectorAll('[data-demo]').forEach((b) => { b.onclick = () => login(b.dataset.demo + '@demo.local', 'Demo@123'); });
    return;
  }
  const u = S.user;
  app.innerHTML = `<div class="top"><div><b>${esc(u.nome)}</b> <span class="chip">${ROLES[u.perfil]}${u.terceirizado ? ' · terceirizado' : ''}</span><br><small>${esc(u.email)} · unidades: ${u.unidadesPermitidas.join(', ')}</small></div>
    <div><button class="sec" id="out">Sair</button></div></div>
    <main><div class="bar"><div><label>Status</label><select id="fs"><option value="">Todos</option>${Object.entries(STATUS).map(([k, t]) => `<option value="${k}" ${S.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div><label>Prioridade</label><select id="fp"><option value="">Todas</option>${PRIO.map((p) => `<option ${S.prioridade === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <div class="sp"></div>${canCreate() ? '<button id="new">+ Nova ocorrência</button>' : ''}</div>
    <div id="list"></div><div class="pg" id="pg"></div></main>`;
  $('#out').onclick = () => logout();
  $('#fs').onchange = (e) => { S.status = e.target.value; S.page = 1; loadList(); };
  $('#fp').onchange = (e) => { S.prioridade = e.target.value; S.page = 1; loadList(); };
  if ($('#new')) $('#new').onclick = newOccurrence;
  loadList();
}
const canCreate = () => ['SOLICITANTE', 'SUPERVISOR', 'RESPONSAVEL_UNIDADE'].includes(S.user.perfil);

async function loadList() {
  const q = new URLSearchParams({ page: S.page, limit: S.limit });
  if (S.status) q.set('status', S.status);
  if (S.prioridade) q.set('prioridade', S.prioridade);
  const r = await run(() => api('GET', '/ocorrencias?' + q));
  if (!r) return;
  S.list = r.data; S.total = r.paginacao.total;
  $('#list').innerHTML = r.data.length ? r.data.map((o) => `<div class="card item" data-id="${o.id}">
      <div><div class="d">${esc(o.descricao)}</div><div class="m">${esc(o.unidade.name)} · ${esc(o.local)} · ${fmt(o.dataOcorrencia)}${o.categoria ? ' · ' + esc(o.categoria) : ''}</div>
      <div class="m">Técnico: ${esc(o.tecnicoResponsavel?.name || 'não atribuído')}</div></div>
      <div><span class="chip s-${o.status}">${STATUS[o.status]}</span> ${o.prioridade ? `<span class="chip p-${o.prioridade}">${o.prioridade}</span>` : '<span class="chip">Sem prioridade</span>'}</div></div>`).join('')
    : '<div class="card empty">Nenhuma ocorrência encontrada.</div>';
  $('#list').querySelectorAll('.item').forEach((el) => { el.onclick = () => openDetail(el.dataset.id); });
  const pages = Math.max(1, Math.ceil(S.total / S.limit));
  $('#pg').innerHTML = `<button class="sec" id="pv" ${S.page <= 1 ? 'disabled' : ''}>‹</button><span>Página ${S.page} de ${pages} · ${S.total} registro(s)</span><button class="sec" id="nx" ${S.page >= pages ? 'disabled' : ''}>›</button>`;
  $('#pv').onclick = () => { S.page--; loadList(); };
  $('#nx').onclick = () => { S.page++; loadList(); };
}

async function newOccurrence() {
  const now = new Date(Date.now() - 60000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const units = await run(() => api('GET', '/unidades'));
  if (!units) return;
  const v = await ask('Nova ocorrência', [
    { name: 'unitId', label: 'Unidade', type: 'select', options: units.data.map((x) => ({ v: x.id, t: x.name })), required: true },
    { name: 'description', label: 'Descrição', type: 'textarea', required: true },
    { name: 'location', label: 'Local', required: true },
    { name: 'category', label: 'Categoria (ex.: ELÉTRICA)' },
    { name: 'occurredAt', label: 'Data e hora da ocorrência', type: 'datetime-local', value: now, required: true }
  ], { submit: 'Cadastrar' });
  if (!v) return;
  const r = await run(() => api('POST', '/ocorrencias', { unitId: Number(v.unitId), description: v.description, location: v.location, category: v.category || undefined, occurredAt: new Date(v.occurredAt).toISOString() }), 'Ocorrência cadastrada.');
  if (r) { loadList(); openDetail(r.data.id); }
}

async function openDetail(id) {
  const [o, h, ind, an] = await Promise.all([
    run(() => api('GET', '/ocorrencias/' + id)), run(() => api('GET', `/ocorrencias/${id}/historico`)),
    run(() => api('GET', `/ocorrencias/${id}/indicadores`)), run(() => api('GET', `/ocorrencias/${id}/anexos`))
  ]);
  if (!o) return;
  const d = o.data, role = S.user.perfil, me = S.user.id, st = d.status;
  const mine = d.tecnicoResponsavel?.id === me && role === 'TECNICO';
  const A = []; // [rótulo, classe, função]
  if (role === 'SUPERVISOR') {
    A.push(['Definir prioridade', '', () => setPriority(d)]);
    if (d.prioridade && ['ABERTA', 'REABERTA', 'EM_ATENDIMENTO'].includes(st)) A.push(['Atribuir técnico', '', () => assign(d)]);
    A.push(['Relacionar duplicada', 'sec', () => relate(d)]);
  }
  if ((mine || role === 'SUPERVISOR') && st === 'EM_ATENDIMENTO') A.push(['Pausar', 'sec', () => pause(d)]);
  if ((mine || role === 'SUPERVISOR') && st === 'PAUSADA') A.push(['Retomar', 'ok', () => act('POST', `/ocorrencias/${d.id}/retomadas`, undefined, 'Atendimento retomado.', d.id)]);
  if (mine && st === 'EM_ATENDIMENTO') {
    A.push(['Registrar atendimento', '', () => service(d)]);
    A.push(['Finalizar', 'ok', () => act('POST', `/ocorrencias/${d.id}/finalizacao`, undefined, 'Enviado para confirmação da unidade.', d.id)]);
  }
  if (role === 'RESPONSAVEL_UNIDADE' && st === 'AGUARDANDO_CONFIRMACAO') {
    A.push(['Confirmar serviço', 'ok', () => act('POST', `/ocorrencias/${d.id}/confirmacoes`, { confirmed: true }, 'Ocorrência encerrada.', d.id)]);
    A.push(['Recusar solução', 'danger', () => refuse(d)]);
  }
  if (['RESPONSAVEL_UNIDADE', 'SUPERVISOR'].includes(role) && st === 'ENCERRADA') A.push(['Reabrir', 'danger', () => reopen(d)]);
  if (['SOLICITANTE', 'SUPERVISOR', 'RESPONSAVEL_UNIDADE'].includes(role)) A.push(['Adicionar anexo', 'sec', () => attach(d)]);

  const dlg = $('#dlg'), form = $('#dlgForm');
  const m = d.metricas, i = ind || {};
  form.innerHTML = `<div style="display:flex;justify-content:space-between;gap:10px"><h2>Ocorrência</h2><button type="button" class="sec" id="cl">Fechar</button></div>
    <p><span class="chip s-${st}">${STATUS[st]}</span> ${d.prioridade ? `<span class="chip p-${d.prioridade}">${d.prioridade}</span>` : '<span class="chip">Sem prioridade</span>'}</p>
    <p style="font-size:1.05rem">${esc(d.descricao)}</p>
    <div class="grid card">
      <div class="kv"><b>Unidade</b>${esc(d.unidade.name)}</div><div class="kv"><b>Local</b>${esc(d.local)}</div>
      <div class="kv"><b>Categoria</b>${esc(d.categoria || '—')}</div><div class="kv"><b>Ocorreu em</b>${fmt(d.dataOcorrencia)}</div>
      <div class="kv"><b>Solicitante</b>${esc(d.solicitante.name)}</div><div class="kv"><b>Técnico</b>${esc(d.tecnicoResponsavel?.name || 'não atribuído')}${d.tecnicoResponsavel?.isExternal ? ' (terceirizado)' : ''}</div>
      <div class="kv"><b>Encerrada em</b>${fmt(d.encerradoEm)}</div><div class="kv"><b>ID</b><code>${d.id.slice(0, 8)}…</code></div></div>
    ${d.pausaAtiva ? `<p class="card"><b>Pausada desde ${fmt(d.pausaAtiva.startedAt)}:</b> ${esc(d.pausaAtiva.reason)}</p>` : ''}
    <h3>Ações</h3><div class="acts" id="acts">${A.length ? '' : '<span class="m">Nenhuma ação disponível para o seu perfil neste status.</span>'}</div>
    <h3>Indicadores</h3><div class="grid">
      <div class="card kv"><b>Tempo em atendimento</b>${m.tempoAtendimentoMinutos} min</div><div class="card kv"><b>Tempo pausado</b>${i.tempoPausadoMinutos ?? 0} min</div>
      <div class="card kv"><b>Pausas</b>${i.quantidadeDePausas ?? 0}</div><div class="card kv"><b>Reaberturas</b>${i.quantidadeDeReaberturas ?? 0}</div></div>
    <h3>Atendimentos</h3>${d.atendimentos.length ? d.atendimentos.map((a) => `<div class="card" style="margin-bottom:8px"><b>Diagnóstico:</b> ${esc(a.diagnosis)}<br><b>Solução:</b> ${esc(a.solution)}<br><small class="m">${esc(a.technicianName)} · ${fmt(a.performedAt)}</small></div>`).join('') : '<p class="m">Nenhum atendimento registrado.</p>'}
    <h3>Relacionadas (duplicidade)</h3>${d.ocorrenciasRelacionadas.length ? d.ocorrenciasRelacionadas.map((x) => `<code>${x.slice(0, 8)}…</code>`).join(' ') : '<p class="m">Nenhuma.</p>'}
    <h3>Anexos</h3>${an?.data.length ? an.data.map((a) => `<div>📎 ${esc(a.nomeArquivo)} <span class="chip">${a.visibilidade === 'PUBLIC' ? 'Público' : 'Somente unidade'}</span> <small class="m">${esc(a.descricao || '')}</small></div>`).join('') : '<p class="m">Nenhum anexo visível para o seu perfil.</p>'}
    <h3>Histórico</h3><div class="tl">${(h?.data || []).map((x) => `<div><b>${ACTION_LABEL[x.acao] || esc(x.acao)}</b> <small>— ${esc(x.usuario.nome)}, ${fmt(x.criadoEm)}</small>${x.detalhes?.reason ? `<br><small>Motivo: ${esc(x.detalhes.reason)}</small>` : ''}${x.detalhes?.para && x.acao === 'PRIORIDADE_ALTERADA' ? `<br><small>${esc(x.detalhes.de || 'sem prioridade')} → ${esc(x.detalhes.para)}</small>` : ''}</div>`).join('')}</div>`;
  A.forEach(([t, c, fn]) => { const b = document.createElement('button'); b.type = 'button'; b.className = c; b.textContent = t; b.onclick = fn; $('#acts').append(b); });
  $('#cl').onclick = () => dlg.close();
  form.onsubmit = (e) => e.preventDefault();
  dlg.oncancel = null;
  if (!dlg.open) dlg.showModal();
}

async function act(method, path, body, okMsg, id) {
  const r = await run(() => api(method, path, body), okMsg);
  if (r) loadList();
  openDetail(id); // reabre sempre, inclusive após erro, para o usuário não perder o contexto
}
const setPriority = async (d) => { const v = await ask('Definir prioridade', [{ name: 'priority', label: 'Prioridade', type: 'select', options: PRIO.map((p) => ({ v: p, t: p })), required: true }]); if (v) act('PATCH', `/ocorrencias/${d.id}/prioridade`, v, 'Prioridade atualizada.', d.id); else openDetail(d.id); };
const assign = async (d) => {
  const t = await run(() => api('GET', '/tecnicos?unidadeId=' + d.unidade.id));
  if (!t) return;
  const v = await ask('Atribuir técnico', [{ name: 'technicianId', label: 'Técnico', type: 'select', options: t.data.map((x) => ({ v: x.id, t: x.nome + (x.terceirizado ? ' (terceirizado)' : '') })), required: true }]);
  if (v) act('PUT', `/ocorrencias/${d.id}/atribuicao`, v, 'Técnico atribuído.', d.id); else openDetail(d.id);
};
const relate = async (d) => {
  const all = await run(() => api('GET', '/ocorrencias?limit=100'));
  const opts = (all ? all.data : S.list).filter((x) => x.id !== d.id && x.unidade.id === d.unidade.id).map((x) => ({ v: x.id, t: `${x.descricao.slice(0, 50)} — ${x.local}` }));
  if (!opts.length) { toast('Não há outra ocorrência da mesma unidade na lista atual.', true); return; }
  const v = await ask('Relacionar ocorrência duplicada', [{ name: 'relatedOccurrenceId', label: 'Ocorrência relacionada', type: 'select', options: opts, required: true }], { info: 'Ao confirmar, você atesta que os dois chamados tratam do mesmo problema.', submit: 'Confirmar mesmo problema' });
  if (v) act('POST', `/ocorrencias/${d.id}/relacionadas`, { relatedOccurrenceId: v.relatedOccurrenceId, confirmedSameProblem: true }, 'Ocorrências relacionadas.', d.id); else openDetail(d.id);
};
const pause = async (d) => { const v = await ask('Pausar atendimento', [{ name: 'reason', label: 'Motivo', type: 'textarea', required: true, max: 500 }], { submit: 'Pausar' }); if (v) act('POST', `/ocorrencias/${d.id}/pausas`, v, 'Atendimento pausado.', d.id); else openDetail(d.id); };
const service = async (d) => {
  const v = await ask('Registrar atendimento', [{ name: 'diagnosis', label: 'Diagnóstico', type: 'textarea', required: true }, { name: 'solution', label: 'Solução aplicada', type: 'textarea', required: true }]);
  if (v) act('POST', `/ocorrencias/${d.id}/atendimentos`, v, 'Atendimento registrado.', d.id); else openDetail(d.id);
};
const refuse = async (d) => { const v = await ask('Recusar solução', [{ name: 'reason', label: 'Motivo da recusa', type: 'textarea', required: true, max: 500 }], { submit: 'Recusar', cls: 'danger' }); if (v) act('POST', `/ocorrencias/${d.id}/confirmacoes`, { confirmed: false, reason: v.reason }, 'Solução recusada; ocorrência voltou ao atendimento.', d.id); else openDetail(d.id); };
const reopen = async (d) => { const v = await ask('Reabrir ocorrência', [{ name: 'reason', label: 'Motivo', type: 'textarea', required: true, max: 500 }], { submit: 'Reabrir', cls: 'danger' }); if (v) act('POST', `/ocorrencias/${d.id}/reaberturas`, v, 'Ocorrência reaberta.', d.id); else openDetail(d.id); };
const attach = async (d) => {
  const v = await ask('Adicionar anexo', [{ name: 'fileName', label: 'Nome do arquivo', required: true }, { name: 'description', label: 'Descrição' },
    { name: 'visibility', label: 'Visibilidade', type: 'select', options: [{ v: 'PUBLIC', t: 'Público' }, { v: 'UNIT_ONLY', t: 'Somente unidade (oculto para terceirizados)' }] }]);
  if (v) act('POST', `/ocorrencias/${d.id}/anexos`, { fileName: v.fileName, description: v.description || undefined, visibility: v.visibility }, 'Anexo registrado.', d.id); else openDetail(d.id);
};

render();
