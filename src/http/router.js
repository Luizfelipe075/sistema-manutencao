const HttpError = require('../utils/http-error');
const { verifyToken } = require('../utils/security');
const MAX_BODY_SIZE = 1024 * 1024;

function response(status, body) {
  return { status, body };
}

function normalizePath(pathname) {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

function compilePath(pattern) {
  const names = [];
  const source = pattern.split('/').map((segment) => {
    if (segment.startsWith(':')) {
      names.push(segment.slice(1));
      return '([^/]+)';
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { regex: new RegExp(`^${source}$`), names };
}

function createRouter() {
  const routes = [];
  return {
    add(method, pattern, options, handler) {
      const compiled = compilePath(pattern);
      routes.push({ method: method.toUpperCase(), pattern, ...compiled, options: options || {}, handler });
    },
    find(method, pathname) {
      for (const route of routes) {
        if (route.method !== method.toUpperCase()) continue;
        const match = route.regex.exec(pathname);
        if (!match) continue;
        const params = {};
        route.names.forEach((name, index) => {
          try {
            params[name] = decodeURIComponent(match[index + 1]);
          } catch {
            throw new HttpError(400, 'INVALID_PATH_PARAMETER', 'Um parâmetro da rota contém caracteres inválidos.');
          }
        });
        return { ...route, params };
      }
      return null;
    }
  };
}

async function readJsonBody(req) {
  if (['GET', 'HEAD'].includes(req.method)) return {};
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    if (req.headers['content-length'] === '0' || !req.headers['content-length']) return {};
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Envie o corpo da requisição no formato application/json.');
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'O corpo da requisição ultrapassa 1 MB.');
    chunks.push(chunk);
  }
  if (size === 0) return {};

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('O corpo deve ser um objeto JSON.');
    }
    return parsed;
  } catch (error) {
    throw new HttpError(400, 'INVALID_JSON', 'O corpo da requisição não contém um JSON válido.');
  }
}

function getAuthenticatedUser(db, req) {
  const authorization = req.headers.authorization || '';
  const [scheme, token] = authorization.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Informe um token Bearer válido.');
  }

  const payload = verifyToken(token);
  if (!payload) throw new HttpError(401, 'INVALID_TOKEN', 'O token está inválido ou expirou.');

  const user = db.prepare(`
    SELECT id, name, email, role, is_external AS isExternal
    FROM users WHERE id = ?
  `).get(payload.sub);
  if (!user) throw new HttpError(401, 'UNAUTHENTICATED', 'A conta associada ao token não está disponível.');

  const units = db.prepare('SELECT unit_id FROM user_units WHERE user_id = ? ORDER BY unit_id').all(user.id);
  return {
    ...user,
    isExternal: Boolean(user.isExternal),
    unitIds: units.map((item) => item.unit_id)
  };
}

module.exports = {
  response,
  normalizePath,
  createRouter,
  readJsonBody,
  getAuthenticatedUser
};
