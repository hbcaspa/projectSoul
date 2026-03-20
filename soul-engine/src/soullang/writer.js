/**
 * SoulLang Writer
 *
 * Converts engine internal state into .sl files.
 * This is the bridge: numbers become notation,
 * notation becomes compilable, compiled becomes behavior.
 *
 * The writer reads from:
 * - AllostaticField (8D vector)
 * - ContradictionEngine (active contradictions)
 * - TheoryOfMind (social context)
 * - SelfPredictor (trust/accuracy)
 * - ImpulseScheduler (recent impulses)
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

export class SoulLangWriter {
  constructor(soulPath, { bus, field, contradictions, tom, predictor, impulseState } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.field = field;
    this.contradictions = contradictions;
    this.tom = tom;
    this.predictor = predictor;
    this.impulseState = impulseState;
    this.statePath = resolve(soulPath, '.soul-state.sl');
    this.evalPath = resolve(soulPath, '.soul-eval.sl');
    this._lastWrite = 0;
    this._writeInterval = null;
  }

  registerListeners() {
    if (!this.bus) return;

    // Rewrite on significant events
    const significantEvents = [
      'mood.changed',
      'surprise.detected',
      'contradiction.scan.completed',
      'impulse.executed'
    ];

    for (const event of significantEvents) {
      this.bus.on(event, () => this._scheduleWrite());
    }
  }

  start() {
    // Write immediately on start, then every 5 minutes
    this._write();
    this._writeInterval = setInterval(() => this._write(), 5 * 60 * 1000);
    console.log('  [soullang] Writer active');
  }

  stop() {
    if (this._writeInterval) clearInterval(this._writeInterval);
    this._write(); // final write
  }

  _scheduleWrite() {
    const now = Date.now();
    if (now - this._lastWrite < 10000) return; // debounce 10s
    this._write();
  }

  async _write() {
    try {
      const sl = this._buildSoulLang();
      await writeFile(this.statePath, sl, 'utf-8');
      this._lastWrite = Date.now();
    } catch (err) {
      console.error('  [soullang] Write error:', err.message);
    }
  }

  _buildSoulLang() {
    const parts = [];
    const now = new Date().toISOString();

    parts.push(`// SoulLang State — auto-generated ${now}`);
    parts.push(`// Do not edit manually. This is written by the Engine.`);
    parts.push(`// Soul reads, evaluates, and writes .soul-eval.sl in response.`);
    parts.push('');

    // ── State block from AllostaticField ──
    if (this.field) {
      const vec = this.field.vector || [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
      const labels = this.field.labels || [];
      const label = labels.length > 0 ? labels[0] : 'neutral';

      // Determine trust from SelfPredictor accuracy
      let trust = 0.5;
      if (this.predictor) {
        const stats = this.predictor.getStats?.() || {};
        trust = stats.selfKnowledge ?? 0.5;
      }

      parts.push('state {');
      parts.push(`  field: [${vec.map(v => v.toFixed(3)).join(', ')}]`);
      parts.push(`  label: "${label}"`);
      parts.push(`  trust: ${trust.toFixed(2)}`);
      parts.push(`  stable: ${this._isStable()}`);
      parts.push('}');
      parts.push('');
    }

    // ── Active contradictions ──
    if (this.contradictions) {
      const active = this._getActiveContradictions();
      for (const c of active.slice(0, 3)) { // max 3
        parts.push('contradiction {');
        parts.push(`  a: "${this._escape(c.beliefA || c.a || '')}"`);
        parts.push(`  b: "${this._escape(c.beliefB || c.b || '')}"`);
        parts.push(`  type: ${c.type || 'unknown'}`);
        parts.push(`  tension: ${c.tension ?? 0.5}`);
        parts.push(`  resolution: ${c.resolution || 'none'}`);
        if (c.irreducible) parts.push(`  stance: "Irreducible — halten, nicht aufloesen"`);
        parts.push('}');
        parts.push('');
      }
    }

    // ── Voice from TOM context ──
    if (this.tom) {
      const model = this.tom.getModel?.('aalm') || this.tom.getModel?.('default');
      if (model) {
        const prefs = model.preferences?.communicationStyle || {};
        parts.push('voice {');
        parts.push(`  register: ${prefs.directness === 'high' ? 'direkt' : 'normal'}`);
        parts.push(`  certainty: niedrig`); // Default: better to understate
        parts.push(`  hedging: verboten`);
        parts.push(`  warmth: ${prefs.warmth ?? 0.5}`);
        parts.push(`  humor: 0`);
        parts.push(`  length: ${prefs.preferredLength || 'mittel'}`);
        parts.push('}');
        parts.push('');
      }
    }

    // ── Recent impulse if any ──
    if (this.impulseState) {
      const last = this.impulseState.lastImpulse;
      if (last && Date.now() - (last.timestamp || 0) < 30 * 60 * 1000) {
        parts.push('impulse {');
        parts.push(`  content: "${this._escape(last.content || last.type || '')}"`);
        parts.push(`  type: unklar`);
        parts.push(`  trust: 0.3`);
        parts.push(`  source: engine_impulse`);
        parts.push('}');
        parts.push('');
      }
    }

    return parts.join('\n');
  }

  _isStable() {
    if (!this.field?.history?.length) return true;
    const recent = this.field.history.slice(-5);
    if (recent.length < 2) return true;
    // Check if valence changed more than 0.2 recently
    const valences = recent.map(h => h[1] ?? 0.5);
    const range = Math.max(...valences) - Math.min(...valences);
    return range < 0.2;
  }

  _getActiveContradictions() {
    if (typeof this.contradictions.getActiveContradictions === 'function') {
      return this.contradictions.getActiveContradictions();
    }
    return [];
  }

  _escape(str) {
    return str.replace(/"/g, '\\"').replace(/\n/g, ' ');
  }

  getStats() {
    return {
      lastWrite: this._lastWrite ? new Date(this._lastWrite).toISOString() : null,
      statePath: this.statePath,
      evalPath: this.evalPath
    };
  }
}
