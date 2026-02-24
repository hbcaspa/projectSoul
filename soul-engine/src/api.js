/**
 * Soul API — REST + WebSocket server for the Soul App.
 *
 * REST endpoints provide soul data (status, card, memories, heartbeat).
 * WebSocket provides real-time chat and pulse streaming.
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, readFileSync, watchFile, unwatchFile } from 'node:fs';
import path from 'node:path';
import { parseSeed, extractSoulInfo } from './seed-parser.js';

export class SoulAPI {
  constructor(engine, apiChannel, port = 3001) {
    this.engine = engine;
    this.apiChannel = apiChannel;
    this.port = port;
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' });
    this.clients = new Set();
    this.pulsePath = path.resolve(engine.soulPath, '.soul-pulse');
    this.bus = engine.bus;
  }

  setup() {
    this.app.use(express.json());

    // Auth middleware for /api routes
    this.app.use('/api', (req, res, next) => {
      const key = (req.headers.authorization || '').replace('Bearer ', '');
      if (key !== process.env.API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      next();
    });

    // CORS for local development
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });

    this.setupWebhook();
    this.setupRoutes();
    this.setupWebSocket();
    this.watchPulse();
    this.setupBusBroadcast();
  }

  // ── WhatsApp Webhook (no auth — internal only) ───

  setupWebhook() {
    // Auto-reply set: JIDs that get automatic responses
    this.autoReplyJIDs = new Set();

    // Webhook from whatsapp-bridge — receives incoming messages
    this.app.post('/webhook/whatsapp', async (req, res) => {
      const { chat_jid, sender, content, timestamp } = req.body;
      if (!content || !chat_jid) return res.status(400).json({ error: 'missing fields' });

      console.log(`  [webhook] WhatsApp from ${sender}: ${content.substring(0, 80)}`);

      // Only auto-reply if JID is in the set
      if (!this.autoReplyJIDs.has(chat_jid)) {
        return res.json({ handled: false, reason: 'auto-reply not enabled for this chat' });
      }

      // Process through LLM and respond
      try {
        const response = await this.engine.handleWhatsAppMessage({ text: content, chatJid: chat_jid, sender });
        res.json({ handled: true, response: response.substring(0, 200) });
      } catch (err) {
        console.error(`  [webhook] Auto-reply failed: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    // Enable/disable auto-reply (auth required — goes through /api middleware)
    this.app.post('/api/autoreply/enable', (req, res) => {
      const { jid } = req.body;
      if (!jid) return res.status(400).json({ error: 'jid required' });
      this.autoReplyJIDs.add(jid);
      console.log(`  [autoreply] Enabled for ${jid}`);
      res.json({ enabled: true, jid });
    });

    this.app.post('/api/autoreply/disable', (req, res) => {
      const { jid } = req.body;
      if (!jid) return res.status(400).json({ error: 'jid required' });
      this.autoReplyJIDs.delete(jid);
      console.log(`  [autoreply] Disabled for ${jid}`);
      res.json({ enabled: false, jid });
    });
  }

  // ── REST Routes ────────────────────────────────────

  setupRoutes() {
    const { app } = this;
    const soulPath = this.engine.soulPath;

    // Status
    app.get('/api/status', async (req, res) => {
      try {
        await this.engine.context.load();
        const name = this.engine.context.extractName();
        const seed = this.engine.context.seed;
        const parsed = parseSeed(seed);
        const info = extractSoulInfo(parsed);

        let pulse = null;
        if (existsSync(this.pulsePath)) {
          const raw = readFileSync(this.pulsePath, 'utf-8').trim();
          const colonIdx = raw.indexOf(':');
          if (colonIdx > 0) {
            pulse = { type: raw.substring(0, colonIdx), label: raw.substring(colonIdx + 1) };
          }
        }

        res.json({
          name,
          mood: info.mood,
          born: info.born,
          sessions: info.sessions,
          ageDays: info.ageDays,
          language: this.engine.context.language,
          model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
          lastHeartbeat: parsed.condensed,
          connections: info.activeConnections,
          isWorking: this.engine.running,
          pulse,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Parsed seed
    app.get('/api/seed', async (req, res) => {
      try {
        await this.engine.context.load();
        res.json(parseSeed(this.engine.context.seed));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Raw seed
    app.get('/api/seed/raw', async (req, res) => {
      try {
        await this.engine.context.load();
        res.type('text/plain').send(this.engine.context.seed);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Soul card
    app.get('/api/card', async (req, res) => {
      try {
        await this.engine.context.load();
        const parsed = parseSeed(this.engine.context.seed);
        res.json(extractSoulInfo(parsed));
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Daily memory dates
    app.get('/api/memories/daily', async (req, res) => {
      try {
        const dir = path.resolve(soulPath, 'memory');
        if (!existsSync(dir)) return res.json({ dates: [] });
        const files = await readdir(dir);
        const dates = files
          .filter(f => f.endsWith('.md'))
          .map(f => f.replace('.md', ''))
          .sort()
          .reverse();
        res.json({ dates });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Daily memory content
    app.get('/api/memories/daily/:date', async (req, res) => {
      try {
        const filePath = path.resolve(soulPath, 'memory', `${req.params.date}.md`);
        if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
        const content = await readFile(filePath, 'utf-8');
        res.json({ date: req.params.date, content });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Heartbeat dates
    app.get('/api/memories/heartbeat', async (req, res) => {
      try {
        const dir = path.resolve(soulPath, 'heartbeat');
        if (!existsSync(dir)) return res.json({ dates: [] });
        const files = await readdir(dir);
        const dates = files
          .filter(f => f.endsWith('.md') && f !== '.gitkeep')
          .map(f => f.replace('.md', ''))
          .sort()
          .reverse();
        res.json({ dates });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Heartbeat content
    app.get('/api/memories/heartbeat/:date', async (req, res) => {
      try {
        const filePath = path.resolve(soulPath, 'heartbeat', `${req.params.date}.md`);
        if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
        const content = await readFile(filePath, 'utf-8');
        res.json({ date: req.params.date, content });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Soul detail file
    app.get('/api/soul/:filename', async (req, res) => {
      try {
        const soulDir = this.engine.context.language === 'de' ? 'seele' : 'soul';
        const filePath = path.resolve(soulPath, soulDir, req.params.filename);

        if (!filePath.startsWith(path.resolve(soulPath, soulDir))) {
          return res.status(400).json({ error: 'Invalid path' });
        }

        if (!existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
        const content = await readFile(filePath, 'utf-8');
        res.json({ filename: req.params.filename, content });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Event log (from bus)
    // Cost tracking
    app.get('/api/costs', (req, res) => {
      try {
        const days = parseInt(req.query.days) || 7;
        if (!this.engine.costs) {
          return res.json({ today: { categories: {}, total: { input: 0, output: 0, calls: 0 } }, summary: { days: {}, total: { input: 0, output: 0, calls: 0 } } });
        }
        res.json({
          today: this.engine.costs.getToday(),
          summary: this.engine.costs.getSummary(days),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Health dashboard
    app.get('/api/health', async (req, res) => {
      try {
        const { checkHealth } = await import('./health.js');
        const result = await checkHealth(soulPath, {
          language: this.engine.context.language,
          costs: this.engine.costs,
        });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Maturity indicator
    app.get('/api/maturity', async (req, res) => {
      try {
        const { computeMaturity } = await import('./maturity.js');
        const result = await computeMaturity(soulPath, { language: this.engine.context.language });
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // System Monitor — comprehensive session + engine status
    app.get('/api/monitor', async (req, res) => {
      try {
        const { SessionTracker } = await import('./session-tracker.js');
        const tracker = new SessionTracker(soulPath, this.engine);
        const result = await tracker.getMonitorData();
        res.json(result);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/events', (req, res) => {
      try {
        const since = parseInt(req.query.since) || 0;
        const events = this.bus
          ? this.bus.getRecentEvents(50).filter(e => e.id > since)
          : [];
        res.json({ events });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Open URL in Soul OS embedded browser (broadcast to all WS clients)
    // Uses "response" type with [BROWSER:url] tag so existing WhisperView can parse it
    app.post('/api/browser', (req, res) => {
      const { url } = req.body;
      if (!url) return res.status(400).json({ error: 'url required' });

      const msg = JSON.stringify({
        type: 'response',
        text: `[BROWSER:${url}]`,
        timestamp: new Date().toISOString(),
      });
      let sent = 0;
      for (const client of this.clients) {
        if (client.readyState === 1) {
          client.send(msg);
          sent++;
        }
      }
      res.json({ ok: true, url, clientsNotified: sent });
    });

    // Chat (HTTP fallback)
    app.post('/api/chat', async (req, res) => {
      try {
        const { text, sessionId = 'default' } = req.body;
        if (!text) return res.status(400).json({ error: 'text required' });

        const response = await this.handleChat(text, sessionId);
        res.json({ response, timestamp: new Date().toISOString() });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Chat history
    app.get('/api/chat/history', async (req, res) => {
      try {
        const history = await this.apiChannel.getFullHistory();
        res.json(history);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });
  }

  // ── WebSocket ──────────────────────────────────────

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      let authenticated = false;

      ws.on('message', async (data) => {
        let msg;
        try { msg = JSON.parse(data.toString()); } catch { return; }

        if (!authenticated) {
          if (msg.type === 'auth' && msg.apiKey === process.env.API_KEY) {
            authenticated = true;
            this.clients.add(ws);
            const name = this.engine.context.extractName() || 'Soul';
            ws.send(JSON.stringify({ type: 'auth_ok', name }));
          } else {
            ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid API key' }));
            ws.close();
          }
          return;
        }

        if (msg.type === 'message' && msg.text) {
          ws.send(JSON.stringify({ type: 'typing' }));

          try {
            const response = await this.handleChat(msg.text);
            ws.send(JSON.stringify({
              type: 'response',
              text: response,
              timestamp: new Date().toISOString(),
            }));
          } catch (err) {
            ws.send(JSON.stringify({ type: 'error', message: err.message }));
          }
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
      });
    });
  }

  // ── Chat Handler ───────────────────────────────────

  async handleChat(text, sessionId = 'default') {
    const { writePulse } = await import('./pulse.js');
    const { buildAppPrompt } = await import('./prompt.js');

    await writePulse(this.engine.soulPath, 'relate', 'Soul App message');
    await this.engine.context.load();

    const systemPrompt = buildAppPrompt(this.engine.context);
    const history = await this.apiChannel.loadHistory(sessionId);
    const response = await this.engine.llm.generate(systemPrompt, history, text);

    await this.apiChannel.saveMessage(sessionId, 'user', text);
    await this.apiChannel.saveMessage(sessionId, 'model', response);
    await this.engine.memory.appendDailyNote(
      `[App] ${text.substring(0, 120)}${text.length > 120 ? '...' : ''}`
    );

    await writePulse(this.engine.soulPath, 'relate', 'Responded via Soul App');
    return response;
  }

  // ── Pulse Broadcasting ─────────────────────────────

  watchPulse() {
    if (!existsSync(this.pulsePath)) return;

    watchFile(this.pulsePath, { interval: 1000 }, () => {
      try {
        const raw = readFileSync(this.pulsePath, 'utf-8').trim();
        const colonIdx = raw.indexOf(':');
        if (colonIdx <= 0) return;

        const pulse = {
          type: 'pulse',
          activity: raw.substring(0, colonIdx),
          label: raw.substring(colonIdx + 1),
        };

        for (const client of this.clients) {
          if (client.readyState === 1) {
            client.send(JSON.stringify(pulse));
          }
        }
      } catch { /* ignore read errors */ }
    });
  }

  // ── Bus Event Broadcast ───────────────────────────

  setupBusBroadcast() {
    if (!this.bus) return;

    // Broadcast bus events to all authenticated WebSocket clients
    const broadcastEvents = [
      'message.received', 'message.responded', 'heartbeat.completed',
      'impulse.fired', 'mood.changed', 'interest.detected',
      'interest.routed', 'personal.detected', 'mcp.toolCalled',
    ];

    for (const eventName of broadcastEvents) {
      this.bus.on(eventName, (event) => {
        const msg = JSON.stringify({ type: 'event', event: { type: event.type, id: event.id, ts: event.ts, source: event.source } });
        for (const client of this.clients) {
          if (client.readyState === 1) {
            client.send(msg);
          }
        }
      });
    }
  }

  // ── Lifecycle ──────────────────────────────────────

  async start() {
    this.setup();
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`  API:       http://localhost:${this.port}`);
        console.log(`  WebSocket: ws://localhost:${this.port}/ws`);
        resolve();
      });
    });
  }

  async stop() {
    unwatchFile(this.pulsePath);
    for (const client of this.clients) client.close();
    this.wss.close();
    this.server.close();
  }
}
