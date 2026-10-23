// Zero-dependency server: Node's built-in http + node:sqlite. No npm install needed.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'tracker.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,        -- day the task was planned for (YYYY-MM-DD)
  done INTEGER NOT NULL DEFAULT 0,
  completed_date TEXT,           -- day it was finished (drives the heatmap)
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_done ON tasks(completed_date);`);

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

function dayView(date, today) {
  const tasks = db.prepare('SELECT * FROM tasks WHERE due_date = ? ORDER BY done, id').all(date);
  // Unfinished tasks from earlier days roll forward to "today" automatically.
  const carried = date === today
    ? db.prepare('SELECT * FROM tasks WHERE done = 0 AND due_date < ? ORDER BY due_date, id').all(today) : [];
  return { tasks, carried };
}

function stats(today) {
  const from = addDays(today, -370);
  const heat = {};
  for (const r of db.prepare('SELECT completed_date d, COUNT(*) c FROM tasks WHERE done=1 AND completed_date >= ? GROUP BY d').all(from)) heat[r.d] = r.c;
  const totalDone = db.prepare('SELECT COUNT(*) c FROM tasks WHERE done=1').get().c;
  const pending = db.prepare('SELECT COUNT(*) c FROM tasks WHERE done=0 AND due_date <= ?').get(today).c;
  const upcoming = db.prepare('SELECT COUNT(*) c FROM tasks WHERE done=0 AND due_date > ?').get(today).c;
  const allDays = db.prepare('SELECT DISTINCT completed_date d FROM tasks WHERE done=1 ORDER BY d').all().map((r) => r.d);
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

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/day' && req.method === 'GET') {
      const date = url.searchParams.get('date'), today = url.searchParams.get('today');
      if (!isDate(date) || !isDate(today)) return send(res, 400, { error: 'bad date' });
      return send(res, 200, dayView(date, today));
    }
    if (p === '/api/stats' && req.method === 'GET') {
      const today = url.searchParams.get('today');
      if (!isDate(today)) return send(res, 400, { error: 'bad date' });
      return send(res, 200, stats(today));
    }
    if (p === '/api/tasks' && req.method === 'POST') {
      const { title, date } = await readBody(req);
      if (!title || !String(title).trim() || !isDate(date)) return send(res, 400, { error: 'title and date required' });
      const r = db.prepare('INSERT INTO tasks (title, due_date) VALUES (?, ?)').run(String(title).trim().slice(0, 200), date);
      return send(res, 201, { id: Number(r.lastInsertRowid) });
    }
    const m = p.match(/^\/api\/tasks\/(\d+)$/);
    if (m && req.method === 'PATCH') {
      const { done, today, title } = await readBody(req);
      if (typeof done === 'boolean' && isDate(today))
        db.prepare('UPDATE tasks SET done=?, completed_date=? WHERE id=?').run(done ? 1 : 0, done ? today : null, m[1]);
      if (typeof title === 'string' && title.trim()) db.prepare('UPDATE tasks SET title=? WHERE id=?').run(title.trim().slice(0, 200), m[1]);
      return send(res, 200, { ok: true });
    }
    if (m && req.method === 'DELETE') { db.prepare('DELETE FROM tasks WHERE id=?').run(m[1]); return send(res, 200, { ok: true }); }
    if (p === '/healthz') return send(res, 200, { ok: true });

    // static files
    const file = path.join(__dirname, 'public', p === '/' ? 'index.html' : p);
    if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { console.error(e); send(res, 500, { error: 'server error' }); }
}).listen(PORT, () => console.log(`Streak tracker running on http://localhost:${PORT}  (db: ${DB_PATH})`));
