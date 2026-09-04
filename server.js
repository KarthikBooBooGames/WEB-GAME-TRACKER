/* WebGL Line — static server for Railway. No dependencies.
   Serves /public and generates /config.js from environment variables so no keys live in the repo. */
const http = require('http');
const fs = require('fs');
const path = require('path');

/* Local development: a .env file next to this script is read if present (Railway uses real environment variables). */
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* no .env, fine */ }

const PUB = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

function configJs() {
  const cfg = {
    supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    boardId: process.env.BOARD_ID || 'main'
  };
  return 'window.LINE_CONFIG=' + JSON.stringify(cfg) + ';';
}

http.createServer((req, res) => {
  let u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/config.js') {
    res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' });
    return res.end(configJs());
  }
  if (u === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
  if (u === '/' || u === '') u = '/index.html';
  const f = path.normalize(path.join(PUB, u));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(f, (err, body) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    const ext = path.extname(f).toLowerCase();
    /* Small app, deploys often: always revalidate so a redeploy is live on the next load. */
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  });
}).listen(PORT, () => console.log('WebGL Line on port ' + PORT + (process.env.SUPABASE_URL ? ' (Supabase)' : ' (local mode, no Supabase configured)')));
