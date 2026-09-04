/* WebGL Line — app. Plain JS, no framework. State is one JSON document shared through Supabase (or this browser in local mode). */
(function () {
'use strict';
var $ = function (s, el) { return (el || document).querySelector(s); };
var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
var S = Line.STAGES, ST = Line.STAGE, HRS = Line.H;
var CFG = window.LINE_CONFIG || {};
var ONLINE = !!(CFG.supabaseUrl && CFG.anonKey);
var BOARD = CFG.boardId || 'main';
var SHEET = !!CFG.sheet;
var TODAY = Line.toISO(new Date());
var state = null, version = 0, F = null, P = null;
var me = null; try { me = localStorage.getItem('line.me'); } catch (e) {}
var pass = ''; try { pass = localStorage.getItem('line.pass') || ''; } catch (e) {}
var passBad = false, loading = false;
var ui = { tab: 'today', week: null, filter: 'all', open: null, stuckFor: null, confirm: null, openKeys: {}, importText: '' };
try { var savedTab = sessionStorage.getItem('line.tab'); if (savedTab) ui.tab = savedTab; } catch (e) {}
var DONE_MSGS = ['Nice. ✓', 'One more off the line. ✓', 'Clean work. ✓', 'That is progress. ✓', 'Keep it rolling. ✓'];

function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function migrate(s) {
  if (!s.settings) s.settings = {};
  if (s.settings.target == null && s.settings.monthTarget != null) s.settings.target = s.settings.monthTarget;
  delete s.settings.monthTarget;
  if (!s.settings.order) s.settings.order = 'auto';
  if (!s.people) s.people = JSON.parse(JSON.stringify(window.SEED.people));
  if (!s.games) s.games = [];
  if (!s.log) s.log = [];
  Line.backfillLogIds(s);
  return s;
}
function replan() { F = Line.fit(state, TODAY); P = F.plan; }
function people() { return Object.keys(state.people); }
function team() { return people().filter(function (p) { return p !== 'producer'; }); }
function pname(p) { return Line.ownerName(state, p); }
function initial(p) { return pname(p).charAt(0).toUpperCase(); }
function byId(id) { for (var i = 0; i < state.games.length; i++) if (state.games[i].id === id) return state.games[i]; return null; }
function tierCls(g) { return g.tier || 'K'; }
function stageCls(k) { return 'st-' + ST[k].cls; }
function greeting() { var h = new Date().getHours(); return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'; }
function nonKit() { return state.games.filter(function (g) { return g.tier !== 'K'; }); }
function shippedList() { return nonKit().filter(function (g) { return P.info[g.id].shipped; }); }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function ownerOptions(cur) {
  var opts = people().map(function (p) { return '<option value="' + p + '"' + (cur === p ? ' selected' : '') + '>' + esc(pname(p)) + '</option>'; });
  ['dev', 'artist'].forEach(function (r) { if (Line.peopleWithRole(state, r).length) { var v = 'any:' + r; opts.push('<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>Any ' + r + ' (whoever is free)</option>'); } });
  return opts.join('');
}
function det(key, cls, summary, body) { return '<details class="' + cls + '" data-key="' + esc(key) + '"' + (ui.openKeys[key] ? ' open' : '') + '><summary>' + summary + '</summary>' + body + '</details>'; }
function haveByRole() { var h = {}; people().forEach(function (p) { var r = Line.roleOf(state, p); h[r] = (h[r] || 0) + 1; }); return h; }
/* the numbers every view shares */
function stats() {
  var total = nonKit().length, shipped = shippedList().length, d = state.settings.deadline;
  d = d && Line.validDate(d) ? d : null;
  var onPace = 0;
  nonKit().forEach(function (g) { var inf = P.info[g.id]; if (inf.shipped || (d && inf.eta && inf.eta <= d)) onPace++; });
  var fit = F.fit, effMin = 100;
  if (fit) Object.keys(fit.eff).forEach(function (r) { if (fit.load[r] > 0) effMin = Math.min(effMin, fit.eff[r]); });
  return { deadline: d, total: total, shipped: shipped, target: F.target, onPace: onPace, met: onPace >= F.target, wave2: total - onPace, fit: fit, effMin: effMin,
           need: Line.headcountAtFullEstimates(F), have: haveByRole() };
}
function roleTxt(map, roles) { return roles.map(function (r) { var n = map[r] || 0; return n + ' ' + r + (n === 1 ? '' : 's'); }).join(' and '); }
function effTxt(fit) { return Object.keys(fit.eff).filter(function (r) { return fit.load[r] > 0; }).map(function (r) { return fit.eff[r] + '% for ' + r + (r === 'dev' ? 's' : ''); }).join(', '); }

/* ---------- persistence ---------- */
var saveTimer = null, saving = false, dirty = false, pollTimer = null;
function setSave(txt, err) { var el = $('#saveState'); el.textContent = txt; el.className = 'save' + (err ? ' err' : ''); }
function rpc(fn, args) {
  return fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + CFG.anonKey, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(args) })
    .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) {} if (!r.ok) throw { code: 'http', status: r.status, body: j || t }; return j; }); });
}
function localSeed() { return migrate(JSON.parse(JSON.stringify(window.SEED))); }
function loadBoard() {
  if (!ONLINE) {
    var raw = null; try { raw = localStorage.getItem('line.state'); } catch (e) {}
    state = raw ? migrate(JSON.parse(raw)) : localSeed(); version = 0;
    setSave('Local mode · saves in this browser only');
    return Promise.resolve(true);
  }
  if (!pass) return Promise.resolve(false);
  loading = true;
  return rpc('board_get', { p_id: BOARD, p_pass: pass }).then(function (j) {
    loading = false;
    if (!j || !j.ok) { if (j && j.error === 'bad_passcode') { passBad = true; pass = ''; try { localStorage.removeItem('line.pass'); } catch (e) {} return false; } throw j; }
    passBad = false;
    if (!j.found) { state = localSeed(); version = 0; dirty = true; setSave('Setting up the board…'); saveNow(); return true; }
    state = migrate(j.state); version = j.version; setSave('Saved'); return true;
  }).catch(function (e) { loading = false; setSave('Cannot reach the board · retrying', true); setTimeout(boot, 6000); return false; });
}
function scheduleSave() {
  dirty = true; setSave('Unsaved…');
  clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, ONLINE ? 1500 : 300);
}
function saveNow() {
  if (!dirty || saving || !state) return;
  if (!ONLINE) { try { localStorage.setItem('line.state', JSON.stringify(state)); } catch (e) {} dirty = false; setSave('Saved on this device'); scheduleSheet(); return; }
  saving = true; setSave('Saving…');
  rpc('board_save', { p_id: BOARD, p_pass: pass, p_state: state, p_expected_version: version }).then(function (j) {
    saving = false;
    if (j && j.ok) { version = j.version; dirty = false; setSave('Saved ✓'); scheduleSheet(); return; }
    if (j && j.error === 'conflict') {
      state = migrate(j.state); version = j.version; dirty = false; replan(); render(); setSave('Saved');
      toast('Someone saved just before you. The board refreshed — please redo your last tap.', 'warn', 5000); return;
    }
    if (j && j.error === 'bad_passcode') { pass = ''; passBad = true; try { localStorage.removeItem('line.pass'); } catch (e) {} render(); return; }
    setSave('Save failed · retrying', true); saveTimer = setTimeout(saveNow, 4000);
  }).catch(function () { saving = false; setSave('Offline · will retry', true); saveTimer = setTimeout(saveNow, 5000); });
}
function poll() {
  if (!ONLINE || !state || !pass || dirty || saving || document.visibilityState !== 'visible') return;
  rpc('board_get', { p_id: BOARD, p_pass: pass }).then(function (j) {
    if (j && j.ok && j.found && j.version > version && !dirty) { state = migrate(j.state); version = j.version; replan(); render(); toast('Board updated by a teammate', '', 1400); }
  }).catch(function () {});
}
function startPolling() { clearInterval(pollTimer); pollTimer = setInterval(poll, 15000); }
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') poll(); });
window.addEventListener('beforeunload', function () { if (dirty && !saving && ONLINE) { try { navigator.sendBeacon && navigator.sendBeacon(CFG.supabaseUrl + '/rest/v1/rpc/board_save?apikey=' + encodeURIComponent(CFG.anonKey), new Blob([JSON.stringify({ p_id: BOARD, p_pass: pass, p_state: state, p_expected_version: version })], { type: 'application/json' })); } catch (e) {} } });

