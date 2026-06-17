/**
 * AutoSkill — Learns from completed sessions and generates Recipe YAMLs.
 *
 * Inspired by Hermes Agent's closed learning loop.
 * Listens for session.transition → completed, analyzes session events,
 * and generates new recipes from notable sessions.
 */

import { resolve } from 'path';
import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'fs';

const AUTO_RECIPES_DIR = 'recipes/auto';
// Hermes-Agent-Style trigger: lower threshold for more autonomous skill creation.
// Counts tool-use events (not just any event) to match Hermes' "5+ tool calls" pattern.
const MIN_TOOL_CALLS = 5;
const MIN_DURATION_MS = 3 * 60 * 1000;

export class AutoSkill {
  constructor({ soulPath, sessionManager, llm, bus }) {
    this.soulPath = soulPath;
    this.sessionManager = sessionManager;
    this.llm = llm;
    this.bus = bus;
    this.autoDir = resolve(soulPath, AUTO_RECIPES_DIR);
  }

  async init() {
    if (!existsSync(this.autoDir)) {
      await mkdir(this.autoDir, { recursive: true });
    }
    this.statsDir = resolve(this.autoDir, '.stats');
    if (!existsSync(this.statsDir)) {
      await mkdir(this.statsDir, { recursive: true });
    }

    this.bus.on('session.transition', async (event) => {
      if (event.to !== 'completed') return;
      try {
        await this._analyzeSession();
      } catch (err) {
        console.error(`  [auto-skill] Analysis failed: ${err.message}`);
      }
    });

    // Hermes-style skill self-improvement: track each recipe execution,
    // and after N runs ask the LLM to refine the recipe based on real usage.
    this.bus.on('recipe.executed', async (event) => {
      try {
        await this._trackAndMaybeImprove(event);
      } catch (err) {
        console.error(`  [auto-skill] self-improve failed: ${err.message}`);
      }
    });

    console.log('  AutoSkill: active (learning + self-improving)');
  }

  async _trackAndMaybeImprove(event) {
    const recipeId = event?.recipe || event?.id || event?.slug;
    if (!recipeId) return;
    const statsFile = resolve(this.statsDir, `${recipeId}.json`);
    let stats = { recipe: recipeId, runs: [], lastImprovedAt: null };
    try {
      if (existsSync(statsFile)) {
        stats = JSON.parse(await readFile(statsFile, 'utf-8'));
      }
    } catch {}
    stats.runs.push({
      ts: new Date().toISOString(),
      success: event?.success !== false,
      durationMs: event?.durationMs ?? null,
      error: event?.error ?? null,
      notes: event?.notes ?? null,
    });
    if (stats.runs.length > 50) stats.runs = stats.runs.slice(-50);
    await writeFile(statsFile, JSON.stringify(stats, null, 2), 'utf-8');

    // Trigger self-improve every 5 runs, but only if LLM available and not improved in last 24h.
    if (stats.runs.length % 5 !== 0) return;
    if (stats.lastImprovedAt) {
      const since = Date.now() - new Date(stats.lastImprovedAt).getTime();
      if (since < 24 * 60 * 60 * 1000) return;
    }
    if (!this.llm) return;
    await this._selfImproveRecipe(recipeId, stats);
  }

  async _selfImproveRecipe(recipeId, stats) {
    // Only auto-generated recipes are improved (we own them).
    const recipeFile = resolve(this.autoDir, `auto-${recipeId.replace(/^auto-/, '')}.yaml`);
    if (!existsSync(recipeFile)) return;
    const current = await readFile(recipeFile, 'utf-8');

    const recent = stats.runs.slice(-10);
    const successRate = recent.filter(r => r.success).length / recent.length;
    const summary = recent
      .map(r => `[${r.ts}] success=${r.success} ${r.error ? 'err=' + r.error.slice(0, 80) : ''}`)
      .join('\n');

    const prompt = `Verbessere dieses Recipe basierend auf realer Nutzung.

CURRENT YAML:
${current}

LETZTE ${recent.length} AUSFÜHRUNGEN (success rate ${(successRate * 100).toFixed(0)}%):
${summary}

Schreibe das YAML neu — gleicher Aufbau, aber:
- bessere instructions wenn Fehler-Muster sichtbar sind
- klarerer prompt wenn success-rate < 80%
- füge ein 'lessons' Feld unter auto_generated hinzu mit 1-3 kurzen Bullets
- behalte version, title, trigger unverändert

Antworte NUR mit dem neuen YAML. Keine Erklärung.`;

    try {
      const result = await this.llm.generate(prompt, [], '', { max_tokens: 1500 });
      if (!result || result.trim().length < 50) return;
      let yaml = result.trim();
      if (yaml.startsWith('```yaml')) yaml = yaml.replace(/^```yaml\n?/, '').replace(/\n?```$/, '');
      if (yaml.startsWith('```')) yaml = yaml.replace(/^```\n?/, '').replace(/\n?```$/, '');
      await writeFile(recipeFile, yaml, 'utf-8');
      stats.lastImprovedAt = new Date().toISOString();
      const statsFile = resolve(this.statsDir, `${recipeId}.json`);
      await writeFile(statsFile, JSON.stringify(stats, null, 2), 'utf-8');
      this.bus.safeEmit('skill.improved', {
        source: 'auto-skill',
        recipe: recipeId,
        runs: stats.runs.length,
        successRate,
      });
      console.log(`  [auto-skill] Self-improved: ${recipeId} (${stats.runs.length} runs, ${(successRate * 100).toFixed(0)}% success)`);
    } catch (err) {
      console.error(`  [auto-skill] self-improve LLM failed: ${err.message}`);
    }
  }

