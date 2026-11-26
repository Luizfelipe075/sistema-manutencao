const fs = require('node:fs');
const { databasePath } = require('../config/env');
const { createDatabase } = require('./connection');
const { seedDatabase } = require('./seed');

if (databasePath !== ':memory:' && fs.existsSync(databasePath)) {
  fs.rmSync(databasePath, { force: true });
  fs.rmSync(`${databasePath}-wal`, { force: true });
  fs.rmSync(`${databasePath}-shm`, { force: true });
}

const db = createDatabase(databasePath);
seedDatabase(db);
db.close();
console.log('Banco recriado e contas de demonstração cadastradas.');
