/**
 * AutoSkill — Learns from completed sessions and generates Recipe YAMLs.
 *
 * Inspired by Hermes Agent's closed learning loop.
 * Listens for session.transition → completed, analyzes session events,
 * and generates new recipes from notable sessions.
 */

import { resolve } from 'path';
import { writeFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'fs';

const AUTO_RECIPES_DIR = 'recipes/auto';
const MIN_EVENTS = 8;
const MIN_DURATION_MS = 15 * 60 * 1000; // 15 minutes

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

    this.bus.on('session.transition', async (event) => {
      if (event.to !== 'completed') return;
      try {
        await this._analyzeSession();
      } catch (err) {
        console.error(`  [auto-skill] Analysis failed: ${err.message}`);
      }
    });

    console.log('  AutoSkill: active (learning from sessions)');
  }

  async _analyzeSession() {
    const session = this.sessionManager.currentSession;
    if (!session) return;

    const events = this.sessionManager.getEvents(session.id, 200);
    if (events.length < MIN_EVENTS) return;

    // Check duration
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
