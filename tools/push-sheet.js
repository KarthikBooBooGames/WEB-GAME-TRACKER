/* Pushes a complete backup of the board into the Google Sheet archive in one shot.
   Run: npm run push:sheet            (pulls the live board, or falls back to the starting board)
        npm run push:sheet -- --file backup.json     (a "Download full JSON" export)
        npm run push:sheet -- --seed                 (the starting board, ignoring everything else)

   Unlike the browser sync this always writes the Board tab too, so a fresh sheet comes out
   fully populated. Reads .env; never prints the URL, the token or the passcode. */
const fs = require('fs');
const path = require('path');
const https = require('https');
const Line = require(path.join(__dirname, '..', 'public', 'sched.js'));
const seed = require('./seed.js');

try {
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
} catch (e) { /* no .env, use the real environment */ }

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const has = k => argv.indexOf(k) >= 0;

const SHEET_URL = (process.env.SHEET_WEBAPP_URL || '').trim();
const SHEET_TOKEN = (process.env.SHEET_TOKEN || '').trim();
const SB_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SB_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();
const BOARD = (process.env.BOARD_ID || 'main').trim();
const PASS = (arg('--pass') || process.env.BOARD_PASSCODE || '').trim();

function die(msg, hint) {
  console.log('\n  ✗ ' + msg);
  if (hint) console.log('    ' + hint.split('\n').join('\n    '));
  console.log('');
  process.exit(1);
}
if (!SHEET_URL || !SHEET_TOKEN) die('SHEET_WEBAPP_URL and SHEET_TOKEN are not both set in .env.');

/* Two things Apps Script insists on, both learned the hard way:
   - the body must go as text/plain. It reads e.postData.contents itself, and with
     application/json the page it redirects to answers 404.
   - the 302 must be followed with GET. doPost has already run by then; the redirect only
     carries the answer, and re-POSTing to it is refused with 405. */
const UA = 'webgl-line/1.0';
function call(method, url, data, hops, cb) {
  let u;
  try { u = new URL(url); } catch (e) { return cb(e); }
  const supabase = u.hostname.endsWith('supabase.co');
  const headers = Object.assign(
    { 'user-agent': UA },
    data ? { 'content-type': supabase ? 'application/json' : 'text/plain;charset=utf-8', 'content-length': Buffer.byteLength(data) } : {},
    supabase ? { apikey: SB_KEY, authorization: 'Bearer ' + SB_KEY, accept: 'application/json' } : {}
  );
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
  rq.setTimeout(30000, () => rq.destroy(new Error('timed out after 30s')));
  rq.end(data);
}

/* ---- pick a source ---- */
function fromSeed(why) {
  console.log('  source: the starting board (' + why + ')');
  return { state: seed(), key: 'manual-' + new Date().toISOString().slice(0, 19).replace('T', ' ') };
}
function loadState(cb) {
  const file = arg('--file');
  if (file) {
    let obj;
    try { obj = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return die('Could not read ' + file + ': ' + e.message); }
    if (!obj || !obj.games || !obj.settings || !obj.people) {
      return die(file + ' is not a WebGL Line JSON backup.', 'Use the file from Plan → Backup → Download full JSON.');
    }
    console.log('  source: ' + path.basename(file) + ' (' + obj.games.length + ' games)');
    return cb({ state: obj, key: 'manual-' + new Date().toISOString().slice(0, 19).replace('T', ' ') });
  }
  if (has('--seed')) return cb(fromSeed('--seed'));
  if (!SB_URL || !SB_KEY) return cb(fromSeed('no Supabase configured in .env'));
  if (!PASS) {
    return die('Supabase is configured but no board passcode was given.',
      'Add BOARD_PASSCODE=... to .env, or pass --pass <passcode>.\n' +
      'Or push a downloaded export instead:  npm run push:sheet -- --file backup.json');
  }
  console.log('  source: the live Supabase board, pulling…');
  call('POST', SB_URL + '/rest/v1/rpc/board_get', JSON.stringify({ p_id: BOARD, p_pass: PASS }), 3, (err, code, body) => {
    if (err) return die('Could not reach Supabase: ' + (err.message || err));
    let j = null;
    try { j = JSON.parse(body); } catch (e) {}
    if (!j) return die('Supabase returned HTTP ' + code + ' and not JSON.');
    if (!j.ok && j.error === 'bad_passcode') return die('Supabase rejected the board passcode.');
    if (!j.ok) return die('Supabase error: ' + JSON.stringify(j));
    if (!j.found) return cb(fromSeed('the board row does not exist yet'));
    console.log('  pulled version ' + j.version + ' (' + j.state.games.length + ' games, ' + (j.state.log || []).length + ' log entries)');
    cb({ state: j.state, key: 'v' + j.version });
  });
}

/* ---- push ---- */
console.log('\nFull backup into the Google Sheet…');
loadState(src => {
  const state = Line.backfillLogIds(src.state);
  if (!state.settings.tiers) die('That board has no tier settings, so it cannot be planned.');
  const today = Line.toISO(new Date());
  const P = Line.fit(state, today).plan;
  const payload = Line.sheetPayload(state, P, {
    key: src.key,
    at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    by: 'full backup'
  });

  const nonKit = state.games.filter(g => g.tier !== 'K').length;
  console.log('  sending: ' + payload.activity.length + ' activity rows, 1 snapshot, ' +
    (payload.board.length - 1) + ' board rows (' + nonKit + ' games + kit)');
  console.log('  payload size: ' + Math.round(JSON.stringify(payload).length / 1024) + ' KB');

  call('POST', SHEET_URL, JSON.stringify(Object.assign({ token: SHEET_TOKEN }, payload)), 3, (err, code, body) => {
    if (err) die('Could not reach the archive: ' + (err.message || err));
    let r = null;
    try { r = JSON.parse(body); } catch (e) {}
    if (!r) {
      die('HTTP ' + code + ' and the answer was not JSON.',
        /Access denied|Sign in|accounts\.google\.com/i.test(body)
          ? 'The deployment is not public. Deploy → Manage deployments → edit (pencil) →\n' +
            '"Who has access" → Anyone → Deploy.'
          : 'Check that the /exec URL points at the current deployment.');
    }
    if (r.error === 'bad_token') {
      die('The archive rejected the token.',
        'SHEET_TOKEN in .env must equal TOKEN at the top of Code.gs. It is a string you invent,\n' +
        'not the deployment id and not part of the URL. If you changed Code.gs, redeploy as a New version.');
    }
    if (!r.ok) die('The archive returned an error: ' + JSON.stringify(r));

    console.log('\n  ✓ written');
    console.log('    Activity  : ' + r.activity + ' new rows' + (r.activity === 0 ? ' (all were already there)' : ''));
    console.log('    Snapshots : ' + r.snapshot + ' new row' + (r.snapshot === 0 ? ' (this version was already archived)' : ''));
    console.log('    Board     : ' + r.board + ' game rows, rewritten to match');
    console.log('\n  Open the sheet — the Board, Activity and Snapshots tabs are populated.\n');
  });
});
