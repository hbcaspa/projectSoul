/**
 * Soul API — REST + WebSocket server for the Soul App.
 *
 * REST endpoints provide soul data (status, card, memories, heartbeat).
 * WebSocket provides real-time chat and pulse streaming.
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { existsSync, readFileSync, mkdirSync, watchFile, unwatchFile } from 'node:fs';
import { exec } from 'node:child_process';
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
    this.app.use(express.json({ limit: '50kb' }));
    this.app.use(express.text({ type: 'text/plain', limit: '50kb' }));

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
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
          hibernating: this.engine.hibernating || false,
          pulse,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Hibernation control
    app.post('/api/engine/hibernate', async (req, res) => {
      try {
        await this.engine.hibernate();
        res.json({ ok: true, hibernating: true });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.post('/api/engine/wake', async (req, res) => {
      try {
        await this.engine.wake();
        res.json({ ok: true, hibernating: false });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // --- Soul Protocol v2: Session API ---

    app.get('/api/sessions', (req, res) => {
      try {
        if (!this.engine.sessionManager) return res.json({ sessions: [], stats: {} });
        const limit = parseInt(req.query.limit) || 20;
        const sessions = this.engine.sessionManager.getRecentSessions(limit);
        const stats = this.engine.sessionManager.getStats();
        res.json({ sessions, stats });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Get current active session
    app.get('/api/sessions/current', (req, res) => {
      try {
        if (!this.engine.sessionManager) return res.status(404).json({ error: 'Session manager not available' });
        const session = this.engine.sessionManager.getCurrentSession();
        if (!session) return res.status(404).json({ error: 'No active session' });
        const checkpoints = this.engine.sessionManager.getCheckpoints(session.id);
        res.json({ ...session, checkpoints });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Start a new session
    app.post('/api/sessions/start', (req, res) => {
      try {
        if (!this.engine.sessionManager) return res.status(500).json({ error: 'Session manager not available' });
        const { description = '' } = req.body || {};
        const session = this.engine.sessionManager.startSession(description);
        res.json(session);
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // Transition session state
    app.post('/api/sessions/:number/transition', (req, res) => {
      try {
        if (!this.engine.sessionManager) return res.status(500).json({ error: 'Session manager not available' });
        const { state } = req.body || {};
        if (!state) return res.status(400).json({ error: 'Missing state' });

        // Find session by number and set as current if needed
        const sm = this.engine.sessionManager;
        const session = sm.getSession(parseInt(req.params.number));
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Set as current session if not already
        if (!sm.currentSession || sm.currentSession.number !== session.number) {
          sm.currentSession = session;
        }

        const updated = sm.transition(state);
        res.json(updated);
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // Update checkpoint
    app.post('/api/sessions/:number/checkpoint', (req, res) => {
      try {
        if (!this.engine.sessionManager) return res.status(500).json({ error: 'Session manager not available' });
        const { phase, status = 'completed' } = req.body || {};
        if (!phase) return res.status(400).json({ error: 'Missing phase' });

        const sm = this.engine.sessionManager;
        const session = sm.getSession(parseInt(req.params.number));
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (!sm.currentSession || sm.currentSession.number !== session.number) {
          sm.currentSession = session;
        }

        sm.updateCheckpoint(phase, status);
        res.json({ ok: true, phase, status });
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // Full-text search across all sessions
    app.get('/api/sessions/search', (req, res) => {
      try {
        if (!this.engine.sessionManager) return res.json({ results: [] });
        const q = req.query.q || '';
        const limit = parseInt(req.query.limit) || 20;
        const results = this.engine.sessionManager.searchSessions(q, limit);
        res.json({ results, query: q });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/sessions/:number', (req, res) => {
      try {
        if (!this.engine.sessionManager) return res.status(404).json({ error: 'Session manager not available' });
        const session = this.engine.sessionManager.getSession(parseInt(req.params.number));
        if (!session) return res.status(404).json({ error: 'Session not found' });
        const events = this.engine.sessionManager.getEvents(session.id);
        const checkpoints = this.engine.sessionManager.getCheckpoints(session.id);
        res.json({ session, events, checkpoints });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Auto-generated skills
    app.get('/api/skills/auto', async (req, res) => {
      try {
        if (!this.engine.autoSkill) return res.json({ skills: [] });
        const skills = await this.engine.autoSkill.list();
        res.json({ skills });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Community skill registry
    app.get('/api/skills/registry', async (req, res) => {
      try {
        const registryPath = path.resolve(this.engine.soulPath, 'soul-skills.json');
        if (!existsSync(registryPath)) {
          return res.json({ version: '1.0', skills: [] });
        }
        const data = JSON.parse(await readFile(registryPath, 'utf8'));
        res.json(data);
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Install a community skill by ID or URL
    app.post('/api/skills/install', async (req, res) => {
      try {
        const { id, url } = req.body || {};
        if (!id && !url) {
          return res.status(400).json({ error: 'Provide either id or url' });
        }

        const scriptPath = path.resolve(this.engine.soulPath, 'scripts', 'install-skill.sh');
        if (!existsSync(scriptPath)) {
          return res.status(500).json({ error: 'install-skill.sh not found' });
        }

        const arg = url || id;
        const cmd = `bash "${scriptPath}" "${arg}"`;

        await new Promise((resolve, reject) => {
          exec(cmd, { cwd: this.engine.soulPath, timeout: 30000 }, (err, stdout, stderr) => {
            if (err) {
              return reject(new Error(stderr || err.message));
            }
            res.json({ installed: true, skill: arg, output: stdout.trim() });
            resolve();
          });
        });

        // Reload recipes to pick up the new skill
        if (this.engine.recipes) {
          this.engine.recipes.load();
        }
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/recipes', (req, res) => {
      try {
        if (!this.engine.recipes) return res.json({ recipes: [] });
        res.json({ recipes: this.engine.recipes.list() });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/compactor/stats', (req, res) => {
      try {
        if (!this.engine.compactor) return res.json({ stats: {} });
        res.json({ stats: this.engine.compactor.getStats() });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // SSE Event Stream — replaces .soul-pulse file polling
    app.get('/api/events/stream', (req, res) => {
      const lastId = parseInt(req.query.lastEventId) || 0;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      // Replay missed events
      const missed = this.engine.bus.getEventsSince(lastId);
      for (const event of missed) {
        res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
      }

      // Live stream
      const intervalId = setInterval(() => {
        const lastSent = res._lastEventId || lastId;
        const newEvents = this.engine.bus.getEventsSince(lastSent, 20);
        for (const event of newEvents) {
          res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
          res._lastEventId = event.id;
        }
      }, 1000);

      res._lastEventId = lastId;

      req.on('close', () => {
        clearInterval(intervalId);
      });
    });

    // Memory Extractor stats
    app.get('/api/memory-extractor/stats', (req, res) => {
      try {
        if (!this.engine.memoryExtractor) return res.json({ stats: {} });
        res.json({ stats: this.engine.memoryExtractor.getStats() });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Soul Adapter — compile identity for different providers
    app.get('/api/adapter/compile/:provider', (req, res) => {
      try {
        if (!this.engine.soulAdapter) return res.status(404).json({ error: 'Soul adapter not available' });
        this.engine.soulAdapter.load(); // Refresh from files
        const prompt = this.engine.soulAdapter.compile(req.params.provider, {
          includeProtocol: req.query.protocol !== 'false',
          includeState: req.query.state !== 'false',
        });
        const profile = this.engine.soulAdapter.getProfile(req.params.provider);
        res.json({
          provider: req.params.provider,
          profile,
          promptLength: prompt.length,
          estimatedTokens: Math.ceil(prompt.length / 4),
          prompt,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // List all supported providers
    app.get('/api/adapter/providers', (req, res) => {
      try {
        if (!this.engine.soulAdapter) return res.json({ providers: [] });
        res.json({ providers: this.engine.soulAdapter.listProviders() });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Execute a recipe
    app.post('/api/recipes/:id/execute', async (req, res) => {
      try {
        if (!this.engine.recipes) return res.status(404).json({ error: 'Recipe engine not available' });
        const result = await this.engine.recipes.execute(req.params.id, req.body.values || {});
        res.json(result);
      } catch (err) {
        res.status(400).json({ error: err.message });
      }
    });

    // HTTP polling fallback for events
    app.get('/api/events', (req, res) => {
      const lastId = parseInt(req.query.since) || 0;
      const limit = parseInt(req.query.limit) || 50;
      const events = this.engine.bus.getEventsSince(lastId, limit);
      res.json({ events, lastId: events.length > 0 ? events[events.length - 1].id : lastId });
    });

    // Pulse endpoint — replaces .soul-pulse file writing
    app.post('/api/pulse', (req, res) => {
      try {
        const { type, label } = req.body || {};
        if (!type) return res.status(400).json({ error: 'Missing type' });

        // Emit to event bus
        this.engine.bus.safeEmit('pulse.written', { type, label, source: 'claude-code' });

        // Also write legacy .soul-pulse file for backwards compatibility
        const { writeFileSync } = require('fs');
        const pulsePath = require('path').resolve(this.engine.soulPath, '.soul-pulse');
        writeFileSync(pulsePath, `${type}:${label || ''}`);

        res.json({ ok: true });
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

    // Push seed (from iOS or other clients)
    app.put('/api/seed/raw', async (req, res) => {
      try {
        // Accept both text/plain body and JSON { seed: "..." }
        let seedText = '';
        if (typeof req.body === 'string') {
          seedText = req.body;
        } else if (req.body && req.body.seed) {
          seedText = req.body.seed;
        } else {
          return res.status(400).json({ error: 'Seed text required (send as JSON { seed: "..." } or text/plain body)' });
        }

        if (!seedText.includes('@KERN') && !seedText.includes('#SEED')) {
          return res.status(400).json({ error: 'Invalid seed format — must contain @KERN or #SEED' });
        }

        // Atomic write: tmp file → rename (prevents corruption, follows F3 pattern)
        const seedPath = path.resolve(soulPath, 'SEED.md');
        const tmpPath = seedPath + '.tmp.' + Date.now();
        await writeFile(tmpPath, seedText, 'utf-8');
        await rename(tmpPath, seedPath);

        // Invalidate engine cache so next read gets the new seed
        this.engine.context.invalidate();

        console.log(`  [api] Seed pushed (${seedText.length} bytes)`);
        res.json({ ok: true, size: seedText.length });
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

    // (v2 /api/events is defined above — removed duplicate)

    // Allostatic Identity Field — 8D state vector
    app.get('/api/field', (req, res) => {
      try {
        if (!this.engine.field) {
          return res.json({ enabled: false });
        }
        res.json({ enabled: true, ...this.engine.field.getState() });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Reconsolidative Memory (Layer 2) — memory confidence tracking
    app.get('/api/reconsolidation', (req, res) => {
      try {
        if (!this.engine.reconsolidation) {
          return res.json({ enabled: false });
        }
        res.json({
          enabled: true,
          stats: this.engine.reconsolidation.getStats(),
          ranked: this.engine.reconsolidation.getRanked(10),
          fading: this.engine.reconsolidation.getFading(),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Predictive Self-Model (Layer 3) — self-knowledge tracking
    app.get('/api/predictor', (req, res) => {
      try {
        if (!this.engine.predictor) {
          return res.json({ enabled: false });
        }
        res.json({
          enabled: true,
          stats: this.engine.predictor.getStats(),
          pending: this.engine.predictor.getPending(),
          history: this.engine.predictor.getAccuracyHistory(10),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Causal Engine (D1) — causal graph + counterfactuals
    app.get('/api/causal', (req, res) => {
      try {
        if (!this.engine.causal) return res.json({ enabled: false });
        res.json({
          enabled: true,
          metrics: this.engine.causal.getMetrics(),
          influential: this.engine.causal.getMostInfluential(5),
          learnedPatterns: this.engine.causal.patternLearner.getSignificantPatterns(0.3).slice(0, 10),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Goal Generator (D2) — autonomous goals
    app.get('/api/goals', (req, res) => {
      try {
        if (!this.engine.goalGenerator) return res.json({ enabled: false });
        res.json({
          enabled: true,
          stats: this.engine.goalGenerator.getStats(),
          goals: this.engine.goalGenerator.getGoals({ limit: 20 }),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Metacognitive Monitor (D4) — epistemic calibration
    app.get('/api/metacognition', (req, res) => {
      try {
        if (!this.engine.metacognition) return res.json({ enabled: false });
        res.json({
          enabled: true,
          state: this.engine.metacognition.getEpistemicState(),
          calibrationCurve: this.engine.metacognition.getCalibrationCurve(),
          brierDecomposition: this.engine.metacognition.getBrierDecomposition(),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Inner Red Team (D7) — vulnerability findings + predictions
    app.get('/api/redteam', (req, res) => {
      try {
        if (!this.engine.redTeam) return res.json({ enabled: false });
        res.json({
          enabled: true,
          stats: this.engine.redTeam.getStats(),
          scores: this.engine.redTeam.getScores(),
          predictions: this.engine.redTeam.getPredictions({ minConfidence: 0.4 }),
          findings: this.engine.redTeam.getFindings({ severity: 'HIGH', limit: 20 }),
          selfTest: this.engine.redTeam.getSelfTestResults(),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Transfer Engine (D3) — cross-domain analogies
    app.get('/api/transfer', (req, res) => {
      try {
        if (!this.engine.transfer) return res.json({ enabled: false });
        const analogies = this.engine.transfer.discoverAnalogies?.() || [];
        res.json({
          enabled: true,
          stats: this.engine.transfer.getStats(),
          topAnalogies: analogies.slice(0, 10),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Temporal Intelligence (D6) — time models + pressure
    app.get('/api/temporal', (req, res) => {
      try {
        if (!this.engine.temporal) return res.json({ enabled: false });
        res.json({
          enabled: true,
          state: this.engine.temporal.getTemporalState(),
          pressure: this.engine.temporal.getTimePressure(),
          constraints: this.engine.temporal.getSequencingConstraints(),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Soul Exchange (D8) — compression metrics
    app.get('/api/exchange', (req, res) => {
      try {
        if (!this.engine.exchange) return res.json({ enabled: false });
        res.json({
          enabled: true,
          metrics: this.engine.exchange.getMetrics(),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Soul Composer (D5) — pipeline catalog + metrics
    app.get('/api/composer', (req, res) => {
      try {
        if (!this.engine.composer) return res.json({ enabled: false });
        res.json({
          enabled: true,
          stats: this.engine.composer.getStats(),
          pipelines: this.engine.composer.listPipelines(),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Planner (D9) — plan catalog + metrics
    app.get('/api/planner', (req, res) => {
      try {
        if (!this.engine.planner) return res.json({ enabled: false });
        res.json({ enabled: true, metrics: this.engine.planner.getMetrics() });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // ContradictionEngine (D10) — active contradictions + metrics
    app.get('/api/contradictions', (req, res) => {
      try {
        if (!this.engine.contradictions) return res.json({ enabled: false });
        res.json({
          enabled: true,
          stats: this.engine.contradictions.getStats(),
          active: this.engine.contradictions.getActiveContradictions().slice(0, 20),
          irreducible: this.engine.contradictions.getIrreducible(),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // MetaLearner (D11) — learning curves + stagnation report
    app.get('/api/meta-learner', (req, res) => {
      try {
        if (!this.engine.metaLearner) return res.json({ enabled: false });
        res.json({
          enabled: true,
          state: this.engine.metaLearner.getMetaState(),
          stagnation: this.engine.metaLearner.getStagnationReport(),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // TheoryOfMind (D12) — user model + calibration
    app.get('/api/tom', (req, res) => {
      try {
        if (!this.engine.tom) return res.json({ enabled: false });
        res.json({
          enabled: true,
          stats: this.engine.tom.getStats(),
          calibration: this.engine.tom.getCalibration(),
          selfTest: this.engine.tom.getSelfTestResults(),
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Cortex Mind Panel — real-time inner state (emotion, surprise, needs, drang)
    app.get('/api/mind', (req, res) => {
      try {
        if (!this.engine.cortex) {
          return res.json({ enabled: false });
        }
        res.json({ enabled: true, ...this.engine.cortex.getState() });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    // Claude Code Session Bridge — pushes conversation events into the engine
    // Called by Claude Code during active sessions to feed D12 TOM, RLUF, etc.
    // type "message" → emits message.received → TOM processes → ContextWriter refreshes
    // type "feedback" → emits rluf.feedback directly
    app.post('/api/session/event', (req, res) => {
      try {
        const { type = 'message', text, userId = 'aalm', reward, sentiment } = req.body;

        if (type === 'message') {
          if (!text) return res.status(400).json({ error: 'text required for type message' });
          this.engine.bus.safeEmit('message.received', {
            source: 'claude-code',
            text,
            userName: userId,
            channel: 'claude-code',
          });
          // Return TOM model snapshot if available
          const model = this.engine.tom?.getModel(userId) || null;
          return res.json({ ok: true, type, tom: model ? { emotional: model.emotional, activeGoals: model.activeGoals } : null });
        }

        if (type === 'feedback') {
          if (reward == null) return res.status(400).json({ error: 'reward required for type feedback' });
          this.engine.bus.safeEmit('rluf.feedback', {
            source: 'claude-code',
            reward: Number(reward),
            sentiment: sentiment != null ? Number(sentiment) : 0,
            impulseType: 'claude-session',
            components: { sentiment: sentiment != null ? Number(sentiment) : 0 },
          });
          return res.json({ ok: true, type });
        }

        return res.status(400).json({ error: `unknown event type: ${type}. Use message or feedback.` });
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

    // Module settings — enable/disable/trigger autonomous modules
    app.get('/api/modules', (req, res) => {
      const trader   = this.engine.trader;
      const security = this.engine.securityAgent;
      res.json({
        trader: {
          enabled:  process.env.TRADER_ENABLED === 'true',
          cron:     process.env.TRADER_CRON || '0 8 * * *',
          running:  !!trader?.task,
        },
        security: {
          enabled:  process.env.SECURITY_AGENT_ENABLED === 'true',
          cron:     process.env.SECURITY_CRON || '0 9 * * 1',
          running:  !!security?.task,
        },
      });
    });

    app.post('/api/modules/security/trigger', async (req, res) => {
      const agent = this.engine.securityAgent;
      if (!agent) return res.status(404).json({ error: 'Security agent not initialized' });
      res.json({ ok: true, message: 'Security check triggered — report will arrive via Telegram' });
      // Run async (don't await — takes 30-60s)
      agent.runCheck().catch(err => console.error(`  [security] Manual trigger error: ${err.message}`));
    });

    app.post('/api/modules/trader/trigger', async (req, res) => {
      const trader = this.engine.trader;
      if (!trader) return res.status(404).json({ error: 'Trader not initialized' });
      res.json({ ok: true, message: 'Trader run triggered — result will arrive via Telegram' });
      trader.runDailyTrader().catch(err => console.error(`  [trader] Manual trigger error: ${err.message}`));
    });

    // Subagent spawning — run parallel LLM sub-tasks
    app.post('/api/subagents/spawn', async (req, res) => {
      try {
        if (!this.engine.subagents) {
          return res.status(503).json({ error: 'Subagent manager not available (LLM not initialized)' });
        }
        const { agents } = req.body || {};
        if (!agents || !Array.isArray(agents) || agents.length === 0) {
          return res.status(400).json({ error: 'agents array required (each with role and goal)' });
        }
        // Validate each agent
        for (const agent of agents) {
          if (!agent.role || !agent.goal) {
            return res.status(400).json({ error: 'Each agent must have role and goal' });
          }
        }
        const results = await this.engine.subagents.spawn(agents);
        res.json({ results, count: results.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    app.get('/api/subagents/status', (req, res) => {
      try {
        if (!this.engine.subagents) {
          return res.json({ enabled: false, activeCount: 0 });
        }
        res.json({ enabled: true, ...this.engine.subagents.getStatus() });
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
