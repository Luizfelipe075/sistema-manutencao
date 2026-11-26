const fs = require('node:fs');
const path = require('node:path');

// Swagger UI servido pelo próprio servidor, a partir do pacote swagger-ui-dist.
// A interface fica em /docs e lê o contrato em /openapi.json.
let distDir = null;
try {
  distDir = path.dirname(require.resolve('swagger-ui-dist/package.json'));
} catch {
  distDir = null; // sem npm install: /docs mostra uma página de aviso
}

const ASSETS = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8'
};
const ALLOWED = new Set([
  'swagger-ui.css',
  'swagger-ui-bundle.js',
  'favicon-16x16.png',
  'favicon-32x32.png'
]);

const PAGE = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>API de Ocorrências de Manutenção - Swagger</title>
<link rel="icon" type="image/png" href="/docs/favicon-32x32.png">
<link rel="stylesheet" href="/docs/swagger-ui.css">
<style>body{margin:0}.swagger-ui .topbar{display:none}</style>
</head>
<body>
<div id="swagger-ui"></div>
<script src="/docs/swagger-ui-bundle.js"></script>
<script>
window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    persistAuthorization: true,
    displayRequestDuration: true,
    tryItOutEnabled: true,
    docExpansion: 'list',
    filter: true,
    presets: [SwaggerUIBundle.presets.apis]
  });
};
</script>
</body>
</html>`;

const MISSING = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Swagger indisponível</title></head><body style="font-family:system-ui;max-width:700px;margin:48px auto"><h1>Swagger UI não instalado</h1><p>Execute <code>npm install</code> na pasta do projeto e reinicie a API.</p><p>Enquanto isso, o contrato continua em <a href="/openapi.json">/openapi.json</a>.</p></body></html>`;

// Retorna true quando a requisição foi atendida.
function serveSwagger(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  if (pathname !== '/docs' && !pathname.startsWith('/docs/')) return false;

  if (pathname === '/docs' || pathname === '/docs/') {
    res.writeHead(distDir ? 200 : 503, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : distDir ? PAGE : MISSING);
    return true;
  }

  const name = pathname.slice('/docs/'.length);
  if (!distDir || !ALLOWED.has(name)) return false;
  const filePath = path.join(distDir, name);
  if (!fs.existsSync(filePath)) return false;
  res.writeHead(200, { 'Content-Type': ASSETS[path.extname(name)] || 'application/octet-stream' });
  res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(filePath));
  return true;
}

module.exports = { serveSwagger };
