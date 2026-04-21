/**
 * Terminal Service — PTY-backed shell sessions for Soul OS + Brave Extension.
 *
 * - REST: /api/terminal/sessions (GET list, POST create, DELETE :id)
 * - WebSocket Upgrade at /ws/terminal/:sessionId
 *   Client → Server messages (JSON):
 *     { type: 'input', data: '...' }
 *     { type: 'resize', cols, rows }
 *   Server → Client messages (JSON):
 *     { type: 'output', data: '...' }
 *     { type: 'exit', code, signal }
 *     { type: 'error', message }
 *
 * Auth: Bearer <API_KEY> either via Authorization header (REST)
 *       or ?key=<API_KEY> query param on the WebSocket URL.
 *
 * Allowed origins: localhost, chrome-extension://, moz-extension://.
 */

import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { WebSocketServer } from 'ws';

let pty = null;
try {
  pty = await import('node-pty');
} catch (err) {
  console.warn('[terminal] node-pty konnte nicht geladen werden:', err?.message);
}

const MAX_SESSIONS = 16;
const DEFAULT_COLS = 100;
const DEFAULT_ROWS = 30;
const DEFAULT_SHELL =
  process.env.SOUL_TERMINAL_SHELL ||
  process.env.SHELL ||
  (os.platform() === 'win32' ? 'powershell.exe' : '/bin/zsh');
const DEFAULT_CWD =
  process.env.SOUL_TERMINAL_CWD || process.env.SOUL_PATH || os.homedir();
// Ring-Puffer pro Session fuer Reattach / Scrollback
const SCROLLBACK_BYTES = 128 * 1024;

class TerminalSession {
  constructor({ id, name, shell, cwd, cols, rows }) {
    this.id = id;
    this.name = name || shell;
    this.shell = shell;
    this.cwd = cwd;
    this.cols = cols;
    this.rows = rows;
    this.createdAt = Date.now();
    this.alive = true;
    this.exitCode = null;
    this.exitSignal = null;
    this.scrollback = '';
    this.sockets = new Set();

    this.proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        SOUL_TERMINAL: '1',
        SOUL_TERMINAL_SESSION: id,
      },
    });

    this.proc.onData((data) => {
      this._appendScrollback(data);
      const msg = JSON.stringify({ type: 'output', data });
      for (const ws of this.sockets) {
        if (ws.readyState === 1) ws.send(msg);
      }
    });

    this.proc.onExit(({ exitCode, signal }) => {
      this.alive = false;
      this.exitCode = exitCode;
      this.exitSignal = signal ?? null;
      const msg = JSON.stringify({ type: 'exit', code: exitCode, signal: signal ?? null });
      for (const ws of this.sockets) {
        if (ws.readyState === 1) ws.send(msg);
        try { ws.close(1000, 'session exited'); } catch {}
      }
      this.sockets.clear();
    });
  }

  _appendScrollback(data) {
    this.scrollback += data;
    if (this.scrollback.length > SCROLLBACK_BYTES) {
      this.scrollback = this.scrollback.slice(-SCROLLBACK_BYTES);
    }
  }

  write(data) {
    if (!this.alive) return;
    try { this.proc.write(data); } catch (err) {
      console.warn('[terminal] write error:', err?.message);
    }
  }

  resize(cols, rows) {
    if (!this.alive) return;
    this.cols = cols;
    this.rows = rows;
    try { this.proc.resize(cols, rows); } catch (err) {
      console.warn('[terminal] resize error:', err?.message);
    }
  }

  kill() {
    if (!this.alive) return;
    try { this.proc.kill(); } catch {}
  }

  attach(ws, { replayScrollback = true } = {}) {
    this.sockets.add(ws);
    if (replayScrollback && this.scrollback) {
      try { ws.send(JSON.stringify({ type: 'output', data: this.scrollback })); } catch {}
    }
    if (!this.alive) {
      try {
        ws.send(JSON.stringify({ type: 'exit', code: this.exitCode, signal: this.exitSignal }));
      } catch {}
    }
  }

  detach(ws) {
    this.sockets.delete(ws);
  }

  meta() {
    return {
      id: this.id,
      name: this.name,
      shell: this.shell,
      cwd: this.cwd,
      cols: this.cols,
      rows: this.rows,
      createdAt: this.createdAt,
      alive: this.alive,
      exitCode: this.exitCode,
      connections: this.sockets.size,
    };
  }
}

