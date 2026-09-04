/* Scheduler tests. Run: npm test */
const path = require('path');
const Line = require(path.join(__dirname, '..', 'public', 'sched.js'));
const seed = require('./seed.js');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  FAIL', msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' → got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); }
const clone = () => JSON.parse(JSON.stringify(seed()));
const T = '2026-09-07', DL = '2026-10-16', H = Line.H;
const nonKit = s => s.games.filter(g => g.tier !== 'K');

console.log('dates + labels');
eq(Line.addDays('2026-09-04', 3), '2026-09-07', 'addDays');
eq(Line.monday('2026-09-10'), '2026-09-07', 'monday');
ok(Line.validDate('2026-09-08') && !Line.validDate('2026-13-45') && !Line.validDate('nope'), 'validDate');
eq(Line.hoursLabel(3), '3h', '3h'); eq(Line.hoursLabel(8), '1 day', '1 day'); eq(Line.hoursLabel(12), '1½ days (12h)', '12h'); eq(Line.hoursLabel(16), '2 days (16h)', '16h');

console.log('fit: everything lands by the end date');
{ const s = clone(); const F = Line.fit(s, T); const P = F.plan;
  ok(F.fit && F.fit.ok, 'feasible');
  ok(P.targetFinish && P.targetFinish <= DL, 'target set finishes by ' + DL + ': ' + P.targetFinish);
  ok(nonKit(s).every(g => P.info[g.id].eta && P.info[g.id].eta <= DL), 'every game lands by the end date');
  ok(P.unscheduled.length === 0, 'nothing unscheduled');
  ok(F.fit.eff.dev < 100 && F.fit.eff.artist <= 100, 'dev boxes compressed: ' + JSON.stringify(F.fit.eff));
  ok(P.tasks.every(t => t.hours >= 1 && t.hours <= t.est), 'every box between 1h and its estimate');
  ok(P.tasks.every(t => t.phase === 1), 'all in wave 1 when target = total');
  ok(Object.values(P.load).every(h => h <= F.fit.workdays * H), 'nobody boxed beyond capacity');
  const kw = P.byKey['kit.webgl']; ok(kw.p === 'rakesh' && kw.start === 0, 'kit template first'); }

console.log('fit: far end date keeps full estimates');
{ const s = clone(); s.settings.deadline = '2027-03-31'; const F = Line.fit(s, T);
  ok(F.fit.ok && F.fit.m === 1 && F.fit.eff.dev === 100, 'no compression when there is room: ' + JSON.stringify(F.fit.eff));
  ok(F.plan.tasks.every(t => t.hours === t.est), 'boxes equal estimates'); }

console.log('fit: partial target makes a wave 2');
{ const s = clone(); s.settings.target = 10; const F = Line.fit(s, T); const P = F.plan;
  const w1 = nonKit(s).filter(g => P.info[g.id].phase === 1), w2 = nonKit(s).filter(g => P.info[g.id].phase === 2);
  eq(w1.length, 10, 'ten games in wave 1'); eq(w2.length, 17, 'seventeen in wave 2');
  ok(w1.every(g => P.info[g.id].eta <= DL), 'wave 1 lands by the end date');
  ok(w1.every(g => g.tier === 'G' || g.tier === 'Y'), 'wave 1 takes the lightest games');
  ok(P.tasks.filter(t => t.phase === 2).every(t => t.hours === t.est), 'wave 2 keeps full estimates');
  const w1End = Math.max(...P.tasks.filter(t => t.phase === 1).map(t => t.end)), w2Start = Math.min(...P.tasks.filter(t => t.phase === 2).map(t => t.start));
  ok(w2Start >= 0 && w1End <= DLslot(P), 'wave 1 inside the deadline');
  function DLslot(P) { return (P.dayIdx[DL] + 1) * H; } }

console.log('fit: impossible window is reported, not hidden');
{ const s = clone(); s.settings.deadline = '2026-09-08'; const F = Line.fit(s, T);
  ok(F.fit && !F.fit.ok, 'infeasible flagged'); ok(F.fit.fitCount < 27 && F.fit.fitCount >= 0, 'fitCount ' + F.fit.fitCount);
  ok(F.plan.tasks.every(t => t.hours === 1), 'all boxes at the 1h floor'); }

