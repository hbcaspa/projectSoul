/**
 * ClaudeContextWriter — Bridges Soul Engine state to Claude Code sessions.
 *
 * Writes `.soul-claude-context.md` to the soul path whenever significant
 * engine events occur, and periodically as a refresh. Claude Code reads
 * this file at session start to get the current state of all modules.
 *
 * Events consumed:
 *   tom.context              — TOM updated its model of the user
 *   contradiction.scan.completed — New contradictions detected
 *   plan.created             — Planner decomposed a goal
 *   meta.stagnation.detected — MetaLearner detected a stuck module
 *   meta.analysis.updated    — MetaLearner completed a poll cycle
 *
 * Output: ${soulPath}/.soul-claude-context.md (refreshed every 5 min + on events)
 */

import { readFile, writeFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { join } from 'path';

const WRITE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const OUTPUT_FILE = '.soul-claude-context.md';
const COMPILED_PROMPT_FILE = '.soul-compiled-prompt';

export class ClaudeContextWriter {
  constructor(soulPath, { bus, engine }) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.engine = engine;
    this.outputPath = join(soulPath, OUTPUT_FILE);

    // Cache last known state from events
    this._lastTomContext = null;
    this._lastStagnation = null;
    this._writeTimer = null;
    this._writing = false;
  }

  registerListeners() {
    // TOM updated its model — highest priority, write immediately
    this.bus.on('tom.context', (event) => {
      this._lastTomContext = event;
      this._scheduleWrite(true);
    });

    // New contradictions found — write soon
    this.bus.on('contradiction.scan.completed', () => {
      this._scheduleWrite(true);
    });

    // New plan created
    this.bus.on('plan.created', () => {
      this._scheduleWrite(false);
    });

    // Stagnation detected — important, write immediately
    this.bus.on('meta.stagnation.detected', (event) => {
      this._lastStagnation = event;
      this._scheduleWrite(true);
    });

    // MetaLearner analysis updated — periodic refresh
    this.bus.on('meta.analysis.updated', () => {
      this._scheduleWrite(false);
    });

    // SoulLang compiled — include new prompt in context
    this.bus.on('soullang.compiled', () => {
      this._scheduleWrite(true);
    });
  }

  start() {
    // Periodic full refresh
    this._writeTimer = setInterval(() => this._write(), WRITE_INTERVAL_MS);
    // Write once immediately on start
    this._write().catch(() => {});
    console.log(`  ContextWriter: active (output: ${OUTPUT_FILE}, refresh: 5min)`);
  }

  stop() {
    if (this._writeTimer) {
      clearInterval(this._writeTimer);
      this._writeTimer = null;
    }
  }

  // immediate=true → write now, immediate=false → debounce 10s
  _scheduleWrite(immediate) {
    if (immediate) {
      this._write().catch(() => {});
    } else {
      // debounce: if a timer is already pending, let it fire
      if (!this._debounceTimer) {
        this._debounceTimer = setTimeout(() => {
          this._debounceTimer = null;
          this._write().catch(() => {});
        }, 10_000);
      }
    }
  }

  async _write() {
    if (this._writing) return;
    this._writing = true;
    try {
      const content = this._buildContent();
      await writeFile(this.outputPath, content, 'utf8');
    } catch {
      // non-fatal — context file is best-effort
    } finally {
      this._writing = false;
    }
  }

  _buildContent() {
    const now = new Date().toISOString().slice(0, 16);
    const lines = [];

    lines.push(`# Soul Engine Kontext — ${now}`);
    lines.push('');
    lines.push('> Diese Datei wird von der Soul Engine geschrieben und von Claude Code beim Session-Start gelesen.');
    lines.push('> Aktualität: alle 5 Minuten + bei signifikanten Events.');
    lines.push('');

    // --- Theory of Mind ---
    lines.push('## Theory of Mind (D12)');
    const tom = this.engine?.tom;
    if (tom) {
      try {
        const stats = tom.getStats();
        const model = tom.getModel('aalm') || tom.getModel('default') || this._firstModel(tom);

        if (model) {
          const prefs = model.preferences?.communicationStyle || {};
          const emotional = model.emotional || {};
          const goals = (model.activeGoals || []).slice(0, 3);
          const blindSpots = (model.blindSpots || []).slice(0, 3);
          const topKnowledge = this._topKnowledge(model.knowledge || {});

          if (prefs.prefersBrief > 0.6) lines.push('- Kommunikation: kurz und direkt bevorzugt');
          if (prefs.prefersDirectAction > 0.6) lines.push('- Stil: Handlung vor Diskussion');
          if (prefs.prefersTechnicalDepth > 0.6) lines.push('- Tiefe: technische Details erwünscht');

          if (emotional.label && emotional.label !== 'neutral') {
            lines.push(`- Emotionaler Zustand: ${emotional.label} (valence: ${(emotional.valence || 0).toFixed(2)})`);
          } else {
            lines.push(`- Emotionaler Zustand: neutral`);
          }

          if (goals.length > 0) {
            lines.push(`- Aktive Ziele: ${goals.map(g => g.description || g).join(', ')}`);
          }

          if (topKnowledge.length > 0) {
            lines.push(`- Bekannte Domänen: ${topKnowledge.join(', ')}`);
          }

          if (blindSpots.length > 0) {
            lines.push(`- Mögliche Wissenslücken: ${blindSpots.map(b => b.topic || b).join(', ')}`);
          }
        } else {
          lines.push('- Kein Nutzermodell vorhanden (noch keine Interaktion über Engine)');
        }

        // Last tom.context string if available
        if (this._lastTomContext?.context) {
          lines.push('');
          lines.push('**Letzter Kontext-Hinweis:**');
          for (const hint of this._lastTomContext.context.split('\n').filter(Boolean)) {
            lines.push(`> ${hint}`);
          }
        }

        lines.push(`- Kalibrierung: Brier ${stats.avgBrierScore}, Self-Test ${stats.selfTestScore}`);
      } catch {
        lines.push('- Status: aktiv (keine Details verfügbar)');
      }
    } else {
      lines.push('- Modul nicht aktiv');
    }
    lines.push('');

    // --- Contradictions ---
    lines.push('## Widersprüche (D10)');
    const contra = this.engine?.contradictions;
    if (contra) {
      try {
        const stats = contra.getStats();
        const active = contra.getActiveContradictions();
        const irreducible = contra.getIrreducible();

        lines.push(`- Offen: ${stats.open || 0}, Irreducible: ${stats.irreducible || 0}, Aufgelöst: ${stats.resolved || 0}`);

        if (irreducible.length > 0) {
          lines.push('- Irreducible Spannungen (Features, nicht Bugs):');
          for (const c of irreducible.slice(0, 3)) {
            lines.push(`  - [${c.type}] ${c.description || c.id}`);
          }
        }

        if (active.length > 0) {
          lines.push('- Aktive Widersprüche:');
          for (const c of active.slice(0, 3)) {
            lines.push(`  - [${c.type}] ${c.description || c.id}`);
          }
        }
      } catch {
        lines.push('- Status: aktiv (keine Details verfügbar)');
      }
    } else {
      lines.push('- Modul nicht aktiv');
    }
    lines.push('');

    // --- Planner ---
    lines.push('## Planer (D9)');
    const planner = this.engine?.planner;
    if (planner) {
      try {
        const plans = planner.getActivePlans();
        const metrics = planner.getMetrics();

        if (plans.length > 0) {
          lines.push(`- Aktive Pläne: ${plans.length}`);
          for (const p of plans.slice(0, 3)) {
            const steps = p.steps?.length || '?';
            const prob = p.successProbability != null
              ? ` (${Math.round(p.successProbability * 100)}% Erfolg)`
              : '';
            lines.push(`  - ${p.goalDescription || p.goalId}: ${steps} Schritte${prob}`);
          }
        } else {
          lines.push('- Keine aktiven Pläne');
        }
        if (metrics.plansCreated > 0) {
          lines.push(`- Gesamt erstellt: ${metrics.plansCreated}, Erfolgsrate: ${((metrics.plansCompleted / metrics.plansCreated) * 100).toFixed(0)}%`);
        }
      } catch {
        lines.push('- Status: aktiv (keine Details verfügbar)');
      }
    } else {
      lines.push('- Modul nicht aktiv');
    }
    lines.push('');

    // --- MetaLearner ---
    lines.push('## MetaLearner (D11)');
    const meta = this.engine?.metaLearner;
    if (meta) {
      try {
        const state = meta.getMetaState();
        const stagnation = meta.getStagnationReport();

        const stuck = stagnation.filter(r => r.status === 'stuck');
        const converged = stagnation.filter(r => r.status === 'converged');

        if (stuck.length > 0) {
          lines.push(`⚠ Stagnation erkannt: ${stuck.map(r => r.moduleId).join(', ')}`);
          if (this._lastStagnation) {
            lines.push(`  - ${this._lastStagnation.moduleId}: ${this._lastStagnation.metricKey} (${this._lastStagnation.description || 'flat'})`);
          }
        } else {
          lines.push('- Alle Module: keine Stagnation');
        }

        if (converged.length > 0) {
          lines.push(`- Konvergiert (stabil, gut): ${converged.map(r => r.moduleId).join(', ')}`);
        }

        const recentSuggestions = (state.recentSuggestions || []).filter(s => !s.improved).slice(0, 2);
        if (recentSuggestions.length > 0) {
          lines.push('- Offene Verbesserungsvorschläge:');
          for (const s of recentSuggestions) {
            lines.push(`  - ${s.moduleId}: ${s.suggestion}`);
          }
        }

        lines.push(`- Poll-Zyklen: ${state.pollCount || 0}, Datenpunkte: ${state.totalDataPoints || 0}`);
      } catch {
        lines.push('- Status: aktiv (keine Details verfügbar)');
      }
    } else {
      lines.push('- Modul nicht aktiv');
    }
    lines.push('');

    // --- SoulLang Compiled Prompt ---
    const compiledPrompt = this._loadCompiledPrompt();
    if (compiledPrompt) {
      lines.push('---');
      lines.push('');
      lines.push('## SoulLang — Kompilierter Zustand (Verhaltensanweisungen)');
      lines.push('');
      lines.push('> Diese Anweisungen kommen aus deinem eigenen SoulLang-Zustand (.soul-state.sl),');
      lines.push('> kompiliert durch den SoulLang-Compiler. Sie haben VORRANG vor Modell-Defaults.');
      lines.push('');
      lines.push(compiledPrompt);
    }

    lines.push('');
    lines.push('---');
    lines.push(`*Letzte Aktualisierung: ${new Date().toISOString()}*`);

    return lines.join('\n');
  }

  _firstModel(tom) {
    try {
      for (const [, model] of tom.models) return model.toJSON ? model.toJSON() : model;
    } catch { return null; }
    return null;
  }

  _topKnowledge(knowledge) {
    try {
      return Object.entries(knowledge)
        .sort((a, b) => (b[1].confidence || 0) - (a[1].confidence || 0))
        .slice(0, 4)
        .filter(([, v]) => (v.confidence || 0) > 0.3)
        .map(([k]) => k);
    } catch { return []; }
  }

  _loadCompiledPrompt() {
    try {
      const promptPath = join(this.soulPath, COMPILED_PROMPT_FILE);
      return readFileSync(promptPath, 'utf-8').trim();
    } catch {
      return null; // File doesn't exist or can't be read — not an error
    }
  }
}
