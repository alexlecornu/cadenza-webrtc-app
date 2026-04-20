'use strict';
const express  = require('express');
const http     = require('http');
const { WebSocketServer } = require('ws');
const { PeerServer } = require('peer');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { randomUUID: uuid } = require('crypto');
const fs       = require('fs');
const path     = require('path');

const PORT    = process.env.PORT || 3000;
const SECRET  = process.env.JWT_SECRET || 'cadenza-dev-secret-change-in-production';
const DB_PATH = path.join(__dirname, 'data', 'users.json');

// ── DATA DIR + FRESH DB ───────────────────────────────
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
saveDB({ users: [] }); // Reset on every deploy

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { users: [] }; }
}
function saveDB(db) { fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }
function findUser(email) { return loadDB().users.find(u => u.email.toLowerCase() === email.toLowerCase()); }
function sanitize(u) { const { password, ...safe } = u; return safe; }

// ── ROOM CODE GENERATOR (xxxx-xxxx numeric) ───────────
function generateRoomCode() {
  const seg = () => Math.floor(1000 + Math.random() * 9000).toString();
  return `${seg()}-${seg()}`;
}

// ── PASSWORD STRENGTH ─────────────────────────────────
function strongPassword(pw) {
  return pw.length >= 8 && /[A-Z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
}

// ── EXPRESS + HTTP ────────────────────────────────────
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);

// ── PEERJS (WebRTC signalling) ────────────────────────
const peerServer = PeerServer({ server, path: '/peerjs', allow_discovery: true });
peerServer.on('connection', c => console.log(`[peer] +${c.getId()}`));
peerServer.on('disconnect', c => console.log(`[peer] -${c.getId()}`));

// ── WEBSOCKET (DMs, notifications, call signalling) ───
const wss = new WebSocketServer({ server, path: '/ws' });
// username -> ws
const onlineUsers = new Map();
// roomCode -> Set of usernames
const rooms = new Map();

wss.on('connection', ws => {
  let username = null;

  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    // ── AUTH ──────────────────────────────────────────
    if (msg.type === 'auth') {
      try {
        const payload = jwt.verify(msg.token, SECRET);
        const db = loadDB();
        const user = db.users.find(u => u.id === payload.id);
        if (!user) { ws.close(); return; }
        username = user.username;
        onlineUsers.set(username, ws);
        ws.send(JSON.stringify({ type: 'authed', username }));
      } catch { ws.close(); }
      return;
    }

    if (!username) return;

    // ── DM ────────────────────────────────────────────
    if (msg.type === 'dm') {
      const { to, text, ts, id: msgId, mediaType, dataUrl, fileName, fileSize } = msg;
      if (!to) return;

      const db = loadDB();
      const meIdx = db.users.findIndex(u => u.username === username);
      const theirIdx = db.users.findIndex(u => u.username === to);
      if (meIdx === -1 || theirIdx === -1) return;

      const entry = {
        id: msgId || uuid(), from: username, to,
        text: text || null, ts: ts || Date.now(),
        mediaType: mediaType || null,
        dataUrl: dataUrl || null,
        fileName: fileName || null,
        fileSize: fileSize || null
      };

      // Persist
      db.users[meIdx].messages = db.users[meIdx].messages || [];
      db.users[theirIdx].messages = db.users[theirIdx].messages || [];
      db.users[meIdx].messages.push(entry);
      db.users[theirIdx].messages.push(entry);
      db.users[meIdx].messages = db.users[meIdx].messages.slice(-500);
      db.users[theirIdx].messages = db.users[theirIdx].messages.slice(-500);
      saveDB(db);

      // Deliver
      const recipientWs = onlineUsers.get(to);
      if (recipientWs && recipientWs.readyState === 1) {
        recipientWs.send(JSON.stringify({ type: 'dm', ...entry }));
      }
      // Echo back (single echo, no duplicate)
      ws.send(JSON.stringify({ type: 'dm-sent', ...entry }));
      return;
    }

    // ── CALL ROOM SIGNALLING (WebSocket-based, replaces PeerJS room trick) ──
    if (msg.type === 'call-join') {
      const { roomCode, peerId, displayName, color, avatar, availability } = msg;
      if (!roomCode || !peerId) return;

      if (!rooms.has(roomCode)) rooms.set(roomCode, new Map());
      const room = rooms.get(roomCode);

      // Tell the new joiner about everyone already in the room
      const existingPeers = [];
      for (const [u, info] of room) {
        if (u !== username) existingPeers.push(info);
      }
      ws.send(JSON.stringify({ type: 'call-peers', roomCode, peers: existingPeers }));

      // Tell everyone in the room about the new joiner
      const newPeerInfo = { username, peerId, displayName, color, avatar, availability };
      for (const [u, info] of room) {
        const peerWs = onlineUsers.get(u);
        if (peerWs && peerWs.readyState === 1) {
          peerWs.send(JSON.stringify({ type: 'call-peer-joined', roomCode, peer: newPeerInfo }));
        }
      }

      room.set(username, newPeerInfo);
      return;
    }

    if (msg.type === 'call-leave') {
      const { roomCode } = msg;
      if (!roomCode || !rooms.has(roomCode)) return;
      const room = rooms.get(roomCode);
      room.delete(username);
      for (const [u] of room) {
        const peerWs = onlineUsers.get(u);
        if (peerWs && peerWs.readyState === 1) {
          peerWs.send(JSON.stringify({ type: 'call-peer-left', roomCode, username }));
        }
      }
      if (room.size === 0) rooms.delete(roomCode);
      return;
    }

    // ── STATUS UPDATE ─────────────────────────────────
    if (msg.type === 'status-update') {
      const { availability } = msg;
      const db = loadDB();
      const idx = db.users.findIndex(u => u.username === username);
      if (idx !== -1) { db.users[idx].availability = availability; saveDB(db); }
      // Broadcast to all contacts
      const user = db.users[idx];
      (user?.contacts || []).forEach(c => {
        const cWs = onlineUsers.get(c.username);
        if (cWs && cWs.readyState === 1) {
          cWs.send(JSON.stringify({ type: 'contact-status', username, availability }));
        }
      });
      return;
    }
  });

  ws.on('close', () => {
    if (username) {
      onlineUsers.delete(username);
      // Remove from all rooms
      for (const [roomCode, room] of rooms) {
        if (room.has(username)) {
          room.delete(username);
          for (const [u] of room) {
            const peerWs = onlineUsers.get(u);
            if (peerWs && peerWs.readyState === 1) {
              peerWs.send(JSON.stringify({ type: 'call-peer-left', roomCode, username }));
            }
          }
          if (room.size === 0) rooms.delete(roomCode);
        }
      }
    }
  });
  ws.on('error', () => {});
});