console.log('fit: shipped games count toward the target');
{ const s = clone(); const g = s.games.find(x => x.id === 'merge-chain'); Line.STAGES.forEach(st => { g.st[st.k] = { s: 'done', at: '2026-09-09' }; });
  const F = Line.fit(s, T); ok(F.shipped === 1 && Object.keys(F.targetSet).length === 27, 'one shipped, 26 remaining + kit in the set');
  ok(F.plan.info['merge-chain'].shipped && s.games[s.games.length - 1].id === 'merge-chain', 'shipped game goes last'); }

console.log('fit: days off shrink boxes further');
{ const a = Line.fit(clone(), T).fit.eff.dev; const s = clone(); s.settings.off.rakesh = ['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-14']; const b = Line.fit(s, T).fit.eff.dev;
  ok(b < a, 'a week off for Rakesh tightens dev boxes: ' + a + '% → ' + b + '%'); }

console.log('fit: adding a dev loosens boxes');
{ const s = clone(); s.people.dev3 = { name: 'Dev 3', role: 'Dev' }; const a = Line.fit(clone(), T).fit.eff.dev, b = Line.fit(s, T).fit.eff.dev;
  ok(b > a, 'third dev loosens: ' + a + '% → ' + b + '%');
  ok(Line.fit(s, T).plan.tasks.some(t => t.p === 'dev3'), 'third dev gets pooled work'); }

console.log('fit: re-fits from today as days pass');
{ const s = clone(); const early = Line.fit(s, '2026-09-07').fit.eff.dev, late = Line.fit(s, '2026-09-28').fit.eff.dev;
  ok(late < early, 'less time left → tighter boxes: ' + early + '% → ' + late + '%');
  const F = Line.fit(s, '2026-09-28'); ok(F.plan.targetFinish <= DL, 'still lands by the end date'); }

console.log('statuses + chain + no double booking');
{ const s = clone(); const g = s.games.find(x => x.id === 'ring-breaker');
  g.st = { art: { s: 'done', at: '2026-09-03' }, clean: { s: 'done', at: '2026-09-03' }, optH: { s: 'doing', by: 'hemil' } };
  const P = Line.fit(s, T).plan;
  ok(!P.byKey['ring-breaker.art'] && !P.byKey['ring-breaker.clean'], 'done stages not scheduled');
  const oh = P.byKey['ring-breaker.optH']; ok(oh && oh.p === 'hemil' && oh.start === 0, 'doing task first, on Hemil');
  const k = st => P.byKey['ring-breaker.' + st];
  ok(k('optR').start >= k('optH').end && k('webgl').start >= k('optR').end && k('sdk').start >= k('webgl').end, 'chain order');
  Object.keys(s.people).forEach(p => { const ts = P.tasks.filter(t => t.p === p).sort((a, b) => a.start - b.start); for (let i = 1; i < ts.length; i++) ok(ts[i].start >= ts[i - 1].end, p + ' overlaps at ' + ts[i].key); });
  const firstClean = P.tasks.filter(t => t.st === 'clean').sort((a, b) => a.start - b.start)[0]; ok(firstClean.start >= P.byKey['kit.sdk'].end, 'no cleanup before the adapter'); }

console.log('pools + owners');
{ const s = clone(); const P = Line.fit(s, T).plan;
  const pooled = P.tasks.filter(t => ['clean', 'webgl', 'sdk'].indexOf(t.st) >= 0 && t.g.tier !== 'K');
  ok(pooled.every(t => t.p === 'hemil' || t.p === 'rakesh'), 'dev pool never lands on the artist');
  ok(pooled.some(t => t.p === 'hemil') && pooled.some(t => t.p === 'rakesh'), 'pool spreads across devs');
  ok(P.tasks.filter(t => t.st === 'optH').every(t => t.p === 'hemil'), 'Opt·H stays Hemil');
  ok(P.tasks.filter(t => t.st === 'optR').every(t => t.p === 'rakesh'), 'Opt·R stays Rakesh');
  const g = s.games.find(x => x.id === 'bitcoin-plinko'); g.own = { webgl: 'sarbjeet' }; eq(Line.owner(s, g, 'webgl'), 'sarbjeet', 'per-game override'); g.own = { webgl: 'ghost' }; eq(Line.owner(s, g, 'webgl'), 'any:dev', 'invalid override falls back'); }

