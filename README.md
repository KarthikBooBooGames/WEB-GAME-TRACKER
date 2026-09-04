# WebGL Line

Shared daily task board for the WebGL conversion line. Plain HTML, CSS and JavaScript, served by a tiny Node process. The board itself lives in Supabase behind a team passcode, so everyone sees one board and every tap is shared.

The producer sets three things under **Plan**: start date, end date, target (games by the end date). The board does the rest: it orders the queue, hands stages to whoever is free, and gives every stage a **time box** sized so that the target lands by the end date. Nothing is planned past the end date. As days pass, it re-fits the remaining work into the remaining time every time someone taps Done.

## Deploy in 10 minutes

### 1. Supabase (the database)
1. Create a project at supabase.com (free tier is fine).
2. Open **SQL Editor**, paste `supabase/schema.sql`, change `CHANGE-ME` to your team passcode, run it.
3. Note two values from **Project Settings → API**: the **Project URL** and the **anon public key**.

### 2. Railway (the hosting)
1. Push this folder to a GitHub repo (or use `railway up` from the Railway CLI).
2. In Railway: **New Project → Deploy from GitHub repo**. It detects Node and runs `npm start`.
3. Add these **Variables** to the service:
   - `SUPABASE_URL` = your project URL, for example `https://abcd1234.supabase.co`
   - `SUPABASE_ANON_KEY` = the anon public key
   - `BOARD_ID` = `main`
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
- `tools/tests.js` — scheduler tests (`npm test`)

## Backups
**Plan → Backup**: Download CSV (opens in Google Sheets), Copy for Sheets, Download full JSON. **Restore from JSON** is under Plan → Advanced. To move a board from the old claude.ai version, download its JSON there and restore it here.
