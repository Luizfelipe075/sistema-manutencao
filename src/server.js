const http = require('node:http');
const { createDatabase } = require('./db/connection');
const { seedDatabase } = require('./db/seed');
const { createApp } = require('./app');
const { port } = require('./config/env');

const db = createDatabase();
seedDatabase(db);
const server = http.createServer(createApp({ db }));

server.listen(port, () => {
  console.log(`API disponível em http://localhost:${port}`);
  console.log(`Documentação: http://localhost:${port}/docs`);
  console.log('As contas de demonstração estão descritas no README.md.');
});

function shutdown(signal) {
  console.log(`\n${signal} recebido. Encerrando a API...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
