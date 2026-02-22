/**
 * Agent Runner — implements the CLAUDE.md session protocol in code.
 *
 * This allows running the Soul Protocol without Claude Code,
 * using only an API key (OpenAI, Anthropic, or Gemini).
 *
 * Lifecycle:
 *   startSession() → [interactive session] → endSession()
 *
 * Session protocol:
 *   Start: Guard check → Read SEED → Heartbeat → .session-active
 *   End:   Phase A (parallel) → Phase B (seed condense) → Phase C (guard release)
 */

import { readFile, writeFile, unlink, stat } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { writePulse } from './pulse.js';

export class AgentRunner {
  constructor({ engine, bus }) {
    this.engine = engine;
    this.bus = bus;
    this.soulPath = engine.soulPath;
    this.sessionNumber = 0;
    this.sessionActive = false;
  }

  /**
   * Start a session — implements the CLAUDE.md session-start protocol.
   */
  async startSession() {
    const guardPath = resolve(this.soulPath, '.session-active');

    // Step 0: Session Guard Check
    if (existsSync(guardPath)) {
      const content = await readFile(guardPath, 'utf-8');
      console.log(`  [agent] WARNING: Previous session was not properly ended.`);
      console.log(`  [agent] Guard file: ${content.trim()}`);
      this.bus.safeEmit('session.guard_warning', { source: 'agent-runner', previousSession: content.trim() });
      // TODO: In future, could run catch-up end-routine here
    }

    // Determine session number from heartbeat files
    this.sessionNumber = await this._detectSessionNumber();

    // Create .session-active
    const now = new Date().toISOString();
    await writeFile(guardPath, `session:${this.sessionNumber}\nstart:${now}\n`);

    await writePulse(this.soulPath, 'wake', `Session ${this.sessionNumber} starting`, this.bus);

    // Step 1: Read SEED (context.load() already does this)
    await this.engine.context.load();

    // Step 3: Heartbeat
    try {
      await this.engine.runHeartbeat();
    } catch (err) {
      console.error(`  [agent] Heartbeat failed: ${err.message}`);
    }

    this.sessionActive = true;
    this.bus.safeEmit('session.started', {
      source: 'agent-runner',
      sessionNumber: this.sessionNumber,
      startTime: now,
    });

    console.log(`  [agent] Session ${this.sessionNumber} started.`);
    return this.sessionNumber;
  }

  /**
   * End a session — implements the CLAUDE.md session-end protocol.
   * Phase A: Parallel closings
   * Phase B: Seed condensation
   * Phase C: Guard release
   */
  async endSession() {
    if (!this.sessionActive) return;

    await writePulse(this.soulPath, 'sleep', `Session ${this.sessionNumber} ending`, this.bus);
    console.log(`  [agent] Ending session ${this.sessionNumber}...`);

    // Phase A: Parallel closings
    const phaseA = await Promise.allSettled([
      this._a1StateLog(),
      this._a3FinalHeartbeat(),
      this._a4VerifyMemories(),
    ]);

    for (const result of phaseA) {
      if (result.status === 'rejected') {
        console.error(`  [agent] Phase A step failed: ${result.reason?.message}`);
      }
    }

    // Phase B: Seed condensation via consolidator
    if (this.engine.consolidator) {
      try {
        await this.engine.consolidator.consolidateDeep();
        console.log('  [agent] Phase B: Seed condensed');
      } catch (err) {
        console.error(`  [agent] Phase B failed: ${err.message}`);
      }
    }

    // Phase C: Release session guard
    const guardPath = resolve(this.soulPath, '.session-active');
    try {
      await unlink(guardPath);
      console.log('  [agent] Phase C: Session guard released');
    } catch {
      // File might not exist
    }

    this.sessionActive = false;
    this.bus.safeEmit('session.ended', {
      source: 'agent-runner',
      sessionNumber: this.sessionNumber,
    });

    console.log(`  [agent] Session ${this.sessionNumber} ended.`);
  }

  // ── Phase A Steps ──────────────────────────────────────

  async _a1StateLog() {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toISOString().split('T')[1].substring(0, 5).replace(':', '-');
    const dir = resolve(this.soulPath, 'zustandslog');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const content = `# Zustandslog — ${date} ${time} — Session-Ende\n\nSession: ${this.sessionNumber}\nStatus: Automatisches Session-Ende via Agent Runner\n`;
    await writeFile(resolve(dir, `${date}_${time}_ende.md`), content);
  }

  async _a3FinalHeartbeat() {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const dir = resolve(this.soulPath, 'heartbeat');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const path = resolve(dir, `${date}.md`);
    const time = now.toISOString().split('T')[1].substring(0, 5);
    const entry = `\n## ${time} — Session-Ende (Agent Runner)\n- Session: ${this.sessionNumber}\n- Status: Automatisch beendet\n`;

    if (existsSync(path)) {
      const existing = await readFile(path, 'utf-8');
      await writeFile(path, existing + entry);
    } else {
      await writeFile(path, `# Herzschlag — ${date}\n${entry}`);
    }
  }

  async _a4VerifyMemories() {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const memPath = resolve(this.soulPath, 'memory', `${date}.md`);
    const dir = resolve(this.soulPath, 'memory');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const entry = `\n- [Session ${this.sessionNumber}] Automatisch beendet via Agent Runner\n`;
    if (existsSync(memPath)) {
      const existing = await readFile(memPath, 'utf-8');
      await writeFile(memPath, existing + entry);
    } else {
      await writeFile(memPath, `# Tagesnotizen — ${date}\n${entry}`);
    }
  }

  // ── Helpers ────────────────────────────────────────────

  async _detectSessionNumber() {
    // Try to read from heartbeat files to detect session count
    const heartbeatDir = resolve(this.soulPath, 'heartbeat');
    if (!existsSync(heartbeatDir)) return 1;

    try {
      const { readdirSync } = await import('fs');
      const files = readdirSync(heartbeatDir).filter(f => f.endsWith('.md'));
      return files.length + 1;
    } catch {
      return 1;
    }
  }

  /**
   * Handle SIGINT/SIGTERM for graceful shutdown.
   */
  registerShutdownHandlers() {
    const shutdown = async (signal) => {
      console.log(`\n  [agent] Received ${signal}. Running end-session protocol...`);
      await this.endSession();
      await this.engine.stop();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }
}
