const { randomUUID } = require('node:crypto');
const HttpError = require('../utils/http-error');

const ACTIVE_STATUSES = new Set([
  'ABERTA',
  'EM_ATENDIMENTO',
  'AGUARDANDO_CONFIRMACAO',
  'REABERTA'
]);

function nowIso() {
  return new Date().toISOString();
}

function addHistory(db, occurrenceId, action, actorId, details = {}) {
  db.prepare(`
    INSERT INTO occurrence_history (occurrence_id, action, actor_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(occurrenceId, action, actorId, JSON.stringify(details), nowIso());
}

function changeStatus(db, occurrence, newStatus, actorId, reason = null, extraUpdates = {}) {
  const changedAt = nowIso();
  const updateFields = {
    status: newStatus,
    updated_at: changedAt,
    version: occurrence.version + 1,
    ...extraUpdates
  };

  db.prepare(`
    UPDATE occurrences
    SET status = @status,
        updated_at = @updated_at,
        version = @version,
        closed_at = @closed_at
    WHERE id = @id
  `).run({
    id: occurrence.id,
    status: updateFields.status,
    updated_at: updateFields.updated_at,
    version: updateFields.version,
    closed_at: Object.prototype.hasOwnProperty.call(extraUpdates, 'closed_at')
      ? extraUpdates.closed_at
      : occurrence.closed_at
  });

  db.prepare(`
    INSERT INTO status_history
      (occurrence_id, previous_status, new_status, changed_by, reason, changed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(occurrence.id, occurrence.status, newStatus, actorId, reason, changedAt);

  return db.prepare('SELECT * FROM occurrences WHERE id = ?').get(occurrence.id);
}

function getOccurrence(db, id, user) {
  const occurrence = db.prepare('SELECT * FROM occurrences WHERE id = ?').get(id);
  // Para evitar revelar a existência de chamados de outra unidade, a resposta é 404.
  if (!occurrence || !user.unitIds.includes(occurrence.unit_id)) {
    throw new HttpError(404, 'OCCURRENCE_NOT_FOUND', 'Ocorrência não encontrada.');
  }
  return occurrence;
}

function assertRole(user, roles) {
  if (!roles.includes(user.role)) {
    throw new HttpError(403, 'FORBIDDEN', 'Seu perfil não tem permissão para esta operação.');
  }
}

function assertUnitAccess(user, unitId) {
  if (!user.unitIds.includes(Number(unitId))) {
    throw new HttpError(404, 'UNIT_NOT_FOUND', 'Unidade não encontrada.');
  }
}

function assertAssignedTechnician(occurrence, user) {
  if (user.role !== 'TECNICO' || occurrence.assigned_technician_id !== user.id) {
    throw new HttpError(403, 'TECHNICIAN_NOT_ASSIGNED', 'Somente o técnico atribuído pode executar esta ação.');
  }
}

function calculateActiveMinutes(db, occurrenceId, currentStatus) {
  const events = db.prepare(`
    SELECT new_status, changed_at
    FROM status_history
    WHERE occurrence_id = ?
    ORDER BY changed_at ASC, id ASC
  `).all(occurrenceId);

  if (events.length === 0) return 0;
  const end = Date.now();
  let milliseconds = 0;

  for (let index = 0; index < events.length; index += 1) {
    const startAt = new Date(events[index].changed_at).getTime();
    const nextAt = index + 1 < events.length
      ? new Date(events[index + 1].changed_at).getTime()
      : end;
    const status = events[index].new_status;

    if (ACTIVE_STATUSES.has(status) && Number.isFinite(startAt) && nextAt >= startAt) {
      milliseconds += nextAt - startAt;
    }
  }

  // O parâmetro é mantido para deixar explícito que o estado atual também faz parte da linha do tempo.
  if (currentStatus === 'PAUSADA' || currentStatus === 'ENCERRADA') {
    // O último intervalo já foi desconsiderado pelo status gravado no histórico.
  }

  return Math.floor(milliseconds / 60000);
}

function toOccurrenceDto(db, occurrence) {
  const unit = db.prepare('SELECT id, code, name FROM units WHERE id = ?').get(occurrence.unit_id);
  const requester = db.prepare('SELECT id, name FROM users WHERE id = ?').get(occurrence.requester_id);
  const technician = occurrence.assigned_technician_id
    ? db.prepare('SELECT id, name, is_external AS isExternal FROM users WHERE id = ?').get(occurrence.assigned_technician_id)
    : null;
  const serviceRecords = db.prepare(`
    SELECT sr.id, sr.diagnosis, sr.solution, sr.performed_at AS performedAt,
           u.id AS technicianId, u.name AS technicianName
    FROM service_records sr
    JOIN users u ON u.id = sr.technician_id
    WHERE sr.occurrence_id = ?
    ORDER BY sr.performed_at ASC
  `).all(occurrence.id);
  const related = db.prepare(`
    SELECT related_occurrence_id AS id FROM related_occurrences WHERE occurrence_id = ?
    UNION
    SELECT occurrence_id AS id FROM related_occurrences WHERE related_occurrence_id = ?
  `).all(occurrence.id, occurrence.id);
  const activePause = db.prepare(`
    SELECT id, reason, started_at AS startedAt
    FROM service_pauses WHERE occurrence_id = ? AND ended_at IS NULL
  `).get(occurrence.id);

  return {
    id: occurrence.id,
    unidade: unit,
    solicitante: requester,
    descricao: occurrence.description,
    local: occurrence.location,
    dataOcorrencia: occurrence.occurred_at,
    categoria: occurrence.category,
    prioridade: occurrence.priority,
    status: occurrence.status,
    tecnicoResponsavel: technician,
    atendimentos: serviceRecords,
    ocorrenciasRelacionadas: related.map((item) => item.id),
    pausaAtiva: activePause || null,
    metricas: {
      tempoAtendimentoMinutos: calculateActiveMinutes(db, occurrence.id, occurrence.status)
    },
    criadoEm: occurrence.created_at,
    atualizadoEm: occurrence.updated_at,
    encerradoEm: occurrence.closed_at,
    versao: occurrence.version
  };
}

function ensureSupervisor(user) {
  assertRole(user, ['SUPERVISOR']);
}

module.exports = {
  nowIso,
  addHistory,
  changeStatus,
  getOccurrence,
  assertRole,
  assertUnitAccess,
  assertAssignedTechnician,
  calculateActiveMinutes,
  toOccurrenceDto,
  ensureSupervisor,
  randomUUID
};