// ── AUTH MIDDLEWARE ───────────────────────────────────
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { res.status(401).json({ error: 'Unauthorized' }); }
}

// ── REGISTER ──────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { email, password, displayName, username, color, role } = req.body;
  if (!email || !password || !displayName || !username)
    return res.status(400).json({ error: 'All fields required' });
  if (!strongPassword(password))
    return res.status(400).json({ error: 'Password must be at least 8 characters and include an uppercase letter, a number, and a special character' });

  const db = loadDB();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase()))
    return res.status(400).json({ error: 'Email already registered' });
  if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(400).json({ error: 'Username already taken — please choose another' });

  const roomCode = generateRoomCode();
  const user = {
    id: uuid(), email: email.toLowerCase(),
    password: await bcrypt.hash(password, 10),
    displayName, username: username.toLowerCase(),
    color: color || '#6366f1', role: role || 'student',
    availability: 'available', avatar: null,
    roomCode,
    contacts: [], contactRequests: [], sentRequests: [], messages: [],
    recents: [], createdAt: Date.now()
  };
  db.users.push(user); saveDB(db);
  const token = jwt.sign({ id: user.id, email: user.email }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: sanitize(user) });
});

// ── LOGIN ─────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = findUser(email);
  if (!user || !(await bcrypt.compare(password, user.password)))
    return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ id: user.id, email: user.email }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: sanitize(user) });
});

// ── ME ────────────────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
  const user = loadDB().users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(sanitize(user));
});

app.patch('/api/me', requireAuth, async (req, res) => {
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  if (req.body.username) {
    const taken = db.users.find(u => u.username === req.body.username.toLowerCase() && u.id !== req.user.id);
    if (taken) return res.status(400).json({ error: 'Username already taken' });
  }

  ['displayName','color','availability','username','avatar','role'].forEach(k => {
    if (req.body[k] !== undefined) db.users[idx][k] = req.body[k];
  });

  if (req.body.newPassword) {
    if (!req.body.currentPassword) return res.status(400).json({ error: 'Current password required' });
    if (!(await bcrypt.compare(req.body.currentPassword, db.users[idx].password)))
      return res.status(400).json({ error: 'Current password is incorrect' });
    if (!strongPassword(req.body.newPassword))
      return res.status(400).json({ error: 'New password must be strong (8+ chars, uppercase, number, special char)' });
    db.users[idx].password = await bcrypt.hash(req.body.newPassword, 10);
  }
  saveDB(db);
  res.json(sanitize(db.users[idx]));
});

// ── USER LOOKUP ───────────────────────────────────────
app.get('/api/user/:username', requireAuth, (req, res) => {
  const user = loadDB().users.find(u => u.username === req.params.username.toLowerCase());
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ username: user.username, displayName: user.displayName, color: user.color, avatar: user.avatar, availability: user.availability, role: user.role, roomCode: user.roomCode });
});

// ── CONTACT REQUESTS ──────────────────────────────────
app.get('/api/contact-requests', requireAuth, (req, res) => {
  const user = loadDB().users.find(u => u.id === req.user.id);
  const received = user?.contactRequests || [];
  const sent = user?.sentRequests || [];
  res.json({ received, sent });
});

