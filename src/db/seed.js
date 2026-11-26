const { hashPassword } = require('../utils/security');

const DEMO_PASSWORD = 'Demo@123';

function seedDatabase(db) {
  const unitCount = db.prepare('SELECT COUNT(*) AS total FROM units').get().total;
  if (unitCount > 0) return;

  const now = new Date().toISOString();
  const insertUnit = db.prepare('INSERT INTO units (id, code, name, created_at) VALUES (?, ?, ?, ?)');
  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, is_external, created_at)
    VALUES (@id, @name, @email, @passwordHash, @role, @isExternal, @createdAt)
  `);
  const grantUnit = db.prepare('INSERT INTO user_units (user_id, unit_id) VALUES (?, ?)');
  const passwordHash = hashPassword(DEMO_PASSWORD);

  const transaction = db.transaction(() => {
    const units = [
      [1, 'CER', 'Unidade Ceres'],
      [2, 'RIA', 'Unidade Rialma'],
      [3, 'URU', 'Unidade Uruana'],
      [4, 'GOI', 'Unidade Goiânia'],
      [5, 'ANA', 'Unidade Anápolis']
    ];
    for (const [id, code, name] of units) insertUnit.run(id, code, name, now);

    const users = [
      { id: 'user-solicitante-01', name: 'Marina Solicitante', email: 'solicitante@demo.local', role: 'SOLICITANTE', isExternal: 0, unitIds: [1] },
      { id: 'user-supervisor-01', name: 'Carlos Supervisor', email: 'supervisor@demo.local', role: 'SUPERVISOR', isExternal: 0, unitIds: [1, 2, 3, 4, 5] },
      { id: 'user-tecnico-01', name: 'João Técnico', email: 'tecnico@demo.local', role: 'TECNICO', isExternal: 0, unitIds: [1] },
      { id: 'user-terceirizado-01', name: 'Pedro Terceirizado', email: 'terceirizado@demo.local', role: 'TECNICO', isExternal: 1, unitIds: [1] },
      { id: 'user-responsavel-01', name: 'Ana Responsável', email: 'responsavel@demo.local', role: 'RESPONSAVEL_UNIDADE', isExternal: 0, unitIds: [1] }
    ];

    for (const user of users) {
      insertUser.run({
        id: user.id,
        name: user.name,
        email: user.email,
        passwordHash,
        role: user.role,
        isExternal: user.isExternal,
        createdAt: now
      });
      for (const unitId of user.unitIds) grantUnit.run(user.id, unitId);
    }
  });

  transaction();
}

module.exports = { seedDatabase, DEMO_PASSWORD };
