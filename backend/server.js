const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const Parser = require('rss-parser');

const app = express();
const PORT = 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'bunker-secret-2077';
const APP_VERSION = '2.7.0';
const db = new Database('/data/bunker.db');
const parser = new Parser();

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

  CREATE TABLE IF NOT EXISTS rss_feeds (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS duty_roster (
    id TEXT PRIMARY KEY,
    bunker_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    shift_name TEXT NOT NULL,
    shift_start TEXT NOT NULL,
    shift_end TEXT NOT NULL,
    day_of_week TEXT NOT NULL,
    role TEXT DEFAULT 'crew',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bunker_id) REFERENCES bunkers(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS power_management (
    id TEXT PRIMARY KEY,
    bunker_id TEXT NOT NULL,
    generator_fuel REAL DEFAULT 0,
    generator_capacity REAL DEFAULT 100,
    battery_level REAL DEFAULT 100,
    power_consumption REAL DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bunker_id) REFERENCES bunkers(id)
  );

  CREATE TABLE IF NOT EXISTS water_system (
    id TEXT PRIMARY KEY,
    bunker_id TEXT NOT NULL,
    storage_level REAL DEFAULT 100,
    storage_capacity REAL DEFAULT 1000,
    treatment_status TEXT DEFAULT 'operational',
    filtration_status TEXT DEFAULT 'operational',
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bunker_id) REFERENCES bunkers(id)
  );

  CREATE TABLE IF NOT EXISTS air_quality (
    id TEXT PRIMARY KEY,
    bunker_id TEXT NOT NULL,
    oxygen_level REAL DEFAULT 21,
    co2_level REAL DEFAULT 400,
    ventilation_status TEXT DEFAULT 'operational',
    scrubber_status TEXT DEFAULT 'operational',
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bunker_id) REFERENCES bunkers(id)
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS supply_history (
    id TEXT PRIMARY KEY,
    supply_id TEXT NOT NULL,
    bunker_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    change_type TEXT NOT NULL,
    changed_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supply_id) REFERENCES supplies(id),
    FOREIGN KEY (bunker_id) REFERENCES bunkers(id),
    FOREIGN KEY (changed_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS inventory_alerts (
    id TEXT PRIMARY KEY,
    supply_id TEXT NOT NULL,
    bunker_id TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    threshold_value REAL NOT NULL,
    current_value REAL NOT NULL,
    message TEXT,
    is_resolved INTEGER DEFAULT 0,
    resolved_by TEXT,
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supply_id) REFERENCES supplies(id),
    FOREIGN KEY (bunker_id) REFERENCES bunkers(id),
    FOREIGN KEY (resolved_by) REFERENCES users(id)
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
  const supply = db.prepare('SELECT * FROM supplies WHERE id = ?').get(req.params.id);
  
  db.prepare('UPDATE supplies SET name=COALESCE(?,name), category=COALESCE(?,category), quantity=COALESCE(?,quantity), unit=COALESCE(?,unit), min_quantity=COALESCE(?,min_quantity) WHERE id=?')
    .run(name, category, quantity, unit, min_quantity, req.params.id);
  
  // Log history if quantity changed
  if (quantity !== undefined && supply && quantity !== supply.quantity) {
    const changeType = quantity > supply.quantity ? 'increase' : 'decrease';
    db.prepare('INSERT INTO supply_history (id, supply_id, bunker_id, quantity, change_type, changed_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), req.params.id, supply.bunker_id, quantity, changeType, req.user.id);
    
    // Check for low stock alert
    if (quantity <= (min_quantity || supply.min_quantity || 0)) {
      const existingAlert = db.prepare('SELECT id FROM inventory_alerts WHERE supply_id = ? AND is_resolved = 0').get(req.params.id);
      if (!existingAlert) {
        db.prepare('INSERT INTO inventory_alerts (id, supply_id, bunker_id, alert_type, threshold_value, current_value, message) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(uuidv4(), req.params.id, supply.bunker_id, 'low_stock', min_quantity || supply.min_quantity || 0, quantity, `${supply.name || 'Supply'} is below minimum threshold`);
      }
    }
  }
  
  res.json({ success: true });
});

app.delete('/api/supplies/:id', auth, (req, res) => {
  db.prepare('DELETE FROM supplies WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── SUPPLY HISTORY ─────────────────────────────────────────────────────────────
app.get('/api/bunkers/:id/supply-history', auth, (req, res) => {
  const { days } = req.query;
  const limit = days ? parseInt(days) : 30;
  const history = db.prepare(`
    SELECT sh.*, s.name as supply_name, s.category, u.username as changed_by_name
    FROM supply_history sh
    JOIN supplies s ON sh.supply_id = s.id
    LEFT JOIN users u ON sh.changed_by = u.id
    WHERE sh.bunker_id = ?
    ORDER BY sh.created_at DESC
    LIMIT ?
  `).all(req.params.id, limit * 24); // Approximate hourly entries
  res.json(history);
});

app.get('/api/supplies/:id/history', auth, (req, res) => {
  const history = db.prepare(`
    SELECT sh.*, u.username as changed_by_name
    FROM supply_history sh
    LEFT JOIN users u ON sh.changed_by = u.id
    WHERE sh.supply_id = ?
    ORDER BY sh.created_at DESC
    LIMIT 100
  `).all(req.params.id);
  res.json(history);
});

// ─── INVENTORY ALERTS ───────────────────────────────────────────────────────────
app.get('/api/bunkers/:id/alerts', auth, (req, res) => {
  const alerts = db.prepare(`
    SELECT ia.*, s.name as supply_name, s.category, s.unit
    FROM inventory_alerts ia
    JOIN supplies s ON ia.supply_id = s.id
    WHERE ia.bunker_id = ?
    ORDER BY ia.created_at DESC
  `).all(req.params.id);
  res.json(alerts);
});

app.get('/api/alerts/unresolved', auth, (req, res) => {
  let alerts;
  if (req.user.role === 'admin') {
    alerts = db.prepare(`
      SELECT ia.*, s.name as supply_name, s.category, b.name as bunker_name
      FROM inventory_alerts ia
      JOIN supplies s ON ia.supply_id = s.id
      JOIN bunkers b ON ia.bunker_id = b.id
      WHERE ia.is_resolved = 0
      ORDER BY ia.created_at DESC
    `).all();
  } else {
    alerts = db.prepare(`
      SELECT ia.*, s.name as supply_name, s.category, b.name as bunker_name
      FROM inventory_alerts ia
      JOIN supplies s ON ia.supply_id = s.id
      JOIN bunkers b ON ia.bunker_id = b.id
      LEFT JOIN bunker_members bm ON bm.bunker_id = b.id
      WHERE ia.is_resolved = 0 AND (b.owner_id = ? OR bm.user_id = ?)
      ORDER BY ia.created_at DESC
    `).all(req.user.id, req.user.id);
  }
  res.json(alerts);
});

app.patch('/api/alerts/:id/resolve', auth, (req, res) => {
  const alert = db.prepare('SELECT * FROM inventory_alerts WHERE id = ?').get(req.params.id);
  if (!alert) return res.status(404).json({ error: 'Not found' });
  
  const bunker = db.prepare('SELECT * FROM bunkers WHERE id = ?').get(alert.bunker_id);
  if (bunker.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  db.prepare('UPDATE inventory_alerts SET is_resolved = 1, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(req.user.id, req.params.id);
  res.json({ success: true });
});

// ─── RSS FEEDS ────────────────────────────────────────────────────────────────
app.get('/api/rss-feeds', auth, (req, res) => {
  const feeds = db.prepare('SELECT * FROM rss_feeds WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(feeds);
});

app.post('/api/rss-feeds', auth, async (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'Name and URL required' });
  
  try {
    // Validate RSS feed
    await parser.parseURL(url);
    
    const id = uuidv4();
    db.prepare('INSERT INTO rss_feeds (id, user_id, name, url) VALUES (?, ?, ?, ?)').run(id, req.user.id, name, url);
    res.json({ id, name, url, user_id: req.user.id });
  } catch (e) {
    res.status(400).json({ error: 'Invalid RSS feed URL' });
  }
});

app.delete('/api/rss-feeds/:id', auth, (req, res) => {
  const feed = db.prepare('SELECT * FROM rss_feeds WHERE id = ?').get(req.params.id);
  if (!feed) return res.status(404).json({ error: 'Not found' });
  if (feed.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM rss_feeds WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/rss-feeds/:id/fetch', auth, async (req, res) => {
  const feed = db.prepare('SELECT * FROM rss_feeds WHERE id = ?').get(req.params.id);
  if (!feed) return res.status(404).json({ error: 'Not found' });
  if (feed.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  
  try {
    const parsed = await parser.parseURL(feed.url);
    res.json({ 
      title: parsed.title, 
      items: parsed.items.slice(0, 10).map(item => ({
        title: item.title,
        link: item.link,
        pubDate: item.pubDate,
        content: item.contentSnippet
      }))
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch RSS feed' });
  }
});

// ─── DUTY ROSTER ───────────────────────────────────────────────────────────────
app.get('/api/bunkers/:id/roster', auth, (req, res) => {
  const roster = db.prepare(`
    SELECT dr.*, u.username 
    FROM duty_roster dr 
    JOIN users u ON dr.user_id = u.id 
    WHERE dr.bunker_id = ? 
    ORDER BY dr.day_of_week, dr.shift_start
  `).all(req.params.id);
  res.json(roster);
});

app.post('/api/bunkers/:id/roster', auth, (req, res) => {
  const { user_id, shift_name, shift_start, shift_end, day_of_week, role } = req.body;
  if (!user_id || !shift_name || !shift_start || !shift_end || !day_of_week) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const bunker = db.prepare('SELECT * FROM bunkers WHERE id = ?').get(req.params.id);
  if (!bunker) return res.status(404).json({ error: 'Bunker not found' });
  if (bunker.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const id = uuidv4();
  db.prepare(`
    INSERT INTO duty_roster (id, bunker_id, user_id, shift_name, shift_start, shift_end, day_of_week, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.id, user_id, shift_name, shift_start, shift_end, day_of_week, role || 'crew');
  res.json({ id, bunker_id: req.params.id, user_id, shift_name, shift_start, shift_end, day_of_week, role });
});

app.patch('/api/roster/:id', auth, (req, res) => {
  const { shift_name, shift_start, shift_end, day_of_week, role } = req.body;
  const roster = db.prepare('SELECT * FROM duty_roster WHERE id = ?').get(req.params.id);
  if (!roster) return res.status(404).json({ error: 'Not found' });
  
  const bunker = db.prepare('SELECT * FROM bunkers WHERE id = ?').get(roster.bunker_id);
  if (bunker.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  db.prepare(`
    UPDATE duty_roster 
    SET shift_name=COALESCE(?,shift_name), shift_start=COALESCE(?,shift_start), 
        shift_end=COALESCE(?,shift_end), day_of_week=COALESCE(?,day_of_week), role=COALESCE(?,role)
    WHERE id=?
  `).run(shift_name, shift_start, shift_end, day_of_week, role, req.params.id);
  res.json({ success: true });
});

app.delete('/api/roster/:id', auth, (req, res) => {
  const roster = db.prepare('SELECT * FROM duty_roster WHERE id = ?').get(req.params.id);
  if (!roster) return res.status(404).json({ error: 'Not found' });
  
  const bunker = db.prepare('SELECT * FROM bunkers WHERE id = ?').get(roster.bunker_id);
  if (bunker.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  db.prepare('DELETE FROM duty_roster WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ─── POWER MANAGEMENT ──────────────────────────────────────────────────────────
app.get('/api/bunkers/:id/power', auth, (req, res) => {
  let power = db.prepare('SELECT * FROM power_management WHERE bunker_id = ?').get(req.params.id);
  if (!power) {
    const id = uuidv4();
    db.prepare('INSERT INTO power_management (id, bunker_id) VALUES (?, ?)').run(id, req.params.id);
    power = db.prepare('SELECT * FROM power_management WHERE id = ?').get(id);
  }
  res.json(power);
});

app.patch('/api/bunkers/:id/power', auth, (req, res) => {
  const { generator_fuel, generator_capacity, battery_level, power_consumption } = req.body;
  const bunker = db.prepare('SELECT * FROM bunkers WHERE id = ?').get(req.params.id);
  if (!bunker) return res.status(404).json({ error: 'Bunker not found' });
  if (bunker.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  let power = db.prepare('SELECT * FROM power_management WHERE bunker_id = ?').get(req.params.id);
  if (!power) {
    const id = uuidv4();
    db.prepare('INSERT INTO power_management (id, bunker_id) VALUES (?, ?)').run(id, req.params.id);
    power = db.prepare('SELECT * FROM power_management WHERE id = ?').get(id);
  }
  
  db.prepare(`
    UPDATE power_management 
    SET generator_fuel=COALESCE(?,generator_fuel), generator_capacity=COALESCE(?,generator_capacity),
        battery_level=COALESCE(?,battery_level), power_consumption=COALESCE(?,power_consumption),
        last_updated=CURRENT_TIMESTAMP
    WHERE bunker_id=?
  `).run(generator_fuel, generator_capacity, battery_level, power_consumption, req.params.id);
  res.json({ success: true });
});

// ─── WATER SYSTEM ──────────────────────────────────────────────────────────────
app.get('/api/bunkers/:id/water', auth, (req, res) => {
  let water = db.prepare('SELECT * FROM water_system WHERE bunker_id = ?').get(req.params.id);
  if (!water) {
    const id = uuidv4();
    db.prepare('INSERT INTO water_system (id, bunker_id) VALUES (?, ?)').run(id, req.params.id);
    water = db.prepare('SELECT * FROM water_system WHERE id = ?').get(id);
  }
  res.json(water);
});

app.patch('/api/bunkers/:id/water', auth, (req, res) => {
  const { storage_level, storage_capacity, treatment_status, filtration_status } = req.body;
  const bunker = db.prepare('SELECT * FROM bunkers WHERE id = ?').get(req.params.id);
  if (!bunker) return res.status(404).json({ error: 'Bunker not found' });
  if (bunker.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  let water = db.prepare('SELECT * FROM water_system WHERE bunker_id = ?').get(req.params.id);
  if (!water) {
    const id = uuidv4();
    db.prepare('INSERT INTO water_system (id, bunker_id) VALUES (?, ?)').run(id, req.params.id);
    water = db.prepare('SELECT * FROM water_system WHERE id = ?').get(id);
  }
  
  db.prepare(`
    UPDATE water_system 
    SET storage_level=COALESCE(?,storage_level), storage_capacity=COALESCE(?,storage_capacity),
        treatment_status=COALESCE(?,treatment_status), filtration_status=COALESCE(?,filtration_status),
        last_updated=CURRENT_TIMESTAMP
    WHERE bunker_id=?
  `).run(storage_level, storage_capacity, treatment_status, filtration_status, req.params.id);
  res.json({ success: true });
});

// ─── AIR QUALITY ───────────────────────────────────────────────────────────────
app.get('/api/bunkers/:id/air', auth, (req, res) => {
  let air = db.prepare('SELECT * FROM air_quality WHERE bunker_id = ?').get(req.params.id);
  if (!air) {
    const id = uuidv4();
    db.prepare('INSERT INTO air_quality (id, bunker_id) VALUES (?, ?)').run(id, req.params.id);
    air = db.prepare('SELECT * FROM air_quality WHERE id = ?').get(id);
  }
  res.json(air);
});

app.patch('/api/bunkers/:id/air', auth, (req, res) => {
  const { oxygen_level, co2_level, ventilation_status, scrubber_status } = req.body;
  const bunker = db.prepare('SELECT * FROM bunkers WHERE id = ?').get(req.params.id);
  if (!bunker) return res.status(404).json({ error: 'Bunker not found' });
  if (bunker.owner_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  let air = db.prepare('SELECT * FROM air_quality WHERE bunker_id = ?').get(req.params.id);
  if (!air) {
    const id = uuidv4();
    db.prepare('INSERT INTO air_quality (id, bunker_id) VALUES (?, ?)').run(id, req.params.id);
    air = db.prepare('SELECT * FROM air_quality WHERE id = ?').get(id);
  }
  
  db.prepare(`
    UPDATE air_quality 
    SET oxygen_level=COALESCE(?,oxygen_level), co2_level=COALESCE(?,co2_level),
        ventilation_status=COALESCE(?,ventilation_status), scrubber_status=COALESCE(?,scrubber_status),
        last_updated=CURRENT_TIMESTAMP
    WHERE bunker_id=?
  `).run(oxygen_level, co2_level, ventilation_status, scrubber_status, req.params.id);
  res.json({ success: true });
});

// ─── RESOURCE CALCULATOR ───────────────────────────────────────────────────────
app.get('/api/bunkers/:id/calculate', auth, (req, res) => {
  const { duration } = req.query;
  const bunker = db.prepare('SELECT * FROM bunkers WHERE id = ?').get(req.params.id);
  if (!bunker) return res.status(404).json({ error: 'Bunker not found' });
  
  const memberCount = db.prepare('SELECT COUNT(*) as c FROM bunker_members WHERE bunker_id = ?').get(req.params.id).c;
  const days = parseInt(duration) || 30;
  
  // Consumption rates per person per day
  const rates = {
    water: 3, // gallons
    food: 2000, // calories
    oxygen: 550, // liters
    power: 2 // kWh
  };
  
  const calculations = {
    duration_days: days,
    people_count: memberCount,
    total_water_needed: memberCount * days * rates.water,
    total_food_calories: memberCount * days * rates.food,
    total_oxygen_needed: memberCount * days * rates.oxygen,
    total_power_needed: memberCount * days * rates.power,
    water_per_person: days * rates.water,
    food_per_person: days * rates.food,
    oxygen_per_person: days * rates.oxygen,
    power_per_person: days * rates.power
  };
  
  res.json(calculations);
});

// ─── PUSH NOTIFICATIONS ─────────────────────────────────────────────────────────
app.post('/api/push/subscribe', auth, (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'Invalid subscription data' });
  }
  
  const id = uuidv4();
  db.prepare('INSERT INTO push_subscriptions (id, user_id, endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, endpoint, keys.p256dh, keys.auth);
  res.json({ success: true, id });
});

app.delete('/api/push/unsubscribe', auth, (req, res) => {
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').run(req.user.id);
  res.json({ success: true });
});

app.post('/api/push/send', auth, requireRole('admin', 'commander'), async (req, res) => {
  const { title, body, bunker_id } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
  
  try {
    const webpush = require('web-push');
    const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || 'BL_SAMPLE_PUBLIC_KEY';
    const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || 'BL_SAMPLE_PRIVATE_KEY';
    
    webpush.setVapidDetails(
      'mailto:admin@bunker-command.local',
      vapidPublicKey,
      vapidPrivateKey
    );
    
    let subscriptions;
    if (bunker_id) {
      const members = db.prepare('SELECT user_id FROM bunker_members WHERE bunker_id = ?').all(bunker_id);
      const userIds = members.map(m => m.user_id);
      subscriptions = db.prepare('SELECT * FROM push_subscriptions WHERE user_id IN (' + userIds.map(() => '?').join(',') + ')').all(...userIds);
    } else {
      subscriptions = db.prepare('SELECT * FROM push_subscriptions').all();
    }
    
    const results = [];
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys_p256dh,
            auth: sub.keys_auth
          }
        }, JSON.stringify({ title, body }));
        results.push({ success: true, user_id: sub.user_id });
      } catch (e) {
        results.push({ success: false, user_id: sub.user_id, error: e.message });
      }
    }
    
    res.json({ sent: results.length, results });
  } catch (e) {
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

// ─── HEALTH (public, for Docker healthcheck) ─────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ─── VERSION (public) ─────────────────────────────────────────────────────────
app.get("/api/version", (req, res) => res.json({ version: APP_VERSION }));

// ─── STATS ───────────────────────────────────────────────────────────────────
app.get('/api/stats', auth, (req, res) => {
  const totalBunkers = db.prepare('SELECT COUNT(*) as c FROM bunkers').get().c;
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const totalSupplies = db.prepare('SELECT SUM(quantity) as c FROM supplies').get().c || 0;
  const totalRooms = db.prepare('SELECT COUNT(*) as c FROM rooms').get().c;
  res.json({ totalBunkers, totalUsers, totalSupplies, totalRooms });
});

app.listen(PORT, () => console.log(`Bunker API running on :${PORT}`));
