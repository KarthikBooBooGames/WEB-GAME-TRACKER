/* WebGL Line — scheduler core (hours). Pure functions, no DOM.
   The end date is a constraint: fit() shrinks every stage's time box until the target set lands on time. */
var Line = (function () {
  'use strict';
  var H = 8; // working hours per day = slots per day
  var STAGES = [
    { k: 'art',   label: 'Art',   long: 'Art optimization',     depth: 0, cls: 'art' },
    { k: 'clean', label: 'Clean', long: 'Cleanup',              depth: 1, cls: 'clean' },
    { k: 'optH',  label: 'Opt·H', long: 'Optimization, capped', depth: 2, cls: 'opt' },
    { k: 'optR',  label: 'Opt·R', long: 'Optimization, finish', depth: 3, cls: 'opt' },
    { k: 'webgl', label: 'WebGL', long: 'WebGL conversion',     depth: 4, cls: 'webgl' },
    { k: 'sdk',   label: 'SDK',   long: 'Platform SDK',         depth: 5, cls: 'sdk' }
  ];
  var STAGE = {}; STAGES.forEach(function (s) { STAGE[s.k] = s; });
  var DEPS = { art: [], clean: [], optH: ['clean'], optR: ['optH', 'art'], webgl: ['optR'], sdk: ['webgl'] };
  var TIERS = { G: 'Green', Y: 'Yellow', O: 'Orange', R: 'Red', K: 'Kit' };
  var TIER_KEYS = ['G', 'Y', 'O', 'R', 'K'];
  var TIER_WEIGHT = { K: -1, G: 0, Y: 1, O: 2, R: 3 };
  var KIT = 'kit';
  var DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toISO(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(iso, n) { var d = parse(iso); d.setDate(d.getDate() + n); return toISO(d); }
  function dow(iso) { return parse(iso).getDay(); }
  function isWeekend(iso) { var w = dow(iso); return w === 0 || w === 6; }
  function monday(iso) { return addDays(iso, -((dow(iso) + 6) % 7)); }
  function validDate(x) { return /^\d{4}-\d{2}-\d{2}$/.test(x) && toISO(parse(x)) === x; }
  function fmt(iso, withDow) { if (!iso) return ''; var d = parse(iso); return (withDow ? DOWS[d.getDay()] + ' ' : '') + d.getDate() + ' ' + MONS[d.getMonth()]; }
  function fmtLong(iso) { if (!iso) return ''; var d = parse(iso); return DOWS[d.getDay()] + ' ' + d.getDate() + ' ' + MONS[d.getMonth()] + ' ' + d.getFullYear(); }
  function monthName(iso) { return MONS[parse(iso).getMonth()]; }
  function monthKey(iso) { return iso ? iso.slice(0, 7) : ''; }
  function daysLabel(d) {
    if (!d) return '';
    if (d === 0.5) return '½ day';
    if (d === 1) return '1 day';
    var w = Math.floor(d), h = d - w;
    return (h ? w + '½' : w) + ' days';
  }
  /* hours → "3h", "1 day", "1½ days (12h)" */
  function hoursLabel(h) {
    if (!h) return '';
    if (h < H) return h + 'h';
    var d = h / H, w = Math.floor(d), r = d - w;
    var ds = r === 0 ? (w + (w === 1 ? ' day' : ' days')) : (r === 0.5 ? w + '½ days' : (Math.round(d * 10) / 10) + ' days');
    return h === H ? ds : ds + ' (' + h + 'h)';
  }

  function calendar(from, holidays, n) {
    var days = [], d = from, Hm = {};
    (holidays || []).forEach(function (h) { Hm[h] = 1; });
    while (days.length < n) { if (!isWeekend(d) && !Hm[d]) days.push(d); d = addDays(d, 1); }
    return days;
  }

  function tierCfg(state, g) { return state.settings.tiers[g.tier] || state.settings.tiers.G; }
  function dur(state, g, k) { var c = tierCfg(state, g)[k]; return c ? (+c.d || 0) : 0; }
  function estHours(state, g, k) { return Math.round(dur(state, g, k) * H); }
  function roleOf(state, p) { return String((state.people[p] || {}).role || '').toLowerCase(); }
  function isPool(o) { return typeof o === 'string' && o.indexOf('any:') === 0; }
  function poolRole(o) { return o.slice(4).toLowerCase(); }
  function peopleWithRole(state, role) { return Object.keys(state.people).filter(function (p) { return roleOf(state, p) === role; }); }
  function ownerValid(state, o) { return !!(o && (state.people[o] || (isPool(o) && peopleWithRole(state, poolRole(o)).length))); }
  function owner(state, g, k) {
    if (g.own && ownerValid(state, g.own[k])) return g.own[k];
    var c = tierCfg(state, g)[k];
    if (c && ownerValid(state, c.o)) return c.o;
    return state.people.hemil ? 'hemil' : Object.keys(state.people)[0];
  }
  function ownerRole(state, o) { return isPool(o) ? poolRole(o) : roleOf(state, o); }
  function ownerName(state, o) { if (isPool(o)) return 'Any ' + poolRole(o); return (state.people[o] || {}).name || o; }
  function status(g, k) { return (g.st && g.st[k] && g.st[k].s) || 'todo'; }
  function stageDone(state, g, k) { var s = status(g, k); return s === 'done' || s === 'skip' || dur(state, g, k) <= 0; }
  function isShipped(state, g) {
    return STAGES.every(function (s) { return stageDone(state, g, s.k); }) &&
           STAGES.some(function (s) { return dur(state, g, s.k) > 0; });
  }
  function shippedAt(state, g) {
    var m = null;
    STAGES.forEach(function (s) { var st = g.st && g.st[s.k]; if (st && st.s === 'done' && st.at && (!m || st.at > m)) m = st.at; });
    return m;
  }
  function started(g) { return STAGES.some(function (s) { var st = status(g, s.k); return st === 'doing' || st === 'done'; }); }

  /* ---- queue order ---- */
  function applyAuto(state) {
    var gs = state.games.slice(), idx = {};
    gs.forEach(function (g, i) { idx[g.id] = i; });
    function bucket(g) { return g.tier === 'K' ? 0 : isShipped(state, g) ? 3 : started(g) ? 1 : 2; }
    gs.sort(function (a, b) {
      var ka = bucket(a), kb = bucket(b);
      if (ka !== kb) return ka - kb;
      if (ka === 3) { var sa = shippedAt(state, a) || '', sb = shippedAt(state, b) || ''; if (sa !== sb) return sa < sb ? -1 : 1; return idx[a.id] - idx[b.id]; }
      if (ka !== 2) return idx[a.id] - idx[b.id];
      var wa = TIER_WEIGHT[a.tier], wb = TIER_WEIGHT[b.tier];
      if (wa == null) wa = 9; if (wb == null) wb = 9;
      if (wa !== wb) return wa - wb;
      var pa = a.prio || 999, pb = b.prio || 999;
      if (pa !== pb) return pa - pb;
      return idx[a.id] - idx[b.id];
    });
    state.games = gs;
  }
  function applyPriority(state) {
    state.games.sort(function (a, b) { return (a.tier === 'K' ? -1 : 0) - (b.tier === 'K' ? -1 : 0) || (a.prio || 999) - (b.prio || 999); });
  }
  function applyMix(state, n) {
    n = Math.max(1, +n || 4);
    var gs = state.games.slice().sort(function (a, b) { return (a.prio || 999) - (b.prio || 999); });
    var kit = gs.filter(function (g) { return g.tier === 'K'; });
    var light = gs.filter(function (g) { return g.tier === 'G' || g.tier === 'Y'; });
    var heavy = gs.filter(function (g) { return g.tier === 'O' || g.tier === 'R'; });
    var rest = gs.filter(function (g) { return TIER_KEYS.indexOf(g.tier) < 0; });
    var out = kit.slice(), li = 0, hi = 0;
    while (li < light.length || hi < heavy.length) {
      for (var i = 0; i < n && li < light.length; i++) out.push(light[li++]);
      if (hi < heavy.length) out.push(heavy[hi++]);
    }
    state.games = out.concat(rest);
  }

  /* ---- the list scheduler, hour slots ----
     opts: { scale: {role: factor}, m: multiplier, targetSet: {gameId: 1} (phase 1, scheduled first and scaled), strict: true } */
  function plan(state, todayISO, opts) {
    opts = opts || {};
    var S = state.settings;
    if (!S.order || S.order === 'auto') applyAuto(state);
    var from = (S.planFrom && S.planFrom > todayISO) ? S.planFrom : todayISO;
    var hol = S.holidays || [];
    while (isWeekend(from) || hol.indexOf(from) >= 0) from = addDays(from, 1);
    var days = calendar(from, hol, 400);
    var dayIdx = {}; days.forEach(function (d, i) { dayIdx[d] = i; });
    var people = Object.keys(state.people);
    var off = {};
    people.forEach(function (p) { off[p] = {}; ((S.off && S.off[p]) || []).forEach(function (d) { off[p][d] = 1; }); });
    var MAX = days.length * H;
    function dayOf(s) { return (s / H) | 0; }
    function avail(p, s) { var d = days[dayOf(s)]; return !!d && !(off[p] && off[p][d]); }
    function nextAvail(p, s) { while (s < MAX && !avail(p, s)) s++; return s; }
    function consume(p, s, n) { var c = 0; while (c < n && s < MAX) { if (avail(p, s)) c++; s++; } return s; }

    var kit = null;
    state.games.forEach(function (g) { if (g.id === KIT) kit = g; });
    var scale = opts.scale || {}, m = opts.m == null ? 1 : opts.m, T = opts.targetSet || null;
    var tasks = [], resolved = {}, byKey = {};
    state.games.forEach(function (g, gi) {
      var phase = (!T || T[g.id] || g.id === KIT) ? 1 : 2;
      STAGES.forEach(function (st) {
        var key = g.id + '.' + st.k, est = estHours(state, g, st.k), s = status(g, st.k);
        if (est <= 0 || s === 'done' || s === 'skip') { resolved[key] = 0; return; }
        var o = owner(state, g, st.k), role = ownerRole(state, o);
        var f = phase === 1 ? ((scale[role] == null ? 1 : scale[role]) * m) : 1;
        var hours = Math.max(1, Math.round(est * f));
        var rem = s === 'doing' ? Math.max(1, Math.ceil(hours / 2)) : hours;
        var deps = (g.tier === 'K' ? [] : DEPS[st.k]).map(function (k) { return g.id + '.' + k; });
        if (kit && g.id !== KIT) {
          if (st.k === 'clean') deps.push(KIT + '.sdk');
          if (st.k === 'webgl') deps.push(KIT + '.webgl');
        }
        var pool = null, p = o;
        if (isPool(o)) {
          pool = peopleWithRole(state, poolRole(o));
          var by = s === 'doing' && g.st[st.k].by;
          if (by && pool.indexOf(by) >= 0) { pool = null; p = by; } else p = null;
        }
        var t = { key: key, g: g, gi: gi, st: st.k, depth: st.depth, p: p, pool: pool, role: role, slots: rem, hours: hours, est: est, status: s, deps: deps, phase: phase };
        tasks.push(t); byKey[key] = t;
      });
    });
    var free = {}; people.forEach(function (p) { free[p] = 0; });
    var sched = [];
    function runPhase(pending) {
      while (pending.length) {
        var best = null;
        for (var i = 0; i < pending.length; i++) {
          var t = pending[i], ok = true, depEnd = 0;
          for (var j = 0; j < t.deps.length; j++) {
            var dk = t.deps[j];
            if (dk in resolved) depEnd = Math.max(depEnd, resolved[dk]);
            else if (byKey[dk]) { ok = false; break; }
          }
          if (!ok) continue;
          var cands = t.pool || [t.p], bestP = null, bestEs = Infinity;
          for (var c = 0; c < cands.length; c++) {
            var pp = cands[c], es = t.status === 'doing' ? (free[pp] || 0) : Math.max(free[pp] || 0, depEnd);
            es = nextAvail(pp, es);
            if (es < bestEs || (es === bestEs && (free[pp] || 0) < (free[bestP] || 0))) { bestEs = es; bestP = pp; }
          }
          var rank = [bestEs, t.status === 'doing' ? -1 : 0, -t.depth, t.gi];
          if (!best || cmp(rank, best.rank) < 0) best = { t: t, es: bestEs, p: bestP, rank: rank };
        }
        if (!best) break;
        var bt = best.t, end = consume(best.p, best.es, bt.slots);
        bt.p = best.p; bt.start = best.es; bt.end = end; resolved[bt.key] = end; free[best.p] = end; sched.push(bt);
        pending.splice(pending.indexOf(bt), 1);
      }
      return pending;
    }
    var left1 = runPhase(tasks.filter(function (t) { return t.phase === 1; }));
    var left2 = runPhase(tasks.filter(function (t) { return t.phase === 2; }));
    var pending = left1.concat(left2);
    pending.forEach(function (t) { t.start = null; t.end = null; t.stuckDeps = true; });

    function slotDate(s) { return days[Math.max(0, Math.min(days.length - 1, dayOf(s)))]; }
    var info = {}, targetEnd = 0;
    state.games.forEach(function (g) {
      var ts = sched.filter(function (t) { return t.g === g; });
      var end = ts.length ? Math.max.apply(null, ts.map(function (t) { return t.end; })) : null;
      var sh = isShipped(state, g);
      var budgets = {}; ts.forEach(function (t) { budgets[t.st] = t.hours; });
      info[g.id] = {
        shipped: sh, shippedAt: sh ? shippedAt(state, g) : null,
        eta: (!sh && end != null) ? slotDate(end - 1) : null,
        remainingHours: ts.reduce(function (a, t) { return a + t.slots; }, 0),
        budgets: budgets,
        started: started(g),
        blocked: pending.some(function (t) { return t.g === g; }),
        phase: (!T || T[g.id] || g.id === KIT) ? 1 : 2
      };
      if (end != null && info[g.id].phase === 1) targetEnd = Math.max(targetEnd, end);
    });
    var load = {}, loadByRole = {};
    people.forEach(function (p) { load[p] = sched.filter(function (t) { return t.p === p; }).reduce(function (a, t) { return a + t.slots; }, 0); });
    people.forEach(function (p) { var r = roleOf(state, p); loadByRole[r] = (loadByRole[r] || 0) + load[p]; });
    var finish = sched.length ? slotDate(Math.max.apply(null, sched.map(function (t) { return t.end; })) - 1) : null;
    var targetFinish = targetEnd ? slotDate(targetEnd - 1) : null;
    var todayIdx = 0;
    for (var k = 0; k < days.length; k++) { if (days[k] >= todayISO) { todayIdx = k; break; } }
    return { from: from, days: days, dayIdx: dayIdx, slotDate: slotDate, dayOf: dayOf, H: H, tasks: sched, unscheduled: pending, byKey: byKey,
             info: info, load: load, loadByRole: loadByRole, finish: finish, targetFinish: targetFinish, todayIdx: todayIdx, opts: opts };
  }
  function cmp(a, b) { for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; } return 0; }

  /* ---- fit: shrink time boxes until the target set lands by the end date ---- */
  function fit(state, todayISO) {
    var S = state.settings, dl = S.deadline;
    if (!S.order || S.order === 'auto') applyAuto(state);
    var nonKit = state.games.filter(function (g) { return g.tier !== 'K'; });
    var total = nonKit.length, shipped = nonKit.filter(function (g) { return isShipped(state, g); }).length;
    var target = Math.max(0, Math.min(total, S.target == null ? total : +S.target || 0));
    var need = Math.max(0, target - shipped);
    var T = {}, n = 0;
    nonKit.forEach(function (g) { if (!isShipped(state, g) && n < need) { T[g.id] = 1; n++; } });
    T[KIT] = 1;
    if (!dl || !validDate(dl)) {
      var P0 = plan(state, todayISO, { targetSet: T, m: 1 });
      return { plan: P0, fit: null, target: target, shipped: shipped, total: total, targetSet: T };
    }
    /* capacity per role between today and the end date, minus off days */
    var base = plan(state, todayISO, { targetSet: T, m: 1 });
    var cap = {}, load = {};
    Object.keys(state.people).forEach(function (p) {
      var r = roleOf(state, p), offs = (S.off && S.off[p]) || [], c = 0;
      base.days.forEach(function (d, i) { if (i >= base.todayIdx && d <= dl && offs.indexOf(d) < 0) c++; });
      cap[r] = (cap[r] || 0) + c * H;
    });
    base.tasks.forEach(function (t) { if (t.phase === 1) load[t.role] = (load[t.role] || 0) + t.est; });
    var scale = {};
    Object.keys(load).forEach(function (r) { scale[r] = load[r] > 0 && cap[r] != null ? Math.min(1, cap[r] / load[r]) : 1; });
    function fits(m) { var P = plan(state, todayISO, { targetSet: T, scale: scale, m: m }); return { ok: !!(P.targetFinish && P.targetFinish <= dl) || !P.targetFinish, P: P }; }
    var r1 = fits(1), m = 1, P = r1.P, ok = true;
    if (!r1.ok) {
      var r0 = fits(0);
      if (!r0.ok) { m = 0; P = r0.P; ok = false; }
      else {
        var lo = 0, hi = 1;
        for (var i = 0; i < 14; i++) { var mid = (lo + hi) / 2; if (fits(mid).ok) lo = mid; else hi = mid; }
        m = lo; P = fits(lo).P;
      }
    }
    var eff = {}; Object.keys(scale).forEach(function (r) { eff[r] = Math.round(scale[r] * m * 100); });
    var fitCount = 0;
    nonKit.forEach(function (g) { var inf = P.info[g.id]; if (inf.shipped || (inf.eta && inf.eta <= dl)) fitCount++; });
    var workdays = 0; base.days.forEach(function (d, i) { if (i >= base.todayIdx && d <= dl) workdays++; });
    return { plan: P, fit: { ok: ok, scale: scale, m: m, eff: eff, cap: cap, load: load, fitCount: fitCount, workdays: workdays, deadline: dl },
             target: target, shipped: shipped, total: total, targetSet: T };
  }

  /* ---- helpers for views ---- */
  function tasksOn(P, p, di) {
    var a = di * H, b = a + H;
    return P.tasks.filter(function (t) { return t.p === p && t.start < b && t.end > a; })
      .sort(function (x, y) { return x.start - y.start; });
  }
  function hoursOn(t, di) { var a = di * H, b = a + H; return Math.max(0, Math.min(t.end, b) - Math.max(t.start, a)); }
  function shipsOn(P, state, di) {
    var out = [];
    state.games.forEach(function (g) {
      if (g.tier === 'K') return;
      var inf = P.info[g.id];
      if (inf.shipped) return;
      if (inf.eta === P.days[di]) out.push(g);
    });
    return out;
  }
  function nextShip(P, state) {
    var best = null;
    state.games.forEach(function (g) {
      if (g.tier === 'K') return;
      var inf = P.info[g.id];
      if (!inf.shipped && inf.eta && (!best || inf.eta < best.date)) best = { g: g, date: inf.eta };
    });
    return best;
  }
  function monthProjection(P, state) {
    var m = {};
    state.games.forEach(function (g) {
      if (g.tier === 'K') return;
      var inf = P.info[g.id], d = inf.shipped ? inf.shippedAt : inf.eta;
      if (!d) return; var k = monthKey(d); m[k] = (m[k] || 0) + 1;
    });
    return m;
  }
  /* what the target needs at full estimates: people per role for the remaining working days */
  function headcountAtFullEstimates(F) {
    if (!F.fit) return null;
    var out = {};
    Object.keys(F.fit.load).forEach(function (r) { if (F.fit.load[r] > 0) out[r] = F.fit.workdays > 0 ? Math.ceil(F.fit.load[r] / (F.fit.workdays * H)) : Infinity; });
    return out;
  }

  /* ---- backup ---- */
  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function backupRows(state, P) {
    var head = ['#', 'Game', 'Tier', 'Wave'];
    STAGES.forEach(function (s) { head.push(s.label + ' status', s.label + ' done', s.label + ' owner', s.label + ' box (h)'); });
    head.push('Lands', 'Shipped', 'Stuck', 'Note');
    var rows = [head];
    state.games.forEach(function (g, i) {
      var inf = P.info[g.id], r = [i + 1, g.name, TIERS[g.tier] || g.tier, g.tier === 'K' ? '' : inf.phase];
      STAGES.forEach(function (s) {
        var st = (g.st && g.st[s.k]) || {}, d = dur(state, g, s.k);
        r.push(d <= 0 ? 'n/a' : (st.s || 'todo'), st.at || '', d <= 0 ? '' : ownerName(state, owner(state, g, s.k)), inf.budgets[s.k] || '');
      });
      r.push(inf.eta || '', inf.shippedAt || '', g.flag ? (g.flag.stage + ': ' + g.flag.note) : '', g.note || '');
      rows.push(r);
    });
    return rows;
  }
  function logRows(state) {
    var rows = [['Time', 'Who', 'What']];
    (state.log || []).forEach(function (e) { rows.push([e.t, (state.people[e.who] || {}).name || e.who, e.msg]); });
    return rows;
  }
  function toCSV(rows) { return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); }
  function toTSV(rows) { return rows.map(function (r) { return r.map(function (v) { return String(v == null ? '' : v).replace(/[\t\n]/g, ' '); }).join('\t'); }).join('\n'); }
  function backupCSV(state, P) {
    return 'WebGL Line backup ' + P.from + '\r\n\r\nGAMES\r\n' + toCSV(backupRows(state, P)) + '\r\n\r\nACTIVITY\r\n' + toCSV(logRows(state));
  }

  /* ---- Google Sheet archive ---- */
  /* Legacy log entries predate ids. A stable hash of the entry lets the sheet dedupe them
     the same way it dedupes new ones, so replaying a backlog never doubles a row. */
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
  function logId(e) { return 'lg' + hash(String(e.t) + '|' + String(e.who) + '|' + String(e.msg)); }
  function backfillLogIds(state) { (state.log || []).forEach(function (e) { if (!e.id) e.id = logId(e); }); return state; }
  /* activity is oldest-first so the sheet reads top to bottom; state.log is newest-first. */
  function sheetPayload(state, P, o) {
    o = o || {};
    var nk = state.games.filter(function (g) { return g.tier !== 'K'; });
    return {
      activity: (state.log || []).slice().reverse().map(function (e) {
        return { id: e.id || logId(e), t: e.t, who: (state.people[e.who] || {}).name || e.who, msg: e.msg, k: e.k || '' };
      }),
      snapshot: { key: o.key || '', at: o.at || '', by: o.by || '', games: nk.length,
                  shipped: nk.filter(function (g) { return isShipped(state, g); }).length, json: JSON.stringify(state) },
      board: backupRows(state, P)
    };
  }
  return {
    H: H, STAGES: STAGES, STAGE: STAGE, DEPS: DEPS, TIERS: TIERS, TIER_KEYS: TIER_KEYS, KIT: KIT, DOWS: DOWS, MONS: MONS,
    toISO: toISO, parse: parse, addDays: addDays, dow: dow, isWeekend: isWeekend, monday: monday, validDate: validDate,
    fmt: fmt, fmtLong: fmtLong, monthName: monthName, monthKey: monthKey, daysLabel: daysLabel, hoursLabel: hoursLabel,
    dur: dur, estHours: estHours, owner: owner, ownerName: ownerName, ownerRole: ownerRole, isPool: isPool, roleOf: roleOf, peopleWithRole: peopleWithRole,
    status: status, stageDone: stageDone, isShipped: isShipped, shippedAt: shippedAt, started: started,
    applyAuto: applyAuto, applyPriority: applyPriority, applyMix: applyMix, plan: plan, fit: fit,
    tasksOn: tasksOn, hoursOn: hoursOn, shipsOn: shipsOn, nextShip: nextShip, monthProjection: monthProjection, headcountAtFullEstimates: headcountAtFullEstimates,
    logId: logId, backfillLogIds: backfillLogIds, sheetPayload: sheetPayload,
    backupRows: backupRows, logRows: logRows, toCSV: toCSV, toTSV: toTSV, backupCSV: backupCSV
  };
})();
if (typeof module !== 'undefined') module.exports = Line;
