const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'bunker-secret-2077';
const db = new Database('/data/bunker.db');

app.use(cors());
app.use(express.json());

// ─── DB INIT ───────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    avatar TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bunkers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    description TEXT,
    capacity INTEGER DEFAULT 10,
    status TEXT DEFAULT 'planning',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS bunker_members (
    bunker_id TEXT,
    user_id TEXT,
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (bunker_id, user_id),
    FOREIGN KEY (bunker_id) REFERENCES bunkers(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    bunker_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    x INTEGER DEFAULT 0,
    y INTEGER DEFAULT 0,
    width INTEGER DEFAULT 2,
    height INTEGER DEFAULT 2,
    color TEXT DEFAULT '#4a5c3a',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bunker_id) REFERENCES bunkers(id)
  );

  CREATE TABLE IF NOT EXISTS supplies (
    id TEXT PRIMARY KEY,
    bunker_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity INTEGER DEFAULT 0,
    unit TEXT DEFAULT 'units',
    min_quantity INTEGER DEFAULT 0,
    added_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bunker_id) REFERENCES bunkers(id)
  );
`);

// Seed admin user
const admin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!admin) {
  const hash = bcrypt.hashSync('admin', 10);
  db.prepare('INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)').run(uuidv4(), 'admin', hash, 'admin');
  console.log('Admin seeded: admin / admin');
}

// ─── MIDDLEWARE ─────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// ─── AUTH ────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const id = uuidv4();
    db.prepare('INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)').run(id, username, hash, 'member');
    const token = jwt.sign({ id, username, role: 'member' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id, username, role: 'member' } });
  } catch (e) {
    res.status(400).json({ error: 'Username taken' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
});

// ─── USERS (admin only) ──────────────────────────────────────────────────────
app.get('/api/users', auth, requireRole('admin'), (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users').all();
  res.json(users);
});

app.patch('/api/users/:id/role', auth, requireRole('admin'), (req, res) => {
  const { role } = req.body;
  if (!['admin', 'commander', 'member'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ success: true });
});

// ─── BUNKERS ─────────────────────────────────────────────────────────────────
app.get('/api/bunkers', auth, (req, res) => {
  let bunkers;
  if (req.user.role === 'admin') {
    bunkers = db.prepare(`
      SELECT b.*, u.username as owner_name,
      (SELECT COUNT(*) FROM bunker_members bm WHERE bm.bunker_id = b.id) as member_count
      FROM bunkers b JOIN users u ON b.owner_id = u.id
    `).all();
  } else {
    bunkers = db.prepare(`
      SELECT b.*, u.username as owner_name,
      (SELECT COUNT(*) FROM bunker_members bm WHERE bm.bunker_id = b.id) as member_count
      FROM bunkers b JOIN users u ON b.owner_id = u.id
      LEFT JOIN bunker_members bm ON bm.bunker_id = b.id AND bm.user_id = ?
      WHERE b.owner_id = ? OR bm.user_id = ?
    `).all(req.user.id, req.user.id, req.user.id);
  }
  res.json(bunkers);
});

app.post('/api/bunkers', auth, (req, res) => {
  const { name, description, capacity } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = uuidv4();
  db.prepare('INSERT INTO bunkers (id, name, owner_id, description, capacity) VALUES (?, ?, ?, ?, ?)').run(id, name, req.user.id, description || '', capacity || 10);
  db.prepare('INSERT INTO bunker_members (bunker_id, user_id, role) VALUES (?, ?, ?)').run(id, req.user.id, 'commander');
  res.json({ id, name, owner_id: req.user.id, description, capacity, status: 'planning' });
});

app.patch('/api/bunkers/:id', auth, (req, res) => {
  const bunker = db.prepare('SELECT * FROM bunkers WHERE id = ?').get(req.params.id);
  if (!bunker) return res.status(404).json({ error: 'Not found' });
  if (bunker.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { name, description, capacity, status } = req.body;
  db.prepare('UPDATE bunkers SET name=COALESCE(?,name), description=COALESCE(?,description), capacity=COALESCE(?,capacity), status=COALESCE(?,status) WHERE id=?')
    .run(name, description, capacity, status, req.params.id);
  res.json({ success: true });
});

app.delete('/api/bunkers/:id', auth, (req, res) => {
  const bunker = db.prepare('SELECT * FROM bunkers WHERE id = ?').get(req.params.id);
  if (!bunker) return res.status(404).json({ error: 'Not found' });
  if (bunker.owner_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM supplies WHERE bunker_id = ?').run(req.params.id);
  db.prepare('DELETE FROM rooms WHERE bunker_id = ?').run(req.params.id);
  db.prepare('DELETE FROM bunker_members WHERE bunker_id = ?').run(req.params.id);
  db.prepare('DELETE FROM bunkers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Bunker members
app.get('/api/bunkers/:id/members', auth, (req, res) => {
  const members = db.prepare(`
    SELECT u.id, u.username, u.role as system_role, bm.role as bunker_role, bm.joined_at
    FROM bunker_members bm JOIN users u ON bm.user_id = u.id WHERE bm.bunker_id = ?
  `).all(req.params.id);
  res.json(members);
});

app.post('/api/bunkers/:id/invite', auth, (req, res) => {
  const { username } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const exists = db.prepare('SELECT 1 FROM bunker_members WHERE bunker_id = ? AND user_id = ?').get(req.params.id, user.id);
  if (exists) return res.status(400).json({ error: 'Already a member' });
  db.prepare('INSERT INTO bunker_members (bunker_id, user_id, role) VALUES (?, ?, ?)').run(req.params.id, user.id, 'member');
  res.json({ success: true });
});

// ─── ROOMS (LAYOUT) ──────────────────────────────────────────────────────────
app.get('/api/bunkers/:id/rooms', auth, (req, res) => {
  const rooms = db.prepare('SELECT * FROM rooms WHERE bunker_id = ?').all(req.params.id);
  res.json(rooms);
});

app.post('/api/bunkers/:id/rooms', auth, (req, res) => {
  const { name, type, x, y, width, height, color } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO rooms (id, bunker_id, name, type, x, y, width, height, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, name, type, x || 0, y || 0, width || 2, height || 2, color || '#4a5c3a');
  res.json({ id, bunker_id: req.params.id, name, type, x, y, width, height, color });
});

app.patch('/api/rooms/:id', auth, (req, res) => {
  const { name, type, x, y, width, height, color } = req.body;
  db.prepare('UPDATE rooms SET name=COALESCE(?,name), type=COALESCE(?,type), x=COALESCE(?,x), y=COALESCE(?,y), width=COALESCE(?,width), height=COALESCE(?,height), color=COALESCE(?,color) WHERE id=?')
    .run(name, type, x, y, width, height, color, req.params.id);
  res.json({ success: true });
});

app.delete('/api/rooms/:id', auth, (req, res) => {
  db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── SUPPLIES ─────────────────────────────────────────────────────────────────
app.get('/api/bunkers/:id/supplies', auth, (req, res) => {
  const supplies = db.prepare('SELECT * FROM supplies WHERE bunker_id = ? ORDER BY category, name').all(req.params.id);
  res.json(supplies);
});

app.post('/api/bunkers/:id/supplies', auth, (req, res) => {
  const { name, category, quantity, unit, min_quantity } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO supplies (id, bunker_id, name, category, quantity, unit, min_quantity, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, name, category, quantity || 0, unit || 'units', min_quantity || 0, req.user.id);
  res.json({ id, name, category, quantity, unit, min_quantity });
});

app.patch('/api/supplies/:id', auth, (req, res) => {
  const { name, category, quantity, unit, min_quantity } = req.body;
  db.prepare('UPDATE supplies SET name=COALESCE(?,name), category=COALESCE(?,category), quantity=COALESCE(?,quantity), unit=COALESCE(?,unit), min_quantity=COALESCE(?,min_quantity) WHERE id=?')
    .run(name, category, quantity, unit, min_quantity, req.params.id);
  res.json({ success: true });
});

app.delete('/api/supplies/:id', auth, (req, res) => {
  db.prepare('DELETE FROM supplies WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── HEALTH (public, for Docker healthcheck) ─────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ─── STATS ───────────────────────────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  const totalBunkers = db.prepare('SELECT COUNT(*) as c FROM bunkers').get().c;
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const totalSupplies = db.prepare('SELECT SUM(quantity) as c FROM supplies').get().c || 0;
  const totalRooms = db.prepare('SELECT COUNT(*) as c FROM rooms').get().c;
  res.json({ totalBunkers, totalUsers, totalSupplies, totalRooms });
});

app.listen(PORT, () => console.log(`Bunker API running on :${PORT}`));
