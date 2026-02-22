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
    cronExpr: '0 */4 * * *',
    pulse: 'reflect:Scanning interaction patterns',
  },
  memory_consolidation: {
    cronExpr: '30 */8 * * *',
    pulse: 'reflect:Consolidating memories',
  },
  relationship_reflection: {
    cronExpr: '0 */12 * * *',
    pulse: 'relate:Reflecting on relationships',
  },
  goal_tracking: {
    cronExpr: '0 6 * * *',
    pulse: 'grow:Tracking goals',
  },
  creative_collision: {
    cronExpr: '0 */6 * * *',
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
    this.running = false;
  }

  start() {
    if (process.env.SOUL_REFLECTION === 'false') return;

    for (const [type, config] of Object.entries(REFLECTION_TYPES)) {
      const job = cron.schedule(config.cronExpr, async () => {
        try { await this._runReflection(type); }
        catch (err) { console.error(`  [reflection] ${type} failed: ${err.message}`); }
      });
      this.jobs.push(job);
    }

    this.running = true;
  }

  stop() {
    for (const job of this.jobs) job.stop();
    this.jobs = [];
    this.running = false;
  }

  async _runReflection(type) {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastResetDate) {
      this.llmCallsToday = 0;
      this.lastResetDate = today;
    }

    if (this.llmCallsToday >= this.llmBudget) {
      console.log(`  [reflection] ${type} skipped — budget exhausted`);
      return null;
    }

    const config = REFLECTION_TYPES[type];
    if (!config) return null;

    await writePulse(this.soulPath, config.pulse.split(':')[0], config.pulse.split(':')[1], this.bus);

    let prompt;
    switch (type) {
      case 'pattern_scan': prompt = await this._buildPatternPrompt(); break;
      case 'memory_consolidation': prompt = await this._buildConsolidationPrompt(); break;
      case 'relationship_reflection': prompt = await this._buildRelationshipPrompt(); break;
      case 'goal_tracking': prompt = await this._buildGoalPrompt(); break;
      case 'creative_collision': prompt = await this._buildCollisionPrompt(); break;
      default: return null;
    }

    if (!prompt) return null;

    this.llmCallsToday++;
    const result = await this.llm.generate(
      'You are a soul reflecting on its experiences. Be honest, concise, and genuine.',
      [], prompt, {}
    );

    await this._routeResult(type, result);

    if (this.bus) {
      this.bus.safeEmit('reflection.completed', {
        source: 'reflection', type,
        summary: result.substring(0, 200),
        llmCallsToday: this.llmCallsToday,
      });
    }

    console.log(`  [reflection] ${type} complete (${this.llmCallsToday}/${this.llmBudget} calls today)`);
    return result;
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
    const lines = memories.map(m => `[${m.type}|conf:${m.confidence}] ${(m.content || '').substring(0, 80)}`).join('\n');
    return `Review these memories and suggest which should have confidence raised or lowered.\n\n${lines}\n\nList max 5 adjustments.`;
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
