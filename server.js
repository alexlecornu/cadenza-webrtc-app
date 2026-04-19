'use strict';
const express      = require('express');
const http         = require('http');
const { PeerServer } = require('peer');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const { randomUUID: uuid } = require('crypto');
const fs           = require('fs');
const path         = require('path');

// ── CONFIG ────────────────────────────────────────────
const PORT    = process.env.PORT || 3000;
const SECRET  = process.env.JWT_SECRET || 'nexlink-dev-secret-change-in-production';
const DB_PATH = path.join(__dirname, 'data', 'users.json');

// ── SIMPLE FILE DB ────────────────────────────────────
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { users: [] }; }
}
function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
function findUser(email) {
  return loadDB().users.find(u => u.email.toLowerCase() === email.toLowerCase());
}

// ── EXPRESS + PEER SERVER ─────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Mount PeerJS on /peerjs
const server = http.createServer(app);
const peerServer = PeerServer({ server, path: '/peerjs', allow_discovery: true });
peerServer.on('connection', client => console.log(`[peer] connected: ${client.getId()}`));
peerServer.on('disconnect', client => console.log(`[peer] disconnected: ${client.getId()}`));

// ── AUTH MIDDLEWARE ───────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

// ── AUTH ROUTES ───────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { email, password, displayName, username, color, status } = req.body;
  if (!email || !password || !displayName || !username) {
    return res.status(400).json({ error: 'All fields required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const db = loadDB();
  const emailTaken = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  const usernameTaken = db.users.find(u => u.username.toLowerCase() === username.toLowerCase());

  if (emailTaken) return res.status(400).json({ error: 'Email already registered' });
  if (usernameTaken) return res.status(400).json({ error: 'Username already taken' });

  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: uuid(),
    email: email.toLowerCase(),
    password: hash,
    displayName,
    username: username.toLowerCase(),
    color: color || '#4f7fff',
    status: status || 'Available',
    avatar: null,
    contacts: [],
    createdAt: Date.now()
  };

  db.users.push(user);
  saveDB(db);

  const token = jwt.sign({ id: user.id, email: user.email }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: sanitize(user) });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = findUser(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ id: user.id, email: user.email }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: sanitize(user) });
});

app.get('/api/me', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(sanitize(user));
});

app.patch('/api/me', requireAuth, async (req, res) => {
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });

  const allowed = ['displayName', 'color', 'status', 'username'];
  allowed.forEach(k => { if (req.body[k] !== undefined) db.users[idx][k] = req.body[k]; });

  // Password change
  if (req.body.newPassword) {
    if (!req.body.currentPassword) return res.status(400).json({ error: 'Current password required' });
    const ok = await bcrypt.compare(req.body.currentPassword, db.users[idx].password);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
    db.users[idx].password = await bcrypt.hash(req.body.newPassword, 10);
  }

  saveDB(db);
  res.json(sanitize(db.users[idx]));
});

// ── CONTACTS ─────────────────────────────────────────
app.get('/api/contacts', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const contacts = (user.contacts || []).map(c => {
    const found = db.users.find(u => u.username === c.username);
    return found ? { ...c, online: false, displayName: found.displayName, color: found.color, status: found.status } : c;
  });
  res.json(contacts);
});

app.post('/api/contacts', requireAuth, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const db = loadDB();
  const me = db.users.find(u => u.id === req.user.id);
  const target = db.users.find(u => u.username === username.toLowerCase());

  if (!target) return res.status(404).json({ error: 'No user found with that username' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't add yourself" });

  const already = (me.contacts || []).find(c => c.username === target.username);
  if (already) return res.status(400).json({ error: 'Already in contacts' });

  me.contacts = me.contacts || [];
  me.contacts.push({ username: target.username, displayName: target.displayName, color: target.color, addedAt: Date.now() });
  saveDB(db);
  res.json({ username: target.username, displayName: target.displayName, color: target.color });
});

app.delete('/api/contacts/:username', requireAuth, (req, res) => {
  const db = loadDB();
  const me = db.users.find(u => u.id === req.user.id);
  me.contacts = (me.contacts || []).filter(c => c.username !== req.params.username);
  saveDB(db);
  res.json({ ok: true });
});

// ── USER LOOKUP ───────────────────────────────────────
app.get('/api/user/:username', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.username === req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(sanitize(user));
});

// ── RECENT CALLS (stored per-user) ────────────────────
app.get('/api/recents', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  res.json(user?.recents || []);
});

app.post('/api/recents', requireAuth, (req, res) => {
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const entry = { ...req.body, ts: Date.now() };
  db.users[idx].recents = [entry, ...(db.users[idx].recents || [])].slice(0, 50);
  saveDB(db);
  res.json({ ok: true });
});

app.post('/api/recents/clear', requireAuth, (req, res) => {
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx !== -1) { db.users[idx].recents = []; saveDB(db); }
  res.json({ ok: true });
});

// ── DATA DIR ENSURE ───────────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function sanitize(u) {
  const { password, ...safe } = u;
  return safe;
}

// ── START ─────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════╗`);
  console.log(`  ║   NexLink running                ║`);
  console.log(`  ║   http://localhost:${PORT}           ║`);
  console.log(`  ╚══════════════════════════════════╝\n`);
});