export class TerminalService {
  constructor({ app, server, apiKey }) {
    this.app = app;
    this.server = server;
    this.apiKey = apiKey;
    this.sessions = new Map();
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on('connection', (ws, req, session) => this._handleConnection(ws, req, session));
  }

  setup() {
    this._setupRest();
    this._setupUpgrade();
  }

  _ok(origin) {
    if (!origin) return true; // curl, same-origin from loopback
    if (origin.startsWith('chrome-extension://')) return true;
    if (origin.startsWith('moz-extension://')) return true;
    if (origin.startsWith('http://localhost')) return true;
    if (origin.startsWith('http://127.0.0.1')) return true;
    if (origin.startsWith('https://localhost')) return true;
    return false;
  }

  _setupRest() {
    this.app.get('/api/terminal/sessions', (_req, res) => {
      if (!pty) return res.status(503).json({ error: 'node-pty not available' });
      res.json({ sessions: [...this.sessions.values()].map((s) => s.meta()) });
    });

    this.app.post('/api/terminal/sessions', (req, res) => {
      if (!pty) return res.status(503).json({ error: 'node-pty not available' });
      if (this.sessions.size >= MAX_SESSIONS) {
        return res.status(429).json({ error: `max ${MAX_SESSIONS} sessions` });
      }
      const {
        name,
        shell = DEFAULT_SHELL,
        cwd = DEFAULT_CWD,
        cols = DEFAULT_COLS,
        rows = DEFAULT_ROWS,
      } = req.body || {};
      const id = randomUUID();
      try {
        const session = new TerminalSession({ id, name, shell, cwd, cols, rows });
        this.sessions.set(id, session);
        res.json(session.meta());
      } catch (err) {
        console.error('[terminal] spawn error:', err);
        res.status(500).json({ error: err?.message || 'spawn failed' });
      }
    });

    this.app.delete('/api/terminal/sessions/:id', (req, res) => {
      const session = this.sessions.get(req.params.id);
      if (!session) return res.status(404).json({ error: 'not found' });
      session.kill();
      this.sessions.delete(req.params.id);
      res.json({ ok: true });
    });
  }

  _setupUpgrade() {
    this.server.on('upgrade', (req, socket, head) => {
      // Layout: /ws/terminal/:sessionId
      const url = req.url || '';
      if (!url.startsWith('/ws/terminal/')) return;
      // sonst nichts tun — die bestehende /ws Upgrade wird vom anderen WSS gemacht
      const origin = req.headers.origin;
      if (!this._ok(origin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return;
      }

      const parsed = new URL(req.url, 'http://localhost');
      const sessionId = parsed.pathname.replace('/ws/terminal/', '');
      const key = parsed.searchParams.get('key') ||
        (req.headers.authorization || '').replace('Bearer ', '');
      const reattach = parsed.searchParams.get('reattach') === '1';

      if (!this.apiKey || key !== this.apiKey) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); socket.destroy(); return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        ws._reattach = reattach;
        this.wss.emit('connection', ws, req, session);
      });
    });
  }

  _handleConnection(ws, _req, session) {
    session.attach(ws, { replayScrollback: !ws._reattach });

    // WS-level Keepalive: deckt halb-offene Verbindungen auf (Proxy-/NAT-Idle-Timeouts).
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const keepalive = setInterval(() => {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch {}
        return;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }, 25000);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'input' && typeof msg.data === 'string') {
        session.write(msg.data);
      } else if (msg.type === 'resize' && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
        session.resize(msg.cols | 0, msg.rows | 0);
      } else if (msg.type === 'ping') {
        // App-level Ping aus dem Browser (WS-Frame-Pings sind dort nicht zugaenglich).
        try { ws.send(JSON.stringify({ type: 'pong' })); } catch {}
      }
    });
    ws.on('close', () => { clearInterval(keepalive); session.detach(ws); });
    ws.on('error', () => { clearInterval(keepalive); session.detach(ws); });
  }
}

export function attachTerminalService(api) {
  const apiKey = process.env.API_KEY;
  const svc = new TerminalService({
    app: api.app,
    server: api.server,
    apiKey,
  });
  svc.setup();
  api.terminalService = svc;
  if (pty) {
    console.log('  [terminal] service ready (node-pty)');
  } else {
    console.log('  [terminal] service registered without node-pty (503 on endpoints)');
  }
  return svc;
}
