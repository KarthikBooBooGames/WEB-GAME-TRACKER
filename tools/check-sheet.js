/* Verifies the Google Sheet archive is wired up. Run: npm run check:sheet
   Reads .env (or real environment variables) and never prints the URL or the token.

   Pass 1 is a GET, which writes nothing: it proves the deployment exists and is reachable.
   Pass 2 posts one activity row and one snapshot, both keyed 'setup-check', so running this
   ten times still leaves exactly one of each. It sends no board rows, so your Board tab is
   left alone. Add --probe-only to skip pass 2 entirely. */
const fs = require('fs');
const path = require('path');
const https = require('https');

try {
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* no .env, use the real environment */ }

const URL_ = (process.env.SHEET_WEBAPP_URL || '').trim();
const TOKEN = (process.env.SHEET_TOKEN || '').trim();
const probeOnly = process.argv.indexOf('--probe-only') >= 0;

function die(msg, hint) {
  console.log('\n  ✗ ' + msg);
  if (hint) console.log('    ' + hint.split('\n').join('\n    '));
  console.log('');
  process.exit(1);
}

if (!URL_ || !TOKEN) {
  die('SHEET_WEBAPP_URL and SHEET_TOKEN are not both set.',
    'Open .env and fill in the two values under "Google Sheet archive".');
}
if (URL_.indexOf('YOUR-DEPLOYMENT-ID') >= 0 || TOKEN.indexOf('matching-TOKEN') >= 0) {
  die('Those are still the placeholder values.', 'Open .env and paste your real Web app URL and token.');
}
if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(URL_)) {
  die('SHEET_WEBAPP_URL does not look like an Apps Script Web app URL.',
    'It must be the /exec URL from Deploy → Manage deployments, shaped like:\n' +
    'https://script.google.com/macros/s/AKfy.../exec\n' +
    'A /dev URL only works while you are signed in, so it will not work from the server.');
}

/* Two things Apps Script insists on, both learned the hard way:
   - the body must go as text/plain. It reads e.postData.contents itself, and with
     application/json the page it redirects to answers 404.
   - the 302 must be followed with GET. doPost has already run by then; the redirect only
     carries the answer, and re-POSTing to it is refused with 405. */
const UA = 'webgl-line/1.0';
function call(method, url, data, hops, cb) {
  let u;
  try { u = new URL(url); } catch (e) { return cb(e); }
  const headers = data
    ? { 'content-type': 'text/plain;charset=utf-8', 'content-length': Buffer.byteLength(data), 'user-agent': UA }
    : { 'user-agent': UA };
  const rq = https.request({ hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search, method, headers }, resp => {
    if (resp.statusCode > 299 && resp.statusCode < 400 && resp.headers.location && hops > 0) {
      resp.resume();
      return call('GET', new URL(resp.headers.location, url).toString(), null, hops - 1, cb);
    }
    let body = '';
    resp.on('data', c => { body += c; });
    resp.on('end', () => cb(null, resp.statusCode, body));
  });
  rq.on('error', cb);
  rq.setTimeout(20000, () => rq.destroy(new Error('timed out after 20s')));
  rq.end(data);
}

/* An HTML answer means Google served a sign-in or error page rather than the script. */
function explainHtml(body) {
  if (/accounts\.google\.com|Sign in/i.test(body)) {
    return 'Google returned a sign-in page, so the deployment is not public.\n' +
      'Deploy → Manage deployments → edit → set "Who has access" to Anyone, then Deploy again.';
  }
  if (/Script function not found|doGet/i.test(body)) {
    return 'The deployment does not have a doGet. Make sure the whole of google/Code.gs is pasted in,\n' +
      'then create a NEW version: Deploy → Manage deployments → edit → Version: New version → Deploy.';
  }
  return 'Expected JSON but got an HTML page. Usually the deployment is not set to "Anyone",\n' +
    'or the URL points at an old deployment. Redeploy and copy the /exec URL again.';
}

console.log('\nChecking the Google Sheet archive…');
console.log('  URL and token: present, shape looks right');

call('GET', URL_, null, 3, (err, code, body) => {
  if (err) die('Could not reach the deployment: ' + (err.message || err), 'Check the URL, and that you are online.');
  let j = null;
  try { j = JSON.parse(body); } catch (e) {}
  if (!j) die('HTTP ' + code + ', and the answer was not JSON.', explainHtml(body));
  if (j.service !== 'webgl-line-archive') {
    die('Reached a script, but it is not this archive (service: ' + JSON.stringify(j.service) + ').',
      'That URL belongs to a different Apps Script project.');
  }
  console.log('  ✓ deployment is live and public (no rows written)');

  if (probeOnly) { console.log('\n  Probe only — stopping before the write test.\n'); return; }

  const at = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const payload = JSON.stringify({
    token: TOKEN,
    activity: [{ id: 'setup-check', t: at, who: 'setup', msg: 'Archive connected — written by npm run check:sheet', k: '' }],
    snapshot: { key: 'setup-check', at: at, by: 'setup', games: 0, shipped: 0, json: '{"note":"setup check, not a real board"}' }
    /* deliberately no board rows: writeBoard is a no-op without them, so the Board tab is untouched */
  });

  call('POST', URL_, payload, 3, (err2, code2, body2) => {
    if (err2) die('The write test could not reach the deployment: ' + (err2.message || err2));
    let r = null;
    try { r = JSON.parse(body2); } catch (e) {}
    if (!r) die('HTTP ' + code2 + ' on the write test, and the answer was not JSON.', explainHtml(body2));
    if (r.error === 'bad_token') {
      die('The deployment rejected the token.',
        'SHEET_TOKEN in .env must match TOKEN at the top of Code.gs exactly.\n' +
        'If you changed Code.gs, redeploy as a New version — editing alone does not update the live web app.');
    }
    if (!r.ok) die('The archive returned an error: ' + JSON.stringify(r));

    console.log('  ✓ token accepted, write succeeded');
    console.log('    activity rows added this run: ' + r.activity + '   snapshot rows added: ' + r.snapshot);
    if (r.activity === 0 && r.snapshot === 0) console.log('    (0 and 0 just means you have run this before — the dedupe is working)');
    console.log('\n  Archive is connected. Open the sheet: the Activity and Snapshots tabs now exist.');
    console.log('  Set the same two variables on Railway and the live board will fill them in.\n');
  });
});
