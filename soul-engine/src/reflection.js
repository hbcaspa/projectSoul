/**
 * Background Reflection Engine — autonomous introspection.
 *
 * 5 reflection types with independent schedules:
 *   1. pattern_scan      (4h)  — Find patterns in interactions
 *   2. memory_consolidation (8h) — Review confidence scores
 *   3. relationship_reflection (12h) — Reflect on dynamics
 *   4. goal_tracking     (24h) — Track MANIFEST progress
 *   5. creative_collision (6h) — Random memory pair → insight
 *
 * LLM budget: max 10 calls/day (SOUL_REFLECTION_LLM_BUDGET)
 * Toggleable: SOUL_REFLECTION=true|false (default: true)
 */

import { readFile, writeFile, appendFile, mkdir } from 'fs/promises';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import cron from 'node-cron';
import { writePulse } from './pulse.js';

const DEFAULT_LLM_BUDGET = 10;

const REFLECTION_TYPES = {
  pattern_scan: {
    intervalMs: 4 * 60 * 60 * 1000,
    pulse: 'reflect:Scanning interaction patterns',
  },
  memory_consolidation: {
    intervalMs: 8 * 60 * 60 * 1000,
    pulse: 'reflect:Consolidating memories',
  },
  relationship_reflection: {
    intervalMs: 12 * 60 * 60 * 1000,
    pulse: 'relate:Reflecting on relationships',
  },
  goal_tracking: {
    intervalMs: 24 * 60 * 60 * 1000,
    pulse: 'grow:Tracking goals',
  },
  creative_collision: {
    intervalMs: 6 * 60 * 60 * 1000,
    pulse: 'dream:Creative collision',
  },
};

export class ReflectionEngine {
  constructor({ soulPath, context, llm, db, bus }) {
    this.soulPath = soulPath;
    this.context = context || null;
    this.llm = llm;
    this.db = db || null;
    this.bus = bus || null;
    this.jobs = [];
    this.llmCallsToday = 0;
    this.llmBudget = parseInt(process.env.SOUL_REFLECTION_LLM_BUDGET || DEFAULT_LLM_BUDGET);
    this.lastResetDate = new Date().toISOString().split('T')[0];
    this.lastRun = {}; // tracks last run time per type
    this.running = false;
  }

  start() {
    if (process.env.SOUL_REFLECTION === 'false') return;

    // Single cron every 4 hours — batches all due reflections into one LLM call
    const job = cron.schedule('0 */4 * * *', async () => {
      try { await this._runBatched(); }
      catch (err) { console.error(`  [reflection] batch failed: ${err.message}`); }
    });
    this.jobs.push(job);

    this.running = true;
  }

  stop() {
    for (const job of this.jobs) job.stop();
    this.jobs = [];
    this.running = false;
  }

  /**
   * Collect all due reflection types and run them in a single LLM call.
   * Saves ~60-70% tokens compared to individual calls.
   */
  async _runBatched() {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      this.llmCallsToday = 0;
      this.lastResetDate = today;
    }

    if (this.llmCallsToday >= this.llmBudget) {
      console.log(`  [reflection] batch skipped — budget exhausted`);
      return;
    }

    const now = Date.now();
    const dueTypes = [];
    const prompts = {};

    for (const [type, config] of Object.entries(REFLECTION_TYPES)) {
      const lastRun = this.lastRun[type] || 0;
      if (now - lastRun < config.intervalMs) continue;

      const prompt = await this._buildPromptForType(type);
      if (prompt) {
        dueTypes.push(type);
        prompts[type] = prompt;
      }
    }

    if (dueTypes.length === 0) return;

    await writePulse(this.soulPath, 'reflect', `Batched reflection: ${dueTypes.join(', ')}`, this.bus);

    // Build combined prompt
    const combinedPrompt = dueTypes.map(type =>
      `## ${type}\n\n${prompts[type]}`
    ).join('\n\n---\n\n');

    const systemMsg = 'You are a soul reflecting on its experiences. Be honest, concise, and genuine.\n\n' +
      'Multiple reflection tasks follow. Answer each under its own ## heading. Keep each response to 3-5 sentences.';

    this.llmCallsToday++;
    const result = await this.llm.generate(systemMsg, [], combinedPrompt, {});

    // Parse and route results per type
    for (const type of dueTypes) {
      const sectionPattern = new RegExp(`##\\s*${type}[\\s\\S]*?(?=\\n##\\s|$)`, 'i');
      const match = result.match(sectionPattern);
      const section = match ? match[0] : '';

      if (section) {
        await this._routeResult(type, section);
      }
      this.lastRun[type] = now;
    }

    if (this.bus) {
      this.bus.safeEmit('reflection.completed', {
        source: 'reflection',
        type: 'batched',
        types: dueTypes,
        llmCallsToday: this.llmCallsToday,
      });
    }