console.log('ordering');
{ const s = clone(); s.games.find(g => g.id === 'bitcoin-splash').st = { clean: { s: 'doing' } }; Line.fit(s, T);
  eq(s.games[0].id, 'kit', 'kit first'); eq(s.games[1].id, 'bitcoin-splash', 'started game stays at the front');
  const w = { G: 0, Y: 1, O: 2, R: 3 }, tiers = s.games.slice(2).map(g => g.tier); ok(tiers.every((t, i) => i === 0 || w[t] >= w[tiers[i - 1]]), 'rest light → heavy');
  Line.applyMix(s, 4); eq(s.games.slice(0, 6).map(g => g.tier), ['K', 'G', 'G', 'G', 'G', 'O'], '4+1 mix'); Line.applyPriority(s); ok(s.games.map(g => g.prio).every((p, i, a) => i === 0 || p >= a[i - 1]), 'priority order'); }

console.log('views + csv');
{ const s = clone(); const F = Line.fit(s, T), P = F.plan;
  const t = P.tasks[0]; ok(Line.hoursOn(t, P.dayOf(t.start)) >= 1, 'hoursOn');
  ok(Line.nextShip(P, s).g.id === 'merge-chain', 'next ship is the first green');
  const need = Line.headcountAtFullEstimates(F); ok(need.dev >= 4 && need.artist >= 2, 'headcount at full estimates ' + JSON.stringify(need));
  const csv = Line.backupCSV(s, P); ok(csv.indexOf('box (h)') > 0 && csv.split('\r\n').length > 30, 'csv has box columns and rows');
  s.games[1].note = 'has, comma "and quotes"'; ok(Line.backupCSV(s, Line.fit(s, T).plan).indexOf('"has, comma ""and quotes"""') > 0, 'csv escaping'); }

console.log('google sheet archive');
{ const s = clone();
  s.log = [{ t: '2026-09-07 09:10', who: 'hemil', msg: 'Hemil ✓ Clean · Merge Chain', k: 'done' },
            { t: '2026-09-07 09:02', who: 'rakesh', msg: 'Rakesh ▶ started WebGL · Ring Breaker', k: '' }];
  Line.backfillLogIds(s);
  ok(s.log.every(e => e.id), 'every legacy entry gets an id');
  ok(s.log[0].id !== s.log[1].id, 'different entries get different ids');
  const first = s.log.map(e => e.id);
  const again = JSON.parse(JSON.stringify(s)); again.log.forEach(e => delete e.id); Line.backfillLogIds(again);
  eq(again.log.map(e => e.id), first, 'legacy ids are stable, so a replay never doubles a row');
  const withNew = clone(); withNew.log = [{ id: 'abc', t: 't', who: 'hemil', msg: 'm' }]; Line.backfillLogIds(withNew);
  eq(withNew.log[0].id, 'abc', 'an existing id is left alone');

  const F = Line.fit(s, T), P = F.plan;
  const pay = Line.sheetPayload(s, P, { key: 'v7', at: '2026-09-07 09:11', by: 'Hemil' });
  eq(pay.activity.length, 2, 'both events in the payload');
  eq(pay.activity[0].t, '2026-09-07 09:02', 'activity is oldest-first for a sheet that reads top down');
  eq(pay.activity[0].who, 'Rakesh', 'who is resolved to a display name');
  ok(pay.activity.every(e => e.id), 'every activity row carries an id for dedupe');
  eq(pay.snapshot.key, 'v7', 'snapshot keyed by board version');
  eq(pay.snapshot.games, 27, 'snapshot counts non-kit games');
  eq(pay.snapshot.shipped, 0, 'snapshot counts shipped');
  eq(JSON.parse(pay.snapshot.json).games.length, s.games.length, 'snapshot json restores the whole board');
  ok(JSON.parse(pay.snapshot.json).log.length === 2, 'snapshot keeps the log, so it is a complete restore point');
  eq(pay.board, Line.backupRows(s, P), 'board tab mirrors the readable backup rows');
  ok(pay.board[0].indexOf('Game') >= 0 && pay.board.length === s.games.length + 1, 'board tab is a header plus every game'); }

{ const s = clone(); const g = s.games.find(x => x.id === 'merge-chain');
  Line.STAGES.forEach(st => { g.st[st.k] = { s: 'done', at: '2026-09-09' }; });
  const P = Line.fit(s, T).plan, pay = Line.sheetPayload(s, P, { key: 'v9' });
  eq(pay.snapshot.shipped, 1, 'a shipped game shows in the snapshot count');
  eq(pay.activity.length, 0, 'an empty log makes an empty activity list, not a crash'); }

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
