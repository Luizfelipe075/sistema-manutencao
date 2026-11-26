const schema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SOLICITANTE', 'SUPERVISOR', 'TECNICO', 'RESPONSAVEL_UNIDADE')),
  is_external INTEGER NOT NULL DEFAULT 0 CHECK (is_external IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_units (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, unit_id)
);

CREATE TABLE IF NOT EXISTS occurrences (
  id TEXT PRIMARY KEY,
  unit_id INTEGER NOT NULL REFERENCES units(id),
  requester_id TEXT NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,
  location TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  category TEXT,
  priority TEXT CHECK (priority IN ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA')),
  status TEXT NOT NULL DEFAULT 'ABERTA' CHECK (status IN ('ABERTA', 'EM_ATENDIMENTO', 'PAUSADA', 'AGUARDANDO_CONFIRMACAO', 'ENCERRADA', 'REABERTA')),
  assigned_technician_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_occurrences_unit_status ON occurrences(unit_id, status);
CREATE INDEX IF NOT EXISTS idx_occurrences_assignee ON occurrences(assigned_technician_id);

CREATE TABLE IF NOT EXISTS related_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
  related_occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'DUPLICADA',
  confirmed_same_problem INTEGER NOT NULL DEFAULT 1 CHECK (confirmed_same_problem IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (occurrence_id, related_occurrence_id),
  CHECK (occurrence_id <> related_occurrence_id)
);

CREATE TABLE IF NOT EXISTS service_records (
  id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
  technician_id TEXT NOT NULL REFERENCES users(id),
  diagnosis TEXT NOT NULL,
  solution TEXT NOT NULL,
  performed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_pauses (
  id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
  started_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_by TEXT REFERENCES users(id),
  ended_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_pause_per_occurrence
ON service_pauses(occurrence_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  changed_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT,
  changed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS occurrence_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES users(id),
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  occurrence_id TEXT NOT NULL REFERENCES occurrences(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC', 'UNIT_ONLY')),
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
`;

function initializeSchema(db) {
  db.exec(schema);
}

module.exports = { initializeSchema };