  async _analyzeSession() {
    const session = this.sessionManager.currentSession;
    if (!session) return;

    const events = this.sessionManager.getEvents(session.id, 200);
    // Hermes-style: count tool-use events specifically, not all events.
    const toolCalls = events.filter(e =>
      e.type === 'tool.use' ||
      e.type === 'tool.call' ||
      e.type === 'recipe.executed' ||
      e.type === 'mcp.call'
    ).length;
    if (toolCalls < MIN_TOOL_CALLS && events.length < MIN_TOOL_CALLS * 2) return;

    // Check duration (now 3min minimum — was 15)
    if (session.ended_at && session.started_at) {
      const duration = new Date(session.ended_at).getTime() - new Date(session.started_at.replace(' ', 'T')).getTime();
      if (duration < MIN_DURATION_MS) return;
    }

    // Check for skill-worthy patterns
    const eventTypes = events.map(e => e.type);
    const hasRecipe = eventTypes.includes('recipe.executed');
    const hasCheckpoints = eventTypes.filter(t => t === 'checkpoint.updated').length >= 3;
    const hasTransitions = eventTypes.filter(t => t === 'session.transition').length >= 4;

    if (!hasRecipe && !hasCheckpoints && !hasTransitions) return;

    // Don't generate if LLM not available
    if (!this.llm) return;

    // Summarize events for LLM
    const eventSummary = events
      .slice(0, 50)
      .map(e => {
        const data = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
        return `[${e.type}] ${data.substring(0, 120)}`;
      })
      .join('\n');

    const description = session.metadata
      ? JSON.parse(session.metadata).description || ''
      : '';

    const prompt = `Du bist ein Skill-Generator für das Soul Protocol.
Analysiere diese Session und erstelle ein wiederverwendbares Recipe im YAML-Format.

Session ${session.number}: "${description}"
Dauer: ${session.ended_at ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at.replace(' ', 'T')).getTime()) / 60000) : '?'} Minuten
Events: ${events.length}

Event-Log:
${eventSummary}

Erstelle ein YAML-Recipe das die Kernaktivität dieser Session als wiederverwendbaren Skill beschreibt.
Nur wenn die Session etwas Wiederverwendbares enthielt. Wenn nicht, antworte mit "SKIP".

Format:
version: "1.0"
title: "Auto: [kurzer Name]"
description: "[was der Skill tut]"
trigger: "auto-[slug]"
auto_generated:
  session: ${session.number}
  date: "${new Date().toISOString().split('T')[0]}"
  events: ${events.length}
instructions: |
  [Anweisungen für den Skill]
prompt: |
  [Initialer Prompt]
settings:
  max_tokens: 4096
  temperature: 0.7

Antworte NUR mit dem YAML oder "SKIP". Keine Erklärung.`;

    try {
      const result = await this.llm.generate(prompt, [], '', { max_tokens: 1024 });
      if (!result || result.trim() === 'SKIP' || result.trim().length < 50) {
        return;
      }

      // Clean YAML
      let yaml = result.trim();
      if (yaml.startsWith('```yaml')) yaml = yaml.replace(/^```yaml\n?/, '').replace(/\n?```$/, '');
      if (yaml.startsWith('```')) yaml = yaml.replace(/^```\n?/, '').replace(/\n?```$/, '');

      // Extract slug from trigger field
      const triggerMatch = yaml.match(/trigger:\s*"?auto-([a-z0-9-]+)"?/);
      const slug = triggerMatch ? triggerMatch[1] : `session-${session.number}`;
      const filename = `auto-${slug}.yaml`;
      const filepath = resolve(this.autoDir, filename);

      await writeFile(filepath, yaml, 'utf-8');

      this.bus.safeEmit('skill.created', {
        source: 'auto-skill',
        session: session.number,
        filename,
        slug,
      });

      console.log(`  [auto-skill] New skill created: ${filename} (from session ${session.number})`);
    } catch (err) {
      console.error(`  [auto-skill] LLM generation failed: ${err.message}`);
    }
  }

  async list() {
    try {
      const files = await readdir(this.autoDir);
      return files.filter(f => f.endsWith('.yaml')).map(f => f.replace('.yaml', ''));
    } catch {
      return [];
    }
  }
}