/* ---------- Google Sheet archive ---------- */
/* Every sync resends the whole activity log and the sheet skips ids it already holds. That costs a few
   kilobytes and buys self-healing: a backlog left behind by one browser going offline gets pushed by
   whoever saves next, because the log is shared state. */
var sheetTimer = null, sheetBusy = false, sheetAgain = false, sheetFails = 0, localKey = 0, sheetHeart = null;
var SHEET_EVERY = 3600000; /* hourly heartbeat, on top of the sync that every change already triggers */
function setSheet(txt, cls) { var el = $('#sheetState'); if (!el) return; el.textContent = txt || ''; el.className = 'sheet' + (cls ? ' ' + cls : ''); el.hidden = !txt; }
function scheduleSheet() { if (!SHEET) return; clearTimeout(sheetTimer); sheetTimer = setTimeout(syncSheet, 4000); }
function retrySheet() { clearTimeout(sheetTimer); sheetTimer = setTimeout(syncSheet, Math.min(60000, 5000 * Math.pow(2, Math.min(4, sheetFails)))); }
function syncSheet() {
  if (!SHEET || !state || !P) return;
  if (sheetBusy) { sheetAgain = true; return; }
  sheetBusy = true; setSheet('Sheet: saving…');
  var payload = Line.sheetPayload(state, P, {
    /* Online the version is the key, so a retry lands on the same row. Local mode has no version, so hold
       one timestamp until the sync actually succeeds rather than minting a new key per attempt. */
    key: ONLINE ? 'v' + version : 'L' + (localKey || (localKey = Date.now())),
    at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    by: me ? pname(me) : ''
  });
  fetch('/sheet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      sheetBusy = false;
      if (j && j.ok) { sheetFails = 0; localKey = 0; setSheet('Sheet ✓'); }
      else { sheetFails++; setSheet('Sheet: ' + ((j && j.error) || 'failed'), 'err'); retrySheet(); }
      if (sheetAgain) { sheetAgain = false; scheduleSheet(); }
    })
    .catch(function () { sheetBusy = false; sheetFails++; setSheet('Sheet: offline · will retry', 'err'); retrySheet(); });
}
/* Changes drive the sync; this is the backstop for a board left open with nothing happening.
   An idle beat costs nothing: the sheet dedupes the snapshot by version and the activity by id. */
function startSheetHeartbeat() {
  if (!SHEET) return;
  clearInterval(sheetHeart);
  sheetHeart = setInterval(function () { syncSheet(); }, SHEET_EVERY);
}
/* Closing the tab cancels any pending debounce, so hand the payload to the browser to deliver. */
function flushSheet() {
  if (!SHEET || !state || !P || sheetBusy) return;
  try {
    if (!navigator.sendBeacon) return;
    var payload = Line.sheetPayload(state, P, {
      key: ONLINE ? 'v' + version : 'L' + (localKey || (localKey = Date.now())),
      at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      by: me ? pname(me) : ''
    });
    navigator.sendBeacon('/sheet', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  } catch (e) {}
}
window.addEventListener('pagehide', flushSheet);

/* ---------- mutations ---------- */
function log(msg, kind) {
  state.log = state.log || [];
  state.log.unshift({ id: newId(), t: new Date().toISOString().slice(0, 16).replace('T', ' '), who: me || 'producer', msg: msg, k: kind || '' });
  if (state.log.length > 400) state.log.length = 400;
}
function commit(msg, fn, kind) {
  var before = shippedList().map(function (g) { return g.id; });
  fn();
  replan();
  if (msg) log(msg, kind);
  var newly = shippedList().filter(function (g) { return before.indexOf(g.id) < 0; });
  newly.forEach(function (g) {
    log('🚀 ' + g.name + ' shipped', 'ship');
    var n = shippedList().length, left = nonKit().length - n;
    celebrate(); toast('🚀 ' + g.name + ' shipped! ' + n + ' down, ' + left + ' to go.', '', 4200);
  });
  render(); scheduleSave();
}
function setStatus(g, k, s) {
  g.st = g.st || {};
  g.st[k] = s === 'done' ? { s: 'done', at: TODAY, by: me } : s === 'doing' ? { s: 'doing', by: me } : { s: s };
  if (s === 'done' && g.flag && g.flag.stage === k) delete g.flag;
}
function label(g, k) { return ST[k].label + ' · ' + g.name; }
function markDone(g, k) {
  var n = (state.log || []).filter(function (e) { return e.k === 'done'; }).length;
  var wasShipped = P.info[g.id].shipped;
  commit(pname(me) + ' ✓ ' + label(g, k), function () { setStatus(g, k, 'done'); }, 'done');
  if (!P.info[g.id].shipped || wasShipped) toast(DONE_MSGS[n % DONE_MSGS.length], '', 1400);
}
function markStart(g, k) { commit(pname(me) + ' ▶ started ' + label(g, k), function () { setStatus(g, k, 'doing'); }); }
function cycle(g, k) {
  var cur = Line.status(g, k), nxt = cur === 'todo' ? 'doing' : cur === 'doing' ? 'done' : 'todo';
  if (cur === 'skip') nxt = 'todo';
  if (nxt === 'done') markDone(g, k);
  else commit(pname(me) + (nxt === 'doing' ? ' ▶ started ' : ' ↩ reset ') + label(g, k), function () { setStatus(g, k, nxt); });
}
function flag(g, k, note) { commit(pname(me) + ' ⚠ stuck on ' + label(g, k) + (note ? ': ' + note : ''), function () { g.flag = { stage: k, who: me, note: note || '', at: TODAY }; }, 'stuck'); }
function unflag(g) { commit(pname(me) + ' cleared stuck on ' + g.name, function () { delete g.flag; }); }

/* ---------- toast + confetti ---------- */
var toastT = null;
function toast(msg, kind, ms) {
  var el = $('#toast'); el.textContent = msg; el.className = 'toast' + (kind ? ' ' + kind : ''); el.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(function () { el.hidden = true; }, ms || 2200);
}
function celebrate() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var c = $('#confetti'), ctx = c.getContext('2d'); c.hidden = false;
  c.width = window.innerWidth; c.height = window.innerHeight;
  var cols = ['#0E9F8E', '#F2C200', '#FF8A2A', '#2FBF5A', '#5B21B6', '#F04438'], ps = [];
  for (var i = 0; i < 90; i++) ps.push({ x: c.width / 2 + (Math.random() - .5) * 200, y: c.height / 2, vx: (Math.random() - .5) * 14, vy: -Math.random() * 14 - 4, r: 4 + Math.random() * 5, c: cols[i % cols.length], a: Math.random() * 6 });
  var t0 = performance.now();
  (function frame(now) {
    var dt = now - t0; ctx.clearRect(0, 0, c.width, c.height);
    ps.forEach(function (p) { p.x += p.vx; p.y += p.vy; p.vy += .45; p.a += .1; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.globalAlpha = Math.max(0, 1 - dt / 1500); ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6); ctx.restore(); });
    if (dt < 1500) requestAnimationFrame(frame); else { c.hidden = true; ctx.clearRect(0, 0, c.width, c.height); }
  })(t0);
}

