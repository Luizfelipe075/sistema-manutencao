const fs = require('node:fs');
const path = require('node:path');
const HttpError = require('./utils/http-error');
const { createRouter, readJsonBody, getAuthenticatedUser, normalizePath } = require('./http/router');
const { registerRoutes } = require('./routes/register');
const { serveSwagger } = require('./swagger');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png'
};
const PUBLIC_DIR = path.resolve(__dirname, 'public');

// Serve o front-end (src/public). Retorna true quando a requisição foi atendida.
function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return false; // bloqueia path traversal
  const type = MIME[path.extname(filePath).toLowerCase()];
  if (!type || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  res.writeHead(200, { 'Content-Type': type });
  res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(filePath));
  return true;
}

function createApp({ db }) {
  if (!db) throw new Error('A conexão com o banco de dados é obrigatória.');
  const router = createRouter();
  registerRoutes(router, db);

  // A cópia em src funciona como segurança caso a pasta docs não seja copiada
  // por completo durante a extração do projeto no Windows.
  const openApiCandidates = [
    path.resolve(__dirname, '../docs/openapi.json'),
    path.resolve(__dirname, 'openapi.json'),
    path.resolve(process.cwd(), 'docs/openapi.json')
  ];
  const openApiPath = openApiCandidates.find((candidate) => fs.existsSync(candidate));

  if (!openApiPath) {
    throw new Error(
      `Arquivo OpenAPI não encontrado. Verifique se docs/openapi.json foi extraído. Caminhos verificados: ${openApiCandidates.join(', ')}`
    );
  }

  const openApiDocument = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));

  return async function handleRequest(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');

    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = normalizePath(url.pathname);

      if (req.method === 'GET' && pathname === '/openapi.json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(openApiDocument, null, 2));
        return;
      }

      if (serveSwagger(req, res, pathname)) return;

      if (serveStatic(req, res, pathname)) return;

      const route = router.find(req.method, pathname);
      if (!route) throw new HttpError(404, 'ROUTE_NOT_FOUND', 'Rota não encontrada.');
      const body = await readJsonBody(req);
      const user = route.options.auth ? getAuthenticatedUser(db, req) : null;
      if (route.options.roles && !route.options.roles.includes(user?.role)) {
        throw new HttpError(403, 'FORBIDDEN', 'Seu perfil não tem permissão para esta operação.');
      }

      const result = await route.handler({ req, params: route.params, query: url.searchParams, body, user });
      const status = result && typeof result.status === 'number' ? result.status : 200;
      const payload = result && typeof result.status === 'number' && Object.hasOwn(result, 'body')
        ? result.body
        : result;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    } catch (error) {
      const known = error instanceof HttpError;
      const status = known ? error.status : 500;
      if (!known) console.error(error);
      const payload = {
        error: {
          code: known ? error.code : 'INTERNAL_SERVER_ERROR',
          message: known ? error.message : 'Ocorreu um erro interno. Tente novamente.'
        }
      };
      if (known && error.details !== undefined) payload.error.details = error.details;
      if (!known && process.env.NODE_ENV !== 'production') payload.error.debug = error.message;
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    }
  };
}

module.exports = { createApp };
