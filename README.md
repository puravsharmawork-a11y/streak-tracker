# Streak Tracker

Daily tasks + GitHub-style green heatmap. No signup, no npm install (zero dependencies).
Node 22.13+ (uses the built-in `node:sqlite`).

## Run locally
    node server.js        # http://localhost:3000

## Deploy on Render
1. Push this folder to a GitHub repo.
2. Render > New > Web Service > connect the repo.
   Runtime: Node. Build command: (leave empty). Start command: `node server.js`.
3. IMPORTANT, keep your data: Render's free instances have no persistent disk, so the
   database resets on every redeploy/restart. Use a paid instance, add a Disk
   (mount path `/var/data`) and set env var `DB_PATH=/var/data/tracker.db`.
   `render.yaml` already does this if you deploy as a Blueprint.

## How it works
- Heatmap shade = tasks completed that day: 1 / 2-3 / 4-5 / 6+ (4 green shades).
- Unfinished tasks roll forward to today under "Pending from earlier days".
- Click any heatmap square (or use the arrows) to view/add tasks on that day.
- Only tasks are stored; heatmap, streaks and totals are calculated from them.
- No login: anyone with the URL can use it, so keep it private.
