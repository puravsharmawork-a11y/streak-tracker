# Streak Tracker

Daily tasks + GitHub-style green heatmap. No signup. Data is stored in a free hosted
Postgres (Neon or Supabase), so it survives restarts, redeploys and sleeping servers.

## 1. Get a free database (Neon)
1. Sign up at https://neon.tech and create a project.
2. Copy the **connection string** (looks like `postgresql://user:pass@host/dbname?sslmode=require`).
   (Supabase works too: Project Settings > Database > Connection string > URI.)
The table is created automatically on first start.

## 2. Run locally
    npm install
    DATABASE_URL="postgresql://..." node server.js     # http://localhost:3000

## 3. Deploy on Render (free)
1. Push this folder to a GitHub repo.
2. Render > New > Web Service > connect the repo.
   Build command: `npm install`   Start command: `node server.js`
3. Environment > add `DATABASE_URL` = your connection string. Deploy.

## How it works
- Heatmap shade = tasks completed that day: 1 / 2-3 / 4-5 / 6+ (4 green shades).
- Unfinished tasks roll forward to today under "Pending from earlier days".
- Click any heatmap square (or use the arrows) to view/add tasks on that day.
- Only tasks are stored; heatmap, streaks and totals are calculated from them.
- No login: anyone with the URL can use it, so keep it private.
