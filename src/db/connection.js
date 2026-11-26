const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { databasePath } = require('../config/env');
const { initializeSchema } = require('./schema');

function createDatabase(filePath = databasePath) {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const nativeDb = new DatabaseSync(filePath);
  nativeDb.exec('PRAGMA foreign_keys = ON');
  nativeDb.exec('PRAGMA journal_mode = WAL');
  nativeDb.exec('PRAGMA busy_timeout = 5000');

  // A pequena camada mantém as transações legíveis nos serviços do projeto.
  const db = {
    exec: (sql) => nativeDb.exec(sql),
    prepare: (sql) => nativeDb.prepare(sql),
    pragma: (sql) => nativeDb.exec(`PRAGMA ${sql}`),
    close: () => nativeDb.close(),
    transaction(callback) {
      return (...args) => {
        nativeDb.exec('BEGIN IMMEDIATE');
        try {
          const result = callback(...args);
          nativeDb.exec('COMMIT');
          return result;
        } catch (error) {
          nativeDb.exec('ROLLBACK');
          throw error;
        }
      };
    }
  };

  initializeSchema(db);
  return db;
}

module.exports = { createDatabase };
