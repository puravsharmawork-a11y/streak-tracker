// Streak tracker server: Node http + hosted Postgres (Neon / Supabase / any Postgres).
// Data lives in the external database, so it survives restarts and redeploys.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL env var. Set it to your Neon/Supabase Postgres connection string.');
  process.exit(1);
}

const isLocal = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
});
// Hosted DBs may drop idle connections; don't crash the server when that happens.
pool.on('error', (e) => console.error('Idle DB client error:', e.message));

const q = (text, params) => pool.query(text, params);

async function initDb() {
  await q(`CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    due_date TEXT NOT NULL,          -- day the task was planned for (YYYY-MM-DD)
    done INTEGER NOT NULL DEFAULT 0,
    completed_date TEXT,             -- day it was finished (drives the heatmap)
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await q('CREATE INDEX IF NOT EXISTS idx_due ON tasks(due_date)');
  await q('CREATE INDEX IF NOT EXISTS idx_done ON tasks(completed_date)');
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

async function dayView(date, today) {
  const tasks = (await q('SELECT * FROM tasks WHERE due_date = $1 ORDER BY done, id', [date])).rows;
  // Unfinished tasks from earlier days roll forward to "today" automatically.
  const carried = date === today
    ? (await q('SELECT * FROM tasks WHERE done = 0 AND due_date < $1 ORDER BY due_date, id', [today])).rows : [];
  return { tasks, carried };
}

async function stats(today) {
  const from = addDays(today, -370);
  const heat = {};
  const heatRows = (await q('SELECT completed_date AS d, COUNT(*)::int AS c FROM tasks WHERE done = 1 AND completed_date >= $1 GROUP BY completed_date', [from])).rows;
  for (const r of heatRows) heat[r.d] = r.c;
  const totalDone = (await q('SELECT COUNT(*)::int AS c FROM tasks WHERE done = 1')).rows[0].c;
  const pending = (await q('SELECT COUNT(*)::int AS c FROM tasks WHERE done = 0 AND due_date <= $1', [today])).rows[0].c;
  const upcoming = (await q('SELECT COUNT(*)::int AS c FROM tasks WHERE done = 0 AND due_date > $1', [today])).rows[0].c;
  const allDays = (await q('SELECT DISTINCT completed_date AS d FROM tasks WHERE done = 1 AND completed_date IS NOT NULL ORDER BY d')).rows.map((r) => r.d);
  const set = new Set(allDays);
  // current streak: counts back from today (or yesterday if nothing done yet today)
  let streak = 0, d = set.has(today) ? today : addDays(today, -1);
  while (set.has(d)) { streak++; d = addDays(d, -1); }
  let best = 0, run = 0, prev = null;
  for (const x of allDays) { run = prev && addDays(prev, 1) === x ? run + 1 : 1; best = Math.max(best, run); prev = x; }
  return { heat, totalDone, pending, upcoming, todayDone: heat[today] || 0, streak, best, activeDays: allDays.length };
}

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/day' && req.method === 'GET') {
      const date = url.searchParams.get('date'), today = url.searchParams.get('today');
      if (!isDate(date) || !isDate(today)) return send(res, 400, { error: 'bad date' });
      return send(res, 200, await dayView(date, today));
    }
    if (p === '/api/stats' && req.method === 'GET') {
      const today = url.searchParams.get('today');
      if (!isDate(today)) return send(res, 400, { error: 'bad date' });
      return send(res, 200, await stats(today));
    }
    if (p === '/api/tasks' && req.method === 'POST') {
      const { title, date } = await readBody(req);
      if (!title || !String(title).trim() || !isDate(date)) return send(res, 400, { error: 'title and date required' });
      const r = await q('INSERT INTO tasks (title, due_date) VALUES ($1, $2) RETURNING id', [String(title).trim().slice(0, 200), date]);
      return send(res, 201, { id: r.rows[0].id });
    }
    const m = p.match(/^\/api\/tasks\/(\d+)$/);
    if (m && req.method === 'PATCH') {
      const id = Number(m[1]);
      const { done, today, title } = await readBody(req);
      if (typeof done === 'boolean' && isDate(today))
        await q('UPDATE tasks SET done = $1, completed_date = $2 WHERE id = $3', [done ? 1 : 0, done ? today : null, id]);
      if (typeof title === 'string' && title.trim())
        await q('UPDATE tasks SET title = $1 WHERE id = $2', [title.trim().slice(0, 200), id]);
      return send(res, 200, { ok: true });
    }
    if (m && req.method === 'DELETE') { await q('DELETE FROM tasks WHERE id = $1', [Number(m[1])]); return send(res, 200, { ok: true }); }
    if (p === '/healthz') return send(res, 200, { ok: true });

    // static files
    const file = path.join(__dirname, 'public', p === '/' ? 'index.html' : p);
    if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); send(res, 500, { error: 'server error' }); }
});

initDb()
  .then(() => server.listen(PORT, () => console.log(`Streak tracker running on http://localhost:${PORT}  (Postgres)`)))
  .catch((e) => { console.error('Could not connect to the database:', e.message); process.exit(1); });