app.post('/api/contact-requests', requireAuth, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const db = loadDB();
  const me = db.users.find(u => u.id === req.user.id);
  const target = db.users.find(u => u.username === username.toLowerCase());

  if (!target) return res.status(404).json({ error: 'No user found with that username' });
  if (target.id === req.user.id) return res.status(400).json({ error: "You can't add yourself" });
  if ((me.contacts || []).find(c => c.username === target.username))
    return res.status(400).json({ error: 'Already in your contacts' });

  target.contactRequests = target.contactRequests || [];
  me.sentRequests = me.sentRequests || [];

  if (target.contactRequests.find(r => r.from === me.username))
    return res.status(400).json({ error: 'Request already sent' });

  const requestId = uuid();
  const reqEntry = { id: requestId, from: me.username, displayName: me.displayName, avatar: me.avatar, color: me.color, ts: Date.now() };
  target.contactRequests.push(reqEntry);
  me.sentRequests.push({ id: requestId, to: target.username, displayName: target.displayName, avatar: target.avatar, color: target.color, ts: Date.now(), status: 'pending' });
  saveDB(db);

  // Notify recipient via WS
  const recipientWs = onlineUsers.get(target.username);
  if (recipientWs && recipientWs.readyState === 1) {
    recipientWs.send(JSON.stringify({ type: 'contact-request', ...reqEntry }));
  }

  res.json({ ok: true, id: requestId });
});

app.post('/api/contact-requests/:id/accept', requireAuth, (req, res) => {
  const db = loadDB();
  const meIdx = db.users.findIndex(u => u.id === req.user.id);
  if (meIdx === -1) return res.status(404).json({ error: 'Not found' });

  const reqEntry = (db.users[meIdx].contactRequests || []).find(r => r.id === req.params.id);
  if (!reqEntry) return res.status(404).json({ error: 'Request not found' });

  const senderIdx = db.users.findIndex(u => u.username === reqEntry.from);
  if (senderIdx === -1) return res.status(404).json({ error: 'Sender not found' });

  const me = db.users[meIdx], sender = db.users[senderIdx];
  me.contacts = me.contacts || [];
  sender.contacts = sender.contacts || [];

  if (!me.contacts.find(c => c.username === sender.username))
    me.contacts.push({ username: sender.username, displayName: sender.displayName, color: sender.color, avatar: sender.avatar, addedAt: Date.now() });
  if (!sender.contacts.find(c => c.username === me.username))
    sender.contacts.push({ username: me.username, displayName: me.displayName, color: me.color, avatar: me.avatar, addedAt: Date.now() });

  db.users[meIdx].contactRequests = db.users[meIdx].contactRequests.filter(r => r.id !== req.params.id);

  // Update sender's sentRequests status
  sender.sentRequests = (sender.sentRequests || []).map(r => r.id === req.params.id ? { ...r, status: 'accepted' } : r);
  saveDB(db);

  // Notify sender
  const senderWs = onlineUsers.get(sender.username);
  if (senderWs && senderWs.readyState === 1) {
    senderWs.send(JSON.stringify({ type: 'contact-accepted', username: me.username, displayName: me.displayName, color: me.color, avatar: me.avatar }));
  }

  res.json({ ok: true });
});

app.post('/api/contact-requests/:id/decline', requireAuth, (req, res) => {
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.users[idx].contactRequests = (db.users[idx].contactRequests || []).filter(r => r.id !== req.params.id);
  saveDB(db);
  res.json({ ok: true });
});

// ── CONTACTS ─────────────────────────────────────────
app.get('/api/contacts', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const contacts = (user.contacts || []).map(c => {
    const found = db.users.find(u => u.username === c.username);
    return found ? { ...c, displayName: found.displayName, color: found.color, availability: found.availability, avatar: found.avatar, role: found.role, roomCode: found.roomCode } : c;
  });
  res.json(contacts);
});

app.delete('/api/contacts/:username', requireAuth, (req, res) => {
  const db = loadDB();
  const me = db.users.find(u => u.id === req.user.id);
  me.contacts = (me.contacts || []).filter(c => c.username !== req.params.username);
  saveDB(db); res.json({ ok: true });
});

// ── MESSAGES ─────────────────────────────────────────
app.get('/api/messages/:username', requireAuth, (req, res) => {
  const db = loadDB();
  const me = db.users.find(u => u.id === req.user.id);
  if (!me) return res.status(404).json({ error: 'Not found' });
  const other = req.params.username;
  const msgs = (me.messages || []).filter(m =>
    (m.from === me.username && m.to === other) ||
    (m.from === other && m.to === me.username)
  );
  res.json(msgs.slice(-100));
});

// ── RECENTS ───────────────────────────────────────────
app.get('/api/recents', requireAuth, (req, res) => {
  const user = loadDB().users.find(u => u.id === req.user.id);
  res.json(user?.recents || []);
});
app.post('/api/recents', requireAuth, (req, res) => {
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.users[idx].recents = [{ ...req.body, ts: Date.now() }, ...(db.users[idx].recents || [])].slice(0, 50);
  saveDB(db); res.json({ ok: true });
});
app.post('/api/recents/clear', requireAuth, (req, res) => {
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx !== -1) { db.users[idx].recents = []; saveDB(db); }
  res.json({ ok: true });
});

// ── START ─────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Cadenza running on port ${PORT}`);
});
