# WebGL Line

Shared daily task board for the WebGL conversion line. Plain HTML, CSS and JavaScript, served by a tiny Node process. The board itself lives in Supabase behind a team passcode, so everyone sees one board and every tap is shared.

The producer sets three things under **Plan**: start date, end date, target (games by the end date). The board does the rest: it orders the queue, hands stages to whoever is free, and gives every stage a **time box** sized so that the target lands by the end date. Nothing is planned past the end date. As days pass, it re-fits the remaining work into the remaining time every time someone taps Done.

## Deploy in 10 minutes

### 1. Supabase (the database)
1. Create a project at supabase.com (free tier is fine).
2. Open **SQL Editor**, paste `supabase/schema.sql`, change `CHANGE-ME` to your team passcode, run it.
3. Note two values from **Project Settings → API**: the **Project URL** and the **anon public key**.

### 2. Google Sheet (the permanent archive, optional but recommended)
1. Create a Google Sheet. Name it whatever you like; leave it empty.
2. **Extensions → Apps Script**. Delete the placeholder code, paste `google/Code.gs`.
3. At the top, change `CHANGE-ME-SHEET-TOKEN` to a long random string **that you make up**. It is a shared password between your server and the script — Google does not give it to you, and it is not the deployment id. Save.
4. **Deploy → New deployment → Web app**. Execute as **Me**, "Who has access" **Anyone**. Deploy, approve the permission prompt, copy the `/exec` URL.
5. Keep that URL and the token for the next step.

Two settings people get wrong here, both of which produce an `Access denied` page:
- **Who has access must be "Anyone"**, not "Anyone with Google account" and not "Only myself". Your server calls this without being signed in as you.
- **Editing `Code.gs` does not update the live web app.** After any change: Deploy → Manage deployments → edit (pencil) → Version: **New version** → Deploy.

Check it before going further:

```bash
npm run check:sheet
```

The "Anyone" setting is what lets your server reach it; the token is what stops anyone else. Treat the token like the passcode.

### 3. Railway (the hosting)
1. Push this folder to a GitHub repo (or use `railway up` from the Railway CLI).
2. In Railway: **New Project → Deploy from GitHub repo**. It detects Node and runs `npm start`.
3. Add these **Variables** to the service:
   - `SUPABASE_URL` = your project URL, for example `https://abcd1234.supabase.co`
   - `SUPABASE_ANON_KEY` = the anon public key
   - `BOARD_ID` = `main`
   - `SHEET_WEBAPP_URL` = the `/exec` URL from step 2 (skip to run without the archive)
   - `SHEET_TOKEN` = the token you set in `Code.gs`
4. Open the generated URL. Pick your name, enter the passcode once. Done.

Share the URL and the passcode with the team. Each person picks themselves once; the browser remembers.

### Change the passcode
Re-run the `insert into public.board_secrets ...` line from `supabase/schema.sql` with the new value. Everyone enters it once on their next visit.

### No Supabase yet?
Leave the variables empty and the board runs in **local mode**: it saves in that browser only. Good for a first look, not for a team.

## What is where
- `public/index.html`, `public/styles.css`, `public/app.js` — the app
- `public/sched.js` — the scheduler (hour-based time boxes, fit-to-end-date)
- `public/seed.js` — the starting board (games, people, defaults). Regenerate with `npm run seed` after editing `tools/seed.js`.
- `server.js` — static server; also serves `/config.js` from the environment variables
- `supabase/schema.sql` — tables, passcode, and the two functions the app calls
- `google/Code.gs` — the Google Sheet archive (paste into Apps Script, deploy as a web app)
- `tools/tests.js` — scheduler tests (`npm test`)
- `tools/check-sheet.js` — verifies the archive is wired up (`npm run check:sheet`)
- `tools/push-sheet.js` — one-shot full backup into the sheet (`npm run push:sheet`)

## The Google Sheet archive

With `SHEET_WEBAPP_URL` and `SHEET_TOKEN` set, the board writes itself into your sheet:

- **After every change** — any tap, edit or status change, about four seconds after it saves.
- **Once an hour**, as a backstop for a board left open with nothing happening.
- **When the tab closes**, via a beacon, so a pending change is not lost.
- **On demand** — Plan → Backup → **Save to Google Sheet now**.

An idle hourly beat costs nothing: the snapshot is keyed by board version and the activity by event id, so a sync with no changes adds no rows.

Three tabs appear on their own:

| Tab | What it holds | Rewritten? |
| --- | --- | --- |
| **Activity** | One row per event, ever — who tapped what, when. | Never. Rows are only added. |
| **Snapshots** | One row per saved version, with the complete board JSON. | Never. Rows are only added. |
| **Board** | The queue as it stands now: every game, its stages, owners, time boxes, landing date. | Yes, on each sync — every past version of it is still in Snapshots. |

Nothing is ever deleted from Activity or Snapshots. The board's own activity log keeps only the last 400 events to stay small, but the sheet keeps all of them forever, so it outlives the board.

**It heals itself.** Every sync resends the whole log and the sheet ignores ids it already has. If someone's browser is offline when they tap Done, the rows are pushed by whoever saves next — the log is shared state, so any teammate's browser can flush the backlog. Failed syncs retry with a backoff, and the header shows `Sheet ✓` or what went wrong.

**To back up everything at once**, from your machine rather than the browser:

```bash
npm run push:sheet
```

That pulls the live board from Supabase (add `BOARD_PASSCODE` to `.env`, or pass `--pass <passcode>`) and writes all three tabs including the Board. Without Supabase configured it uses the starting board. To push an export instead:

```bash
npm run push:sheet -- --file webgl-line-full-2026-09-04.json
```

**To restore from a snapshot:** open the Snapshots row you want, copy the *State JSON* cell (and the cells to its right if the JSON spilled over — Sheets caps a cell at 50,000 characters), paste the joined text into **Plan → Advanced → Restore from JSON**.

The browser never sees the script URL or the token. It posts to `/sheet` on your own server, which adds them and forwards the request.

## Backups
**Plan → Backup**: Download CSV (opens in Google Sheets), Copy for Sheets, Download full JSON. **Restore from JSON** is under Plan → Advanced. To move a board from the old claude.ai version, download its JSON there and restore it here.
