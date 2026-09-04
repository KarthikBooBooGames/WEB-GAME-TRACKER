/* WebGL Line — static server for Railway. No dependencies.
   Serves /public and generates /config.js from environment variables so no keys live in the repo. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');

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
    boardId: process.env.BOARD_ID || 'main',
    sheet: !!(process.env.SHEET_WEBAPP_URL && process.env.SHEET_TOKEN)
  };
  return 'window.LINE_CONFIG=' + JSON.stringify(cfg) + ';';
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

/* Apps Script answers /exec with a 302 to script.googleusercontent.com and expects the POST replayed there,
   so follow redirects by re-POSTing rather than falling back to GET. */
function postJson(url, data, hops, cb) {
  let u; try { u = new URL(url); } catch (e) { return cb(e); }
  const rq = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, resp => {
    if (resp.statusCode > 299 && resp.statusCode < 400 && resp.headers.location && hops > 0) {
      resp.resume();
      return postJson(new URL(resp.headers.location, url).toString(), data, hops - 1, cb);
    }
    let body = '';
    resp.on('data', c => { body += c; });
    resp.on('end', () => cb(null, resp.statusCode, body));
  });
  rq.on('error', cb);
  rq.setTimeout(20000, () => rq.destroy(new Error('timeout')));
  rq.end(data);
}

/* The browser never sees the script URL or the token: it posts here and this adds them. */
function sheetProxy(req, res) {
  const url = process.env.SHEET_WEBAPP_URL, token = process.env.SHEET_TOKEN;
  if (!url || !token) return json(res, 200, { ok: false, error: 'not_configured' });
  let body = '', over = false;
  req.on('data', c => { body += c; if (body.length > 8e6) { over = true; req.destroy(); } });
  req.on('end', () => {
    if (over) return json(res, 413, { ok: false, error: 'too_big' });
    let payload;
    try { payload = JSON.parse(body); } catch (e) { return json(res, 400, { ok: false, error: 'bad_json' }); }
    payload.token = token;
    postJson(url, JSON.stringify(payload), 3, (err, code, out) => {
      if (err) return json(res, 200, { ok: false, error: 'upstream', detail: String(err.message || err) });
      let parsed = null; try { parsed = JSON.parse(out); } catch (e) {}
      if (!parsed) return json(res, 200, { ok: false, error: 'upstream', detail: 'HTTP ' + code + ' from Apps Script (check the deployment allows Anyone)' });
      return json(res, 200, parsed);
    });
  });
}

http.createServer((req, res) => {
  let u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/config.js') {
    res.writeHead(200, { 'content-type': MIME['.js'], 'cache-control': 'no-store' });
    return res.end(configJs());
  }
  if (u === '/sheet') {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'post_only' });
    return sheetProxy(req, res);
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
}).listen(PORT, () => console.log('WebGL Line on port ' + PORT + (process.env.SUPABASE_URL ? ' (Supabase)' : ' (local mode, no Supabase configured)') + (process.env.SHEET_WEBAPP_URL && process.env.SHEET_TOKEN ? ' + Google Sheet archive' : '')));
