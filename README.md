# NexLink

Professional WebRTC video calling — accounts, contacts, call history, screen sharing, remote control.

---

## Option A — Run locally (double-click)

### Mac
1. Download and unzip the NexLink folder
2. Double-click **`start.command`**
3. If macOS blocks it: right-click → Open → Open anyway
4. First run installs everything automatically (~30 seconds)
5. Browser opens at **http://localhost:3000**

> **Sharing with others on the same Wi-Fi:** find your local IP address (System Settings → Wi-Fi → Details) and share `http://192.168.x.x:3000`
>
> **Sharing across the internet:** install [ngrok](https://ngrok.com/download) (free), run `ngrok http 3000`, share the `https://xxx.ngrok.io` URL — works from anywhere in the world

### Windows
1. Download and unzip the NexLink folder
2. Double-click **`start.bat`**
3. If Node.js isn't installed, it will open nodejs.org for you — install it, then double-click again
4. Browser opens at **http://localhost:3000**

### Requirements
- Node.js 18+ (the launchers install this for you on Mac)
- A modern browser (Chrome, Edge, Safari, Firefox)
- A camera and microphone

---

## Option B — Deploy free to the cloud (permanent URL)

This gives you a permanent `https://` URL that works from any device, anywhere, forever — no local setup needed.

---

### Render.com (recommended — easiest)

1. Create a free account at **render.com**
2. Push NexLink to a GitHub repo (see below)
3. On Render: **New → Web Service → Connect your repo**
4. Render auto-detects the `render.yaml` — click **Deploy**
5. You get a URL like `https://nexlink-xxxx.onrender.com`

> Free tier note: Render's free plan spins down after 15 minutes of inactivity. First visit after idle takes ~30 seconds to wake up. The $7/month plan stays always-on.

---

### Railway.app (fastest deploy)

1. Create a free account at **railway.app**
2. **New Project → Deploy from GitHub → select your repo**
3. Railway auto-detects Node.js and deploys — takes about 60 seconds
4. Go to Settings → Domains → Generate Domain
5. Done — permanent `https://` URL

> Free tier: $5 credit/month, which covers light personal use. Add a card to get more.

---

### Pushing to GitHub (needed for cloud deploys)

If you haven't used GitHub before:

```bash
# Install git if needed: https://git-scm.com
cd path/to/nexlink

git init
git add .
git commit -m "Initial NexLink setup"
```

Then go to **github.com → New repository**, copy the commands it gives you to push.

---

## Stopping the server

- **Mac/Windows local:** press `Ctrl+C` in the terminal window, or just close it
- **Cloud:** log into Render/Railway and suspend or delete the service

---

## Environment variables

These are set automatically on Render (via `render.yaml`). For local use the defaults are fine.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `JWT_SECRET` | dev value | **Change this in production** — Render auto-generates a secure one |
| `NODE_ENV` | `development` | Set to `production` on cloud |

---

## Data & privacy

- All user accounts, contacts, and call history are stored in `data/users.json`
- Passwords are bcrypt hashed — never stored in plain text
- Video and audio travel **directly peer-to-peer** between browsers — it does not pass through your server
- The server only handles signaling (connecting peers) and account data

---

## Features

| Feature | Status |
|---|---|
| Email + password accounts | ✓ |
| Persistent sessions (30 days) | ✓ |
| Contact list with username search | ✓ |
| Call history per user | ✓ |
| Multi-party video & audio | ✓ |
| Mute / camera toggle | ✓ |
| Screen sharing (with audio) | ✓ |
| Camera switching | ✓ |
| In-call text chat | ✓ |
| Remote mouse/keyboard control | ✓ |
| TURN relay (works across NAT) | ✓ |
| Self-hosted PeerJS signaling | ✓ |
| Works on mobile browsers | ✓ |

---

## Troubleshooting

**Call connects but no video/audio**
→ Check browser has camera/microphone permission (click the lock icon in the address bar)

**Can't connect to someone on a different network**
→ Make sure you're using the `https://` URL (required for cameras). Use ngrok or a cloud deploy — `http://` on local IP only works on the same Wi-Fi.

**"Port already in use" on Mac**
→ The launcher picks a different port automatically. Check the terminal for the actual URL.

**Render/Railway app crashes on deploy**
→ Make sure `JWT_SECRET` env var is set in the platform's environment settings
