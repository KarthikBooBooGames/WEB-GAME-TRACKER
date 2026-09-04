/* WebGL Line → Google Sheets archive. Paste this into Extensions → Apps Script on your sheet,
   set TOKEN below, then Deploy → New deployment → Web app (execute as Me, access Anyone).

   Activity and Snapshots are append-only: rows are added, never rewritten and never removed.
   Board is a readable mirror of the current queue, rewritten on each sync — every past version
   of it is still recoverable from the Snapshots tab. */

var TOKEN = 'CHANGE-ME-SHEET-TOKEN';
var CELL_MAX = 45000; /* a Sheets cell holds 50k characters; long snapshots spill into more columns */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (err) { return out({ ok: false, error: 'busy' }); }
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!TOKEN || body.token !== TOKEN) return out({ ok: false, error: 'bad_token' });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    return out({ ok: true,
      activity: appendActivity(ss, body.activity || []),
      snapshot: appendSnapshot(ss, body.snapshot),
      board: writeBoard(ss, body.board) });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}
function doGet() { return out({ ok: true, service: 'webgl-line-archive' }); }
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function tab(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function widen(sh, n) { var c = sh.getMaxColumns(); if (c < n) sh.insertColumnsAfter(c, n - c); }

/* Append-only. Rows already carrying the same event id are skipped, so a client may safely
   resend its whole backlog after being offline — and any teammate's client can push it instead. */
function appendActivity(ss, rows) {
  if (!rows || !rows.length) return 0;
  var sh = tab(ss, 'Activity', ['Event ID', 'Time', 'Who', 'What', 'Kind']);
  var last = sh.getLastRow(), seen = {};
  if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { seen[String(r[0])] = 1; });
  var add = [];
  rows.forEach(function (r) {
    var id = String(r.id || '');
    if (!id || seen[id]) return;
    seen[id] = 1;
    add.push([id, String(r.t || ''), String(r.who || ''), String(r.msg || ''), String(r.k || '')]);
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 5).setValues(add);
  return add.length;
}

/* Append-only. One row per board version; the full JSON is the restore point. */
function appendSnapshot(ss, s) {
  if (!s || !s.key) return 0;
  var sh = tab(ss, 'Snapshots', ['Key', 'Saved at', 'By', 'Games', 'Shipped', 'State JSON']);
  var last = sh.getLastRow();
  if (last > 1) {
    var keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) if (String(keys[i][0]) === String(s.key)) return 0;
  }
  var json = String(s.json || ''), chunks = [];
  for (var p = 0; p < json.length; p += CELL_MAX) chunks.push(json.substr(p, CELL_MAX));
  if (!chunks.length) chunks = [''];
  var row = [String(s.key), String(s.at || ''), String(s.by || ''), s.games || 0, s.shipped || 0].concat(chunks);
  widen(sh, row.length);
  sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return 1;
}

/* The one rewritten tab: the queue as it stands right now. History lives in Snapshots. */
function writeBoard(ss, rows) {
  if (!rows || !rows.length) return 0;
  var sh = ss.getSheetByName('Board') || ss.insertSheet('Board');
  var w = 0;
  rows.forEach(function (r) { w = Math.max(w, r.length); });
  var norm = rows.map(function (r) {
    var a = [];
    for (var i = 0; i < w; i++) a.push(r[i] == null ? '' : r[i]);
    return a;
  });
  widen(sh, w);
  var maxR = sh.getMaxRows();
  if (maxR < norm.length) sh.insertRowsAfter(maxR, norm.length - maxR);
  sh.clear();
  sh.getRange(1, 1, norm.length, w).setValues(norm);
  sh.getRange(1, 1, 1, w).setFontWeight('bold');
  sh.setFrozenRows(1);
  return norm.length - 1;
}