/* ---------- shared bits ---------- */
function stageChip(k) { return '<span class="stage-chip">' + esc(ST[k].label) + '</span>'; }
function tierDot(g, big) { return '<span class="tier-dot ' + esc(tierCls(g)) + (big ? ' big' : '') + '" title="' + esc(Line.TIERS[g.tier] || '') + '"></span>'; }
function confirmBtn(key, act, text, cls, extra) {
  var armed = ui.confirm === key;
  return '<button class="btn sm ' + (armed ? 'armed' : (cls || '')) + '" data-act="' + act + '" data-confirm="' + esc(key) + '"' + (extra || '') + '>' + (armed ? 'Sure? Tap again' : esc(text)) + '</button>';
}
function goalStrip() {
  var st = stats(), ns = Line.nextShip(P, state), parts = [];
  if (st.deadline) parts.push('🎯 ' + st.target + ' by ' + esc(Line.fmt(st.deadline)));
  parts.push(st.shipped + ' of ' + st.total + ' shipped');
  if (ns) parts.push('next ship: <b>' + esc(ns.g.name) + '</b>, ' + esc(Line.fmt(ns.date, true)));
  else if (st.shipped === st.total && st.total) parts.push('all shipped 🎉');
  return '<div class="goal">' + parts.join('<span class="sep">·</span>') + '</div>';
}
function taskDayInfo(t, di) {
  var here = Line.hoursOn(t, di), totalDays = Math.ceil((t.end - (t.start - (t.start % HRS))) / HRS);
  var first = P.dayOf(t.start), dayN = di - first + 1, span = P.dayOf(t.end - 1) - first + 1;
  var s = t.status === 'doing' ? 'in progress' : '';
  if (span > 1) s += (s ? ' · ' : '') + here + 'h today · day ' + Math.max(1, Math.min(dayN, span)) + ' of ' + span;
  else if (t.start % HRS >= HRS / 2) s += (s ? ' · ' : '') + 'afternoon';
  return s;
}
function checklist(g, k) {
  var items = (state.settings.checklists || {})[k] || [];
  if (g.tier === 'K' || !items.length) return '';
  return det('check:' + g.id + '.' + k, 'check', 'What done looks like', '<ul>' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>');
}
function taskCard(t, di, compact) {
  var g = t.g, k = t.st, st = Line.status(g, k), cap = k === 'optH' && g.tier !== 'K';
  var next = cap ? pname(Line.owner(state, g, 'optR')) : '', info = taskDayInfo(t, di);
  var h = '<article class="card ' + stageCls(k) + (st === 'doing' ? ' doing' : '') + '" data-g="' + esc(g.id) + '" data-s="' + k + '">';
  h += '<div class="card-top">' + stageChip(k) + tierDot(g) + '<span class="box" title="Time box: fits the end date">⏱ ' + esc(Line.hoursLabel(t.hours)) + ' box</span>' + (info ? '<span>' + esc(info) + '</span>' : '');
  if (compact) h += '<span style="margin-left:auto">' + esc(pname(t.p)) + '</span>';
  h += '</div>';
  h += '<h3>' + esc(g.name) + '</h3>';
  if (g.tier === 'K') h += '<div class="note">' + esc(k === 'webgl' ? 'Template project: landscape UI canvas + scaler, input, build settings, Brotli, loading screen.' : 'Platform adapter interface, one implementation per client platform, plus the cleanup checklist.') + '</div>';
  else if (g.note) h += '<div class="note">' + esc(g.note) + '</div>';
  if (cap) h += '<div class="cap">⏱ Hard cap. When the ' + esc(Line.hoursLabel(t.hours)) + ' box runs out, hand it to ' + esc(next) + ', whatever state it is in.</div>';
  if (g.flag && g.flag.stage === k) h += '<div class="stuck-box">⚠ Stuck' + (g.flag.note ? ': ' + esc(g.flag.note) : '') + '</div>';
  if (!compact) h += checklist(g, k);
  h += '<div class="actions">';
  if (st === 'doing') h += '<button class="btn primary" data-act="done">Done ✓</button><span class="in-progress">In progress</span>';
  else h += '<button class="btn primary" data-act="start">Start</button><button class="btn" data-act="done">Done ✓</button>';
  if (g.flag && g.flag.stage === k) h += '<button class="btn ghost" data-act="unstuck">Unstuck</button>';
  else h += '<button class="btn ghost" data-act="stuck">Stuck?</button>';
  if (ui.stuckFor === g.id + '.' + k) h += '<form class="stuck-in" data-act="stuckform"><input placeholder="One line: what is blocking you?" autofocus><button class="btn sm primary">Flag</button></form>';
  h += '</div></article>';
  return h;
}
function streak(p) {
  var days = {}; (state.log || []).forEach(function (e) { if (e.who === p && e.k === 'done') days[e.t.slice(0, 10)] = 1; });
  var n = 0, d = TODAY;
  for (var i = 0; i < 60; i++) { if (Line.isWeekend(d)) { d = Line.addDays(d, -1); continue; } if (days[d]) { n++; d = Line.addDays(d, -1); } else if (d === TODAY) { d = Line.addDays(d, -1); } else break; }
  return n;
}
function blockedNote(p) {
  var mine = P.tasks.filter(function (t) { return t.p === p; }).sort(function (a, b) { return a.start - b.start; });
  if (!mine.length) return '';
  var t = mine[0], waits = [];
  t.deps.forEach(function (dk) { var d = P.byKey[dk]; if (d && d.end > P.todayIdx * HRS) waits.push(pname(d.p) + ' · ' + label(d.g, d.st) + ' (' + Line.fmt(P.slotDate(d.end - 1), true) + ')'); });
  var h = 'Next: <b>' + esc(label(t.g, t.st)) + '</b> on ' + esc(Line.fmt(P.slotDate(t.start), true)) + '.';
  if (waits.length) h += ' Waiting on ' + esc(waits.join(', ')) + '.';
  return h;
}
function rulesBlock() {
  var r = state.settings.rules || []; if (!r.length) return '';
  return det('rules', 'rules', 'How the line works', '<ol>' + r.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>');
}
function fitLine(st) {
  if (!st.deadline) return 'Set an end date under Plan and every stage gets a time box that fits it.';
  if (!st.fit) return '';
  if (!st.fit.ok) return 'Even with 1-hour boxes, ' + st.fit.fitCount + ' of the ' + st.target + ' fit by ' + esc(Line.fmt(st.deadline)) + '. Lower the target to ' + st.fit.fitCount + ' or move the end date, and the plan is clean again.';
  if (st.effMin >= 100) return 'The full estimates fit inside ' + esc(Line.fmt(st.deadline)) + ' ✓. Boxes are at 100%.';
  var roles = Object.keys(st.need || {}).filter(function (r) { return r !== 'producer'; });
  return 'It fits. Time boxes are <b>' + esc(effTxt(st.fit)) + '</b> of the original estimates, so hand over the moment a box runs out. At full estimates this would take about ' + esc(roleTxt(st.need, roles)) + ' (you have ' + esc(roleTxt(st.have, roles)) + ').';
}

/* ---------- Today ---------- */
function renderToday() {
  if (me === 'producer') return renderProducer();
  var di = P.todayIdx, tasks = Line.tasksOn(P, me, di);
  var d = P.days[di], future = d > TODAY;
  var sk = streak(me);
  var h = goalStrip();
  h += '<section class="hello"><div class="eyebrow">' + esc(Line.fmtLong(d)) + (future ? ' · plan starts then' : '') + '</div>';
  h += '<h1>' + esc(greeting()) + ', ' + esc(pname(me)) + '.</h1>';
  h += '<p class="sub">' + (tasks.length ? '<b>' + tasks.length + '</b> thing' + (tasks.length > 1 ? 's' : '') + ' today. Let\'s ship.' : 'Nothing on your plate today.') + (sk > 1 ? ' · 🔥 ' + sk + '-day streak' : '') + '</p></section>';
  if (tasks.length) h += '<div class="cards">' + tasks.map(function (t) { return taskCard(t, di, false); }).join('') + '</div>';
  else h += '<div class="empty">' + (blockedNote(me) || 'All clear. Everything you own is done or waiting on someone else. 🎉') + '</div>';
  var upcoming = P.tasks.filter(function (t) { return t.p === me && t.start >= (di + 1) * HRS; }).sort(function (a, b) { return a.start - b.start; }).slice(0, 4);
  if (upcoming.length) {
    h += '<section class="next"><h2>Next up</h2><ul>' + upcoming.map(function (t) {
      return '<li><span class="when">' + esc(Line.fmt(P.slotDate(t.start), true)) + '</span>' + tierDot(t.g) + '<span class="' + stageCls(t.st) + '">' + stageChip(t.st) + '</span><span class="gn">' + esc(t.g.name) + '</span><span class="dur">' + esc(Line.hoursLabel(t.hours)) + ' box</span></li>';
    }).join('') + '</ul></section>';
  }
  h += rulesBlock();
  return h;
}
function renderProducer() {
  var di = P.todayIdx, st = stats(), ns = Line.nextShip(P, state);
  var loads = team().map(function (p) { return { p: p, h: P.load[p] || 0 }; }), maxL = Math.max.apply(null, loads.map(function (x) { return x.h; }).concat([1]));
  var hot = loads.slice().sort(function (a, b) { return b.h - a.h; })[0];
  var h = '<section class="hello"><div class="eyebrow">' + esc(Line.fmtLong(P.days[di])) + '</div><h1>' + esc(greeting()) + '. Here is where the line stands.</h1>';
  h += '<p class="sub"><b>' + st.shipped + '</b> shipped' + (st.deadline ? ' · <b>' + st.onPace + '</b> land by ' + esc(Line.fmt(st.deadline)) : '') + (ns ? ' · next ship <b>' + esc(ns.g.name) + '</b> on ' + esc(Line.fmt(ns.date, true)) : '') + '</p></section>';
  h += '<section class="stats">';
  h += '<div class="stat"><div class="n num">' + st.shipped + '<span class="of">/' + st.total + '</span></div><div class="l">Shipped so far</div><div class="bar-wrap"><i style="width:' + (st.total ? st.shipped / st.total * 100 : 0) + '%"></i></div></div>';
  if (st.deadline) {
    h += '<div class="stat' + (st.met ? ' good' : ' warn') + '"><div class="n num">' + st.onPace + '<span class="of">/' + st.target + '</span></div><div class="l">' + (st.met ? 'Land by ' + esc(Line.fmt(st.deadline)) + ' ✓ planned' : 'Fit by ' + esc(Line.fmt(st.deadline)) + ' · target ' + st.target) + '</div><div class="bar-wrap"><i style="width:' + (st.target ? Math.min(100, st.onPace / st.target * 100) : 0) + '%"></i></div></div>';
    if (st.fit && st.fit.ok) h += '<div class="stat' + (st.effMin >= 100 ? ' good' : '') + '"><div class="n num">' + st.effMin + '%</div><div class="l">' + (st.effMin >= 100 ? 'Full estimates fit ✓' : 'Time boxes vs estimates · tight, but planned') + '</div><div class="bar-wrap"><i style="width:' + st.effMin + '%"></i></div></div>';
    else h += '<div class="stat warn"><div class="n num">' + (st.fit ? st.fit.fitCount : 0) + '</div><div class="l">fit even at 1h boxes · lower the target or move the end date</div></div>';
  } else {
    h += '<div class="stat"><div class="n num">' + (P.finish ? esc(Line.fmt(P.finish)) : '—') + '</div><div class="l">Last game lands</div></div>';
    h += '<div class="stat"><div class="n">—</div><div class="l">Set an end date under Plan</div></div>';
  }
  h += '<div class="stat"><div class="n">' + (hot && hot.h > 0 ? esc(pname(hot.p)) : '—') + '</div><div class="l">Busiest · ' + (hot ? Math.round(hot.h / HRS * 10) / 10 : 0) + ' days boxed</div></div>';
  h += '</section>';
  var flagged = state.games.filter(function (g) { return g.flag; });
  if (flagged.length) h += '<div class="flags">' + flagged.map(function (g) {
    return '<div class="flag" data-g="' + esc(g.id) + '">⚠ <span>' + esc(label(g, g.flag.stage)) + '</span><span class="who">' + esc(pname(g.flag.who)) + (g.flag.note ? ': ' + esc(g.flag.note) : '') + '</span><button class="btn sm" data-act="unstuck">Resolved</button></div>';
  }).join('') + '</div>';
  h += '<div class="loads"><h2>Work left per person (boxed hours)</h2>' + loads.map(function (x) {
    return '<div class="load-row"><span>' + esc(pname(x.p)) + '</span><div class="bar"><i style="width:' + (x.h / maxL * 100) + '%"></i></div><b class="num">' + x.h + 'h</b></div>';
  }).join('') + '<p class="hint">' + fitLine(st) + '</p></div>';
  h += '<div class="cols3">' + team().map(function (p) {
    var ts = Line.tasksOn(P, p, di);
    return '<div class="col"><h2><span class="avatar">' + esc(initial(p)) + '</span>' + esc(pname(p)) + '</h2><div class="cards">' + (ts.length ? ts.map(function (t) { return taskCard(t, di, true); }).join('') : '<div class="empty">' + (blockedNote(p) || 'Nothing scheduled.') + '</div>') + '</div></div>';
  }).join('') + '</div>';
  h += rulesBlock();
  return h;
}

/* ---------- Week ---------- */
function renderWeek() {
  var mon = ui.week || Line.monday(P.days[P.todayIdx]);
  var days = []; for (var i = 0; i < 5; i++) days.push(Line.addDays(mon, i));
  var ships = 0, shipRow = days.map(function (d) {
    var di = P.dayIdx[d], list = [];
    if (di != null) Line.shipsOn(P, state, di).forEach(function (g) { list.push('<div class="chip rocket">🚀 <span class="g">' + esc(g.name) + '</span></div>'); });
    nonKit().forEach(function (g) { var inf = P.info[g.id]; if (inf.shipped && inf.shippedAt === d) list.push('<div class="chip rocket">✓ <span class="g">' + esc(g.name) + '</span></div>'); });
    ships += list.length; return list.join('');
  });
  var h = goalStrip();
  h += '<div class="week-head"><button class="btn sm" data-act="wk" data-n="-1">◀</button><h2>Week of ' + esc(Line.fmt(mon)) + '</h2><button class="btn sm" data-act="wk" data-n="1">▶</button><button class="btn sm ghost" data-act="wk" data-n="0">This week</button><span class="ships-n num">' + (ships ? ships + ' ship' + (ships === 1 ? '' : 's') + ' this week 🚀' : 'Building toward the next ship') + '</span></div>';
  h += '<div class="week-scroll"><table class="week"><thead><tr><th></th>' + days.map(function (d) { return '<th class="' + (d === TODAY ? 'today' : '') + '">' + esc(Line.fmt(d, true)) + (d === TODAY ? ' · today' : '') + '</th>'; }).join('') + '</tr></thead><tbody>';
  team().forEach(function (p) {
    h += '<tr><th>' + esc(pname(p)) + '</th>';
    days.forEach(function (d) {
      var di = P.dayIdx[d], off = ((state.settings.off || {})[p] || []).indexOf(d) >= 0, cls = (d === TODAY ? 'today ' : '') + (off || di == null ? 'off' : '');
      var cells = [];
      state.games.forEach(function (g) { S.forEach(function (s) { var st = g.st && g.st[s.k]; if (st && st.s === 'done' && st.at === d && (st.by === p || ((!st.by || !state.people[st.by] || st.by === 'producer') && Line.owner(state, g, s.k) === p)) && Line.dur(state, g, s.k) > 0) cells.push('<div class="chip done"><span class="k">' + esc(s.label) + '</span><span class="g">' + esc(g.name) + '</span></div>'); }); });
      if (di != null && !off) Line.tasksOn(P, p, di).forEach(function (t) {
        var here = Line.hoursOn(t, di), cont = t.end > (di + 1) * HRS ? '→' : '';
        cells.push('<div class="chip ' + stageCls(t.st) + (t.status === 'doing' ? ' doing' : '') + '" title="' + esc(label(t.g, t.st)) + ' · ' + esc(Line.hoursLabel(t.hours)) + ' box"><span class="k">' + esc(ST[t.st].label) + '</span><span class="g">' + esc(t.g.name) + '</span><small>' + here + 'h' + cont + '</small></div>');
      });
      h += '<td class="' + cls + '">' + (cells.join('') || (off ? '<span style="font-size:12px;color:var(--muted)">off</span>' : '')) + '</td>';
    });
    h += '</tr>';
  });
  h += '<tr class="ships"><th>🚀 Ships</th>' + shipRow.map(function (c, i) { return '<td class="' + (days[i] === TODAY ? 'today' : '') + '">' + c + '</td>'; }).join('') + '</tr>';
  h += '</tbody></table></div>';
  h += '<p class="hint">Numbers are boxed hours that day · → continues next day · struck through = done. The week re-fits itself from whatever is marked done.</p>';
  return h;
}

/* ---------- Games ---------- */
function renderGames() {
  var isProd = me === 'producer', f = ui.filter, st = stats(), auto = (state.settings.order || 'auto') === 'auto';
  var list = state.games.filter(function (g) {
    var inf = P.info[g.id];
    if (f === 'doing') return !inf.shipped && inf.started;
    if (f === 'shipped') return inf.shipped;
    if (f === 'stuck') return !!g.flag;
    return true;
  });
  var h = goalStrip();
  h += '<div class="games-head"><h2>Queue</h2><div class="prog"><div class="bar-wrap"><i style="width:' + (st.total ? st.shipped / st.total * 100 : 0) + '%"></i></div><span class="num">' + st.shipped + ' of ' + st.total + ' shipped</span></div>';
  h += '<div class="filters">' + [['all', 'All'], ['doing', 'In progress'], ['shipped', 'Shipped'], ['stuck', 'Stuck']].map(function (x) { return '<button data-act="filter" data-f="' + x[0] + '" class="' + (f === x[0] ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div></div>';
  h += '<div class="legend"><span>#</span><span></span><span>Game · tap a dot to move it along</span><div class="dots">' + S.map(function (s) { return '<span>' + esc(s.label.replace('Opt·', 'O')) + '</span>'; }).join('') + '</div><span style="text-align:right">Lands</span></div>';
  h += '<div class="glist">';
  var dividerDone = false, n = 0;
  list.forEach(function (g) {
    var inf = P.info[g.id];
    if (g.tier !== 'K') n++;
    var wave2 = st.deadline && !inf.shipped && (inf.phase === 2 || (inf.eta && inf.eta > st.deadline));
    if (wave2 && !dividerDone && f === 'all') { dividerDone = true; h += '<div class="wave">Everything above lands by ' + esc(Line.fmt(st.deadline)) + ' 🎯 · wave 2 starts here</div>'; }
    var dots = S.map(function (s) {
      var du = Line.dur(state, g, s.k), sst = Line.status(g, s.k);
      if (du <= 0) return '<span class="dot na" title="' + esc(s.label) + ' · not needed">–</span>';
      var t = s.label + ' · ' + pname(Line.owner(state, g, s.k)) + ' · ' + sst + ((g.st && g.st[s.k] && g.st[s.k].at) ? ' ' + g.st[s.k].at : '') + (inf.budgets[s.k] ? ' · ' + inf.budgets[s.k] + 'h box' : '');
      return '<button class="dot ' + sst + '" data-act="dot" data-s="' + s.k + '" title="' + esc(t) + '">' + (sst === 'done' ? '✓' : sst === 'doing' ? '▶' : sst === 'skip' ? '–' : '') + '</button>';
    }).join('');
    var eta = inf.shipped ? '<span class="eta ok">✓ Shipped ' + esc(Line.fmt(inf.shippedAt || '')) + '</span>'
      : g.flag ? '<span class="eta warn">⚠ Stuck · ' + esc(ST[g.flag.stage].label) + '</span>'
      : inf.blocked ? '<span class="eta warn">Cannot plan</span>'
      : inf.eta ? '<span class="eta' + (wave2 ? '' : ' w1') + '">→ ' + esc(Line.fmt(inf.eta, true)) + '</span>' : '<span class="eta">—</span>';
    h += '<div class="grow' + (inf.shipped ? ' shipped' : '') + (g.flag ? ' flagged' : '') + '" data-g="' + esc(g.id) + '">';
    h += '<span class="pos num">' + (g.tier === 'K' ? '⚙' : n) + '</span>' + tierDot(g, true);
    h += '<button class="gname" data-act="open" title="' + (isProd ? 'Edit' : 'Details') + '">' + esc(g.name) + (g.note && ui.open !== g.id ? '<small>' + esc(g.note.length > 90 ? g.note.slice(0, 88) + '…' : g.note) + '</small>' : '') + '</button>';
    h += '<div class="dots">' + dots + '</div>' + eta;
    if (ui.open === g.id) h += gameEdit(g, isProd, auto);
    h += '</div>';
  });
  if (!list.length) h += '<div class="empty">' + (f === 'shipped' ? 'Nothing shipped yet. The first one is close.' : f === 'stuck' ? 'Nobody is stuck. 🎉' : f === 'doing' ? 'Nothing in progress yet. Tap Start on a task in Today.' : 'No games yet.') + '</div>';
  h += '</div>';
  if (isProd) h += '<form class="addrow" data-act="addgameform"><input data-newgame placeholder="Add a game" maxlength="60"><select data-newtier>' + ['G', 'Y', 'O', 'R'].map(function (t) { return '<option value="' + t + '"' + (t === 'Y' ? ' selected' : '') + '>' + Line.TIERS[t] + '</option>'; }).join('') + '</select><button class="btn sm primary">+ Add</button></form>';
  var lg = (state.log || []).slice(0, 30);
  h += '<section class="log"><h2>Activity</h2>' + (lg.length ? '<ul>' + lg.map(function (e) { return '<li><span class="t">' + esc(e.t) + '</span><span>' + esc(e.msg) + '</span></li>'; }).join('') + '</ul>' : '<p class="hint">Every tap lands here, with who and when.</p>') + '</section>';
  return h;
}
function gameEdit(g, isProd, auto) {
  var inf = P.info[g.id];
  var h = '<div class="gedit">';
  h += '<div class="row"><label>Tier</label><select data-edit="tier"' + (isProd ? '' : ' disabled') + '>' + Line.TIER_KEYS.map(function (t) { return '<option value="' + t + '"' + (g.tier === t ? ' selected' : '') + '>' + Line.TIERS[t] + '</option>'; }).join('') + '</select>';
  if (isProd) {
    if (auto) h += '<span class="hint" style="margin:0">Order is automatic: lightest games first, started games stay put.</span>';
    else h += '<button class="btn sm" data-act="move" data-n="-1">↑ Earlier</button><button class="btn sm" data-act="move" data-n="1">↓ Later</button>';
    if (g.tier !== 'K') h += '<span style="margin-left:auto">' + confirmBtn('del:' + g.id, 'del', 'Remove', 'ghost') + '</span>';
  }
  h += '</div>';
  h += '<div class="stg-table">' + S.map(function (s) {
    var du = Line.dur(state, g, s.k), sst = Line.status(g, s.k), own = Line.owner(state, g, s.k);
    return '<div class="stg ' + stageCls(s.k) + '"><span class="k">' + stageChip(s.k) + ' <span style="color:var(--muted);font-weight:500">' + esc(du > 0 ? (inf.budgets[s.k] ? inf.budgets[s.k] + 'h box' : 'est ' + Line.daysLabel(du)) : 'n/a') + '</span></span>' +
      '<select data-edit="status" data-s="' + s.k + '">' + ['todo', 'doing', 'done', 'skip'].map(function (x) { return '<option value="' + x + '"' + (sst === x ? ' selected' : '') + '>' + x + '</option>'; }).join('') + '</select>' +
      '<select data-edit="owner" data-s="' + s.k + '"' + (isProd ? '' : ' disabled') + '>' + ownerOptions(own) + '</select></div>';
  }).join('') + '</div>';
  h += '<div class="row"><label>Note</label><input class="wide" data-edit="note" value="' + esc(g.note || '') + '" placeholder="Anything the next person should know"></div>';
  h += '</div>';
  return h;
}

/* ---------- Plan (settings) ---------- */
function renderSettings() {
  var s = state.settings, st = stats();
  var h = '<div class="set">';
  h += '<section class="big-in"><h2>Your plan</h2><p class="hint">Three numbers. The board fits everything else to them.</p>';
  h += '<div class="row"><label>Start</label><input type="date" data-set="planFrom" value="' + esc(s.planFrom || '') + '"><label>End</label><input type="date" data-set="deadline" value="' + esc(s.deadline || '') + '"><label>Target</label><input type="number" min="0" data-set="target" value="' + esc(s.target != null ? s.target : st.total) + '"><span style="color:var(--muted)">games by the end date</span></div>';
  if (st.deadline) {
    h += '<p class="plan-line"><b>' + st.onPace + '</b> of ' + st.total + ' land by ' + esc(Line.fmt(st.deadline)) + (st.met ? ' — target of ' + st.target + ' met ✓' : ' of the ' + st.target + ' you want') + '.' + (st.wave2 > 0 && P.finish ? ' The other ' + st.wave2 + ' follow by <b>' + esc(Line.fmt(P.finish)) + '</b>.' : '') + '</p>';
    if (st.fit) {
      Object.keys(st.fit.eff).forEach(function (r) { if (st.fit.load[r] > 0) h += '<div class="gauge"><span>Time boxes · ' + esc(r + (r === 'dev' ? 's' : '')) + '</span><div class="bar"><i style="width:' + st.fit.eff[r] + '%"></i></div><b>' + st.fit.eff[r] + '% of estimates</b></div>'; });
      h += '<p class="hint">' + fitLine(st) + '</p>';
    }
  } else h += '<p class="plan-line">Set an end date and every stage gets a time box that fits it.</p>';
  h += '</section>';
  h += '<section><h2>Backup</h2><p class="hint">CSV opens straight in Google Sheets (File → Import). Do it Friday, takes 5 seconds.</p><div class="row"><button class="btn primary" data-act="backup">Download CSV backup</button><button class="btn" data-act="copytsv">Copy for Sheets</button><button class="btn" data-act="exportjson">Download full JSON</button>' + (SHEET ? '<button class="btn" data-act="sheetnow">Save to Google Sheet now</button>' : '') + '</div>' + (SHEET ? '<p class="hint">The sheet already holds every event and every saved version — that happens automatically. This just pushes now instead of waiting.</p>' : '') + '</section>';
  h += '<details class="adv" data-key="adv"' + (ui.openKeys.adv ? ' open' : '') + '><summary>Advanced · the board manages these for you, open only if you must</summary><div class="set">';
  h += '<section><h2>Queue order</h2>';
  h += '<label class="radio"><input type="radio" name="order" value="auto" data-order' + ((s.order || 'auto') === 'auto' ? ' checked' : '') + '> Automatic: lightest games first, most games by the end date (recommended)</label>';
  h += '<label class="radio"><input type="radio" name="order" value="priority" data-order' + (s.order === 'priority' ? ' checked' : '') + '> Stakeholder priority list, as given</label>';
  h += '<label class="radio"><input type="radio" name="order" value="mix" data-order' + (s.order === 'mix' ? ' checked' : '') + '> <input type="number" min="1" max="9" data-set="mixN" value="' + esc(s.mixN || 4) + '" style="width:44px;padding:2px 4px"> light games, then 1 heavy, repeat</label>';
  h += '<p class="hint">With priority or mix you can also move games up and down in Games.</p></section>';
  h += '<section><h2>Relative effort, and who does what</h2><p class="hint">Days per stage per tier as originally estimated. The board scales these down to fit your end date; they only set the proportions. <b>Opt·H is Hemil\'s cap.</b> "Any dev" means whoever is free first.</p>';
  h += '<div style="overflow-x:auto"><table class="tt"><thead><tr><th>Stage</th>' + Line.TIER_KEYS.map(function (t) { return '<th><span class="tier-dot ' + t + '"></span> ' + Line.TIERS[t] + '</th>'; }).join('') + '</tr></thead><tbody>';
  S.forEach(function (stg) {
    h += '<tr><th>' + esc(stg.label) + '<br><span style="font-weight:400">' + esc(stg.long) + '</span></th>' + Line.TIER_KEYS.map(function (t) {
      var c = (s.tiers[t] || {})[stg.k] || { d: 0, o: 'hemil' };
      return '<td class="cell"><input type="number" step="0.5" min="0" data-tier="' + t + '" data-stage="' + stg.k + '" data-field="d" value="' + esc(c.d) + '"> <select data-tier="' + t + '" data-stage="' + stg.k + '" data-field="o">' + ownerOptions(c.o) + '</select></td>';
    }).join('') + '</tr>';
  });
  h += '</tbody></table></div></section>';
  h += '<section><h2>Days off</h2><p class="hint">One date per line, YYYY-MM-DD. Weekends are already off.</p><div class="grid2">';
  h += '<div><label>Public holidays (everyone)</label><textarea data-holidays>' + esc((s.holidays || []).join('\n')) + '</textarea></div>';
  team().forEach(function (p) { h += '<div><label>' + esc(pname(p)) + '</label><textarea data-off="' + p + '">' + esc(((s.off || {})[p] || []).join('\n')) + '</textarea></div>'; });
  h += '</div></section>';
  h += '<section class="chk"><h2>What done looks like</h2><p class="hint">Shown on each Today card. One line per bullet.</p>';
  S.forEach(function (stg) { h += '<label>' + esc(stg.label) + ' · ' + esc(stg.long) + '</label><textarea data-check="' + stg.k + '">' + esc(((s.checklists || {})[stg.k] || []).join('\n')) + '</textarea>'; });
  h += '<label>How the line works (shown on Today)</label><textarea data-rules>' + esc((s.rules || []).join('\n')) + '</textarea></section>';
  h += '<section><h2>People</h2><p class="hint">Add a dev or artist here and the board re-fits with them immediately.</p>';
  h += people().map(function (p) { return '<div class="row"><input data-pname="' + p + '" value="' + esc(pname(p)) + '" style="width:140px"><span style="color:var(--muted)">' + esc(state.people[p].role || '') + '</span>' + (p === 'producer' ? '' : confirmBtn('delperson:' + p, 'delperson', 'Remove', 'ghost', ' data-p="' + p + '"')) + '</div>'; }).join('');
  h += '<form class="row" data-act="addpersonform" style="margin-top:8px"><input data-newname placeholder="Name" style="width:140px" maxlength="40"><select data-newrole><option value="Dev">Dev</option><option value="Artist">Artist</option></select><button class="btn sm">+ Add person</button></form></section>';
  h += '<section><h2>Restore from JSON</h2><textarea data-import placeholder="Paste a JSON backup here, then Restore">' + esc(ui.importText) + '</textarea><div class="row">' + confirmBtn('import', 'importjson', 'Restore (replaces everything)', 'danger') + '</div></section>';
  h += '</div></details>';
  h += '</div>';
  return h;
}

/* ---------- render ---------- */
function render() {
  var main = $('#main'), needPass = ONLINE && (!pass || passBad);
  var who = $('#who');
  who.hidden = !!(me && !needPass && state);
  $('#passForm').hidden = !needPass; $('#passErr').hidden = !passBad;
  var ppl = state ? state.people : window.SEED.people;
  $('#whoGrid').innerHTML = Object.keys(ppl).map(function (p) { return '<button class="who-btn' + (me === p ? ' on' : '') + '" data-who="' + p + '"><span class="avatar">' + esc((ppl[p].name || p).charAt(0).toUpperCase()) + '</span>' + esc(ppl[p].name || p) + '<small>' + esc(ppl[p].role || '') + '</small></button>'; }).join('');
  if (!state) { main.innerHTML = loading ? '<div class="loading">Loading the board…</div>' : ''; $('#meName').textContent = me && ppl[me] ? ppl[me].name : 'Who?'; $('#meAv').textContent = me && ppl[me] ? ppl[me].name.charAt(0).toUpperCase() : '?'; return; }
  $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === ui.tab); });
  $('#tabSettings').hidden = me !== 'producer';
  if (ui.tab === 'settings' && me !== 'producer') ui.tab = 'today';
  try { sessionStorage.setItem('line.tab', ui.tab); } catch (e) {}
  main.innerHTML = !me ? '' : ui.tab === 'today' ? renderToday() : ui.tab === 'week' ? renderWeek() : ui.tab === 'games' ? renderGames() : renderSettings();
  var total = nonKit().length, sh = shippedList().length;
  $('#shipPill').textContent = '🚀 ' + sh + '/' + total + ' shipped';
  $('#topbar').style.width = (total ? sh / total * 100 : 0) + '%';
  $('#meAv').textContent = me ? initial(me) : '?'; $('#meName').textContent = me ? pname(me) : 'Who?';
  var f = $('.stuck-in input'); if (f) f.focus();
}
var confirmT = null;
function arm(key) { ui.confirm = key; render(); clearTimeout(confirmT); confirmT = setTimeout(function () { if (ui.confirm === key) { ui.confirm = null; render(); } }, 4000); }

/* ---------- events ---------- */
document.addEventListener('click', function (ev) {
  var b = ev.target.closest('[data-who]');
  if (b) { me = b.dataset.who; try { localStorage.setItem('line.me', me); } catch (e) {} ui.tab = 'today'; if (state) render(); else boot(); return; }
  if (!state) return;
  var t = ev.target.closest('#tabs button'); if (t) { ui.tab = t.dataset.tab; ui.open = null; ui.confirm = null; render(); window.scrollTo(0, 0); return; }
  if (ev.target.closest('#meBtn')) { me = null; render(); return; }
  var a = ev.target.closest('[data-act]'); if (!a || a.tagName === 'FORM') return;
  var act = a.dataset.act, row = ev.target.closest('[data-g]'), g = row ? byId(row.dataset.g) : null, sk = row && (row.dataset.s || a.dataset.s);
  if (a.dataset.confirm && ui.confirm !== a.dataset.confirm) { arm(a.dataset.confirm); return; }
  ui.confirm = null;
  if (act === 'start' && g) return markStart(g, sk);
  if (act === 'done' && g) return markDone(g, sk);
  if (act === 'stuck' && g) { ui.stuckFor = g.id + '.' + sk; render(); return; }
  if (act === 'unstuck' && g) return unflag(g);
  if (act === 'wk') { var n = +a.dataset.n; ui.week = n === 0 ? null : Line.addDays(ui.week || Line.monday(P.days[P.todayIdx]), n * 7); render(); return; }
  if (act === 'filter') { ui.filter = a.dataset.f; render(); return; }
  if (act === 'dot' && g) return cycle(g, a.dataset.s);
  if (act === 'open' && g) { ui.open = ui.open === g.id ? null : g.id; render(); return; }
  if (act === 'move' && g) { var i = state.games.indexOf(g), j = i + (+a.dataset.n); if (j < 0 || j >= state.games.length) return; commit(pname(me) + ' moved ' + g.name + ' ' + (j < i ? 'earlier' : 'later'), function () { state.games.splice(i, 1); state.games.splice(j, 0, g); }); return; }
  if (act === 'del' && g) { ui.open = null; commit(pname(me) + ' removed ' + g.name, function () { state.games.splice(state.games.indexOf(g), 1); }); return; }
  if (act === 'delperson') { var dp = a.dataset.p; if (!state.people[dp] || dp === 'producer') return; commit(pname(me) + ' removed ' + pname(dp), function () { delete state.people[dp]; if (me === dp) me = null; }); return; }
  if (act === 'sheetnow') { syncSheet(); toast('Pushing to the Google Sheet…', '', 1600); return; }
  if (act === 'backup') return backup('csv');
  if (act === 'exportjson') return backup('json');
  if (act === 'copytsv') { var tsv = Line.toTSV(Line.backupRows(state, P)) + '\n\n' + Line.toTSV(Line.logRows(state)); copy(tsv, 'Copied. Paste into a Google Sheet (Ctrl+V).'); return; }
  if (act === 'importjson') { var ta = $('[data-import]'); ui.importText = ''; try { var obj = JSON.parse(ta.value); if (!obj || !obj.games || !obj.settings || !obj.people) throw new Error('bad'); commit(pname(me) + ' restored the board from a backup', function () { state.v = obj.v; state.people = obj.people; state.settings = obj.settings; state.games = obj.games; state.log = obj.log || []; migrate(state); }); toast('Restored ✓', '', 1500); } catch (e) { toast('That is not a WebGL Line JSON backup.', 'warn'); } return; }
});
document.addEventListener('toggle', function (ev) {
  var d = ev.target; if (!d || !d.dataset || !d.dataset.key) return;
  if (d.open) ui.openKeys[d.dataset.key] = 1; else delete ui.openKeys[d.dataset.key];
}, true);
document.addEventListener('input', function (ev) { if (ev.target.hasAttribute && ev.target.hasAttribute('data-import')) ui.importText = ev.target.value; });
document.addEventListener('submit', function (ev) {
  if (ev.target.id === 'passForm') { ev.preventDefault(); pass = $('#passIn').value.trim(); if (!pass) return; try { localStorage.setItem('line.pass', pass); } catch (e) {} passBad = false; boot(); return; }
  var f = ev.target.closest('[data-act]'); if (!f || !state) return;
  ev.preventDefault();
  var act = f.dataset.act;
  if (act === 'stuckform') { var row = f.closest('[data-g]'), g = byId(row.dataset.g), k = row.dataset.s, note = f.querySelector('input').value.trim(); ui.stuckFor = null; flag(g, k, note); return; }
  if (act === 'addgameform') { var nm = f.querySelector('[data-newgame]').value.trim(), tier = f.querySelector('[data-newtier]').value; if (!nm) return toast('Type the game name first.', 'warn'); var id = slug(nm) || ('g' + Date.now()); if (byId(id)) id += '-' + Date.now(); var maxP = Math.max.apply(null, state.games.map(function (x) { return x.prio || 0; }).concat([0])); commit(pname(me) + ' added ' + nm, function () { state.games.push({ id: id, name: nm, tier: tier, prio: maxP + 1, st: {} }); }); toast('Added. It is in the queue.', '', 1500); return; }
  if (act === 'addpersonform') { var nn = f.querySelector('[data-newname]').value.trim(), rl = f.querySelector('[data-newrole]').value || 'Dev'; if (!nn) return toast('Type a name first.', 'warn'); var pid = slug(nn) || ('p' + Date.now()); if (state.people[pid]) pid += '-' + Date.now(); commit(pname(me) + ' added ' + nn + ' (' + rl + ')', function () { state.people[pid] = { name: nn, role: rl }; state.settings.off = state.settings.off || {}; state.settings.off[pid] = []; }); toast(nn + ' is on the board. Set a stage to "Any ' + rl.toLowerCase() + '" to use them.', '', 3500); return; }
});
document.addEventListener('change', function (ev) {
  if (!state) return;
  var el = ev.target, row = el.closest('[data-g]');
  if (el.dataset.edit && row) {
    var g = byId(row.dataset.g), k = el.dataset.s, v = el.value;
    if (el.dataset.edit === 'tier') return commit(pname(me) + ' set ' + g.name + ' to ' + Line.TIERS[v], function () { g.tier = v; });
    if (el.dataset.edit === 'status') { if (v === 'done') return markDone(g, k); return commit(pname(me) + ' set ' + label(g, k) + ' to ' + v, function () { setStatus(g, k, v); }); }
    if (el.dataset.edit === 'owner') return commit(pname(me) + ' handed ' + label(g, k) + ' to ' + pname(v), function () { g.own = g.own || {}; if (v === Line.owner(state, { tier: g.tier }, k)) delete g.own[k]; else g.own[k] = v; });
    if (el.dataset.edit === 'note') return commit(null, function () { g.note = v; });
    return;
  }
  if (ui.tab !== 'settings') return;
  var s = state.settings;
  if (el.hasAttribute('data-order')) { var ov = el.value; return commit(pname(me) + ' set the queue order to ' + ov, function () { s.order = ov; if (ov === 'priority') Line.applyPriority(state); if (ov === 'mix') Line.applyMix(state, s.mixN || 4); }); }
  if (el.dataset.set) {
    var key = el.dataset.set, val = el.type === 'number' ? +el.value : el.value;
    if (key === 'mixN') { s.mixN = Math.max(1, val || 4); if (s.order === 'mix') return commit(null, function () { Line.applyMix(state, s.mixN); }); scheduleSave(); return; }
    if ((key === 'planFrom' || key === 'deadline') && val && !Line.validDate(val)) return toast('That date did not read. Use the picker.', 'warn');
    var nice = key === 'planFrom' ? 'start' : key === 'deadline' ? 'end date' : key;
    return commit(pname(me) + ' set the ' + nice + ' to ' + val, function () { s[key] = val; });
  }
  if (el.dataset.tier) { var c = s.tiers[el.dataset.tier][el.dataset.stage]; return commit(null, function () { if (el.dataset.field === 'd') c.d = Math.max(0, +el.value || 0); else c.o = el.value; }); }
  if (el.hasAttribute('data-holidays')) return commit(null, function () { s.holidays = dates(el.value); });
  if (el.dataset.off) return commit(null, function () { s.off = s.off || {}; s.off[el.dataset.off] = dates(el.value); });
  if (el.dataset.check) return commit(null, function () { s.checklists = s.checklists || {}; s.checklists[el.dataset.check] = lines(el.value); });
  if (el.hasAttribute('data-rules')) return commit(null, function () { s.rules = lines(el.value); });
  if (el.dataset.pname) return commit(null, function () { state.people[el.dataset.pname].name = el.value.trim() || el.dataset.pname; });
});
function lines(v) { return v.split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean); }
function dates(v) {
  var bad = [], out = lines(v).filter(function (x) { var okd = Line.validDate(x); if (!okd) bad.push(x); return okd; });
  if (bad.length) toast('Skipped ' + bad.length + ' line' + (bad.length === 1 ? '' : 's') + ' that is not a date (use YYYY-MM-DD).', 'warn', 3500);
  return out;
}
function copy(text, msg) {
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast(msg, '', 3000); }, function () { fallbackCopy(text, msg); });
  else fallbackCopy(text, msg);
}
function fallbackCopy(text, msg) {
  var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast(msg, '', 3000); } catch (e) { toast('Copy failed. Use Download instead.', 'warn'); }
  ta.remove();
}
function backup(kind) {
  var data = kind === 'csv' ? Line.backupCSV(state, P) : JSON.stringify(state, null, 1);
  var fn = 'webgl-line-' + (kind === 'csv' ? 'backup' : 'full') + '-' + TODAY + '.' + kind;
  try {
    var blob = new Blob([data], { type: kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
    var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    toast('Downloading ' + fn, '', 2000);
  } catch (e) { copy(data, 'Download blocked here. Copied to clipboard instead.'); }
}

/* ---------- boot ---------- */
function boot() {
  render();
  if (!me) return;
  if (ONLINE && !pass) { render(); return; }
  loadBoard().then(function (ok) { if (ok && state) { replan(); render(); startPolling(); scheduleSheet(); startSheetHeartbeat(); } else render(); });
}
window.LineDebug = function () { return { state: state, ui: ui, plan: P, fit: F, me: me, today: TODAY, version: version, online: ONLINE, poll: poll }; };
boot();
})();