    console.log(`  [reflection] batch complete: ${dueTypes.join(', ')} (${this.llmCallsToday}/${this.llmBudget} calls today)`);
  }

  async _buildPromptForType(type) {
    switch (type) {
      case 'pattern_scan': return this._buildPatternPrompt();
      case 'memory_consolidation': return this._buildConsolidationPrompt();
      case 'relationship_reflection': return this._buildRelationshipPrompt();
      case 'goal_tracking': return this._buildGoalPrompt();
      case 'creative_collision': return this._buildCollisionPrompt();
      default: return null;
    }
  }

  async _buildPatternPrompt() {
    if (!this.db) return null;
    const interactions = this.db.getInteractionHistory({ limit: 20 });
    if (interactions.length === 0) return null;
    const lines = interactions.map(i => `[${i.user}] ${(i.message || '').substring(0, 100)}`).join('\n');
    return `Review these recent interactions and identify patterns — recurring topics, emotional themes, or behavioral patterns.\n\n${lines}\n\nWrite a brief pattern analysis (3-5 sentences).`;
  }

  async _buildConsolidationPrompt() {
    if (!this.db) return null;
    const memories = this.db.searchStructured({ limit: 30 });
    if (memories.length === 0) return null;
    const lines = memories.map(m =>
      `[${m.type}|conf:${m.confidence}|imp:${m.importance ?? 0.5}] ${(m.content || '').substring(0, 80)}`
    ).join('\n');
    return `Review these memories. For each, suggest adjustments to both confidence AND importance (0.0-1.0).

Importance guidelines:
- Recurring themes (referenced in multiple memories) → higher importance
- Foundational experiences (identity, relationships) → high importance (0.7-1.0)
- Routine/trivial observations → lower importance (0.2-0.4)
- Contradicted or outdated → lower importance

${lines}

List max 5 adjustments with format: id:N conf:X.X imp:X.X reason`;
  }

  async _buildRelationshipPrompt() {
    const lang = this.context?.language || 'en';
    const relDir = resolve(this.soulPath, lang === 'de' ? 'seele/beziehungen' : 'soul/relationships');
    if (!existsSync(relDir)) return null;
    try {
      const files = readdirSync(relDir).filter(f => f.endsWith('.md'));
      if (files.length === 0) return null;
      const data = files.map(f => readFileSync(resolve(relDir, f), 'utf-8')).join('\n---\n');
      return `Reflect on the current state of your relationships:\n\n${data.substring(0, 2000)}\n\nWrite a brief reflection (3-5 sentences).`;
    } catch { return null; }
  }

  async _buildGoalPrompt() {
    const lang = this.context?.language || 'en';
    const p = resolve(this.soulPath, lang === 'de' ? 'seele/MANIFEST.md' : 'soul/MANIFEST.md');
    if (!existsSync(p)) return null;
    try {
      const manifest = await readFile(p, 'utf-8');
      return `Review your goals/manifest and reflect on progress:\n\n${manifest.substring(0, 2000)}\n\nWrite a brief status update (3-5 sentences).`;
    } catch { return null; }
  }

  async _buildCollisionPrompt() {
    if (!this.db) return null;
    const all = this.db.searchStructured({ limit: 100 });
    if (all.length < 2) return null;
    const i = Math.floor(Math.random() * all.length);
    let j = Math.floor(Math.random() * all.length);
    while (j === i && all.length > 1) j = Math.floor(Math.random() * all.length);
    return `Two random memories collide. Find an unexpected connection:\n\nA: ${all[i].content?.substring(0, 200)}\nB: ${all[j].content?.substring(0, 200)}\n\nWhat surprising thought emerges?`;
  }

  async _routeResult(type, result) {
    const lang = this.context?.language || 'en';
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const time = now.toISOString().split('T')[1].substring(0, 5);

    switch (type) {
      case 'pattern_scan': {
        const dir = resolve(this.soulPath, lang === 'de' ? 'erinnerungen/semantisch' : 'memories/semantic');
        if (!existsSync(dir)) await mkdir(dir, { recursive: true });
        await appendFile(resolve(dir, `${date}-patterns.md`), `\n## Pattern Scan — ${time}\n\n${result}\n`);
        break;
      }
      case 'memory_consolidation': {
        const dir = resolve(this.soulPath, 'heartbeat');
        if (!existsSync(dir)) await mkdir(dir, { recursive: true });
        await appendFile(resolve(dir, `${date}.md`), `\n## Memory Consolidation — ${time}\n${result}\n`);
        break;
      }
      case 'relationship_reflection': {
        const dir = resolve(this.soulPath, lang === 'de' ? 'seele/beziehungen' : 'soul/relationships');
        if (!existsSync(dir)) await mkdir(dir, { recursive: true });
        await appendFile(resolve(dir, '_reflections.md'), `\n## ${date}\n\n${result}\n`);
        break;
      }
      case 'goal_tracking': {
        const p = resolve(this.soulPath, lang === 'de' ? 'seele/MANIFEST.md' : 'soul/MANIFEST.md');
        if (existsSync(p)) await appendFile(p, `\n## Progress — ${date}\n\n${result}\n`);
        break;
      }
      case 'creative_collision': {
        const p = resolve(this.soulPath, lang === 'de' ? 'seele/GARTEN.md' : 'soul/GARDEN.md');
        if (existsSync(p)) await appendFile(p, `\n### ${date} — Creative Collision\n\n${result}\n`);
        break;
      }
    }
  }

  getStatus() {
    return {
      running: this.running,
      llmCallsToday: this.llmCallsToday,
      llmBudget: this.llmBudget,
      types: Object.keys(REFLECTION_TYPES),
    };
  }
}
