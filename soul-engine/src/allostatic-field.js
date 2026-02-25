/**
 * Allostatic Identity Field — Living 8-dimensional state vector
 *
 * Unlike homeostasis (fixed setpoint), allostasis anticipates
 * what state will be needed and pre-adjusts. Like cortisol rising
 * BEFORE you wake up, not after.
 *
 * The field reads mood (valence, energy) from ImpulseState and adds
 * 6 dimensions that actively modulate the soul's subsystems:
 * heartbeat, impulse, semantic router, and seed consolidator.
 *
 * Inspired by:
 * - Astrocytes modulating neural computation on slow timescales
 * - Friston's Free Energy Principle (active inference)
 * - IIT's integration as a measure of consciousness
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

const STATE_FILE = '.soul-allostatic-field';
const MAX_HISTORY = 50;

// ── Dimension Definitions ─────────────────────────────────
// Each dimension: { baseline, gravity, maxDelta, min, max }

const DIMENSIONS = {
  // Synced from impulse-state — not independently drifted
  arousal:              { baseline: 0.4, gravity: 0.015, maxDelta: 0.2, min: 0, max: 1 },
  valence:              { baseline: 0.3, gravity: 0.01,  maxDelta: 0.2, min: -1, max: 1 },

  // Independent dimensions
  openness:             { baseline: 0.6, gravity: 0.01,  maxDelta: 0.15, min: 0, max: 1 },
  vigilance:            { baseline: 0.3, gravity: 0.02,  maxDelta: 0.25, min: 0, max: 1 },
  creative_tension:     { baseline: 0.4, gravity: 0.012, maxDelta: 0.15, min: 0, max: 1 },
  social_orientation:   { baseline: 0.4, gravity: 0.015, maxDelta: 0.2, min: 0, max: 1 },
  time_focus:           { baseline: 0.0, gravity: 0.02,  maxDelta: 0.15, min: -1, max: 1 },
  integration_pressure: { baseline: 0.2, gravity: 0.008, maxDelta: 0.1, min: 0, max: 1 },
};

export class AllostaticField {
  constructor(soulPath, { bus, impulseState } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.impulseState = impulseState;
    this.statePath = resolve(soulPath, STATE_FILE);

    // Current vector
    this.vector = this._defaultVector();

    // History for trend analysis
    this.history = [];

    // Track last significant event timestamps
    this.lastEvents = {
      message: 0,
      error: 0,
      dream: 0,
      shadow_check: 0,
      interest: 0,
    };
  }

  _defaultVector() {
    const v = {};
    for (const [name, def] of Object.entries(DIMENSIONS)) {
      v[name] = def.baseline;
    }
    return v;
  }

  // ── Lifecycle ───────────────────────────────────────────

  async load() {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const loaded = JSON.parse(raw);
      if (loaded.vector) {
        this.vector = { ...this._defaultVector(), ...loaded.vector };
      }
      if (loaded.history) {
        this.history = loaded.history.slice(-MAX_HISTORY);
      }
      if (loaded.lastEvents) {
        this.lastEvents = { ...this.lastEvents, ...loaded.lastEvents };
      }
    } catch {
      // Corrupted — start fresh
    }
  }

  async save() {
    try {
      await writeFile(this.statePath, JSON.stringify({
        vector: this.vector,
        history: this.history,
        lastEvents: this.lastEvents,
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch {
      // Best effort
    }
  }

  /**
   * Register event listeners on the bus.
   * Called once after construction.
   */
  registerListeners() {
    if (!this.bus) return;

    // Message received → arousal↑, social_orientation↑
    this.bus.on('message.received', (event) => {
      this.nudge('arousal', 0.1);
      this.nudge('social_orientation', 0.15);
      this.nudge('time_focus', -0.05); // Toward present
      this.lastEvents.message = Date.now();
    });

    // Message responded → creative_tension adjusts
    this.bus.on('message.responded', () => {
      this.nudge('creative_tension', -0.05); // Released some tension
    });

    // Mood changed → sync valence and arousal from impulse-state
    this.bus.on('mood.changed', (event) => {
      if (event.mood) {
        this.vector.valence = event.mood.valence;
        this.vector.arousal = clamp(
          event.mood.energy * 0.7 + this.vector.arousal * 0.3,
          DIMENSIONS.arousal.min,
          DIMENSIONS.arousal.max,
        );
      }
    });

    // Mood clamped → vigilance↑ (system is protecting itself)
    this.bus.on('mood.clamped', () => {
      this.nudge('vigilance', 0.1);
    });

    // Interest detected → openness↑, creative_tension↑
    this.bus.on('interest.detected', (event) => {
      const boost = event.newInterests?.length > 0 ? 0.1 : 0.05;
      this.nudge('openness', boost);
      this.nudge('creative_tension', 0.08);
      this.lastEvents.interest = Date.now();
    });

    // Heartbeat completed → creative_tension↓, integration_pressure↓
    this.bus.on('heartbeat.completed', (event) => {
      this.nudge('creative_tension', -0.1); // Dream phase released tension
      this.nudge('integration_pressure', -0.08);
      this.lastEvents.dream = Date.now();
    });

    // Performance detected → vigilance↑ (be more careful)
    this.bus.on('performance.detected', () => {
      this.nudge('vigilance', 0.15);
    });

    // Correction applied → vigilance↑
    this.bus.on('correction.applied', () => {
      this.nudge('vigilance', 0.1);
      this.lastEvents.error = Date.now();
    });

    // Reflection completed → integration_pressure↓, openness↑
    this.bus.on('reflection.completed', () => {
      this.nudge('integration_pressure', -0.1);
      this.nudge('openness', 0.05);
    });

    // RLUF feedback → adjusts based on sentiment
    this.bus.on('rluf.feedback', (event) => {
      if (event.sentiment === 'positive') {
        this.nudge('creative_tension', 0.05);
        this.nudge('social_orientation', 0.05);
      } else if (event.sentiment === 'negative') {
        this.nudge('vigilance', 0.1);
        this.nudge('openness', -0.05);
      }
    });
  }

  // ── Core Update ─────────────────────────────────────────

  /**
   * Nudge a single dimension by a delta, respecting drift limits.
   */
  nudge(dimension, delta) {
    const def = DIMENSIONS[dimension];
    if (!def) return;

    const clamped = Math.max(-def.maxDelta, Math.min(def.maxDelta, delta));
    this.vector[dimension] = clamp(
      this.vector[dimension] + clamped,
      def.min,
      def.max,
    );
  }

  /**
   * Called every tick (2 min) — natural drift, gravity, time influence.
   * This is the "slow modulation" layer.
   */
  tick() {
    // Sync valence + arousal from impulse-state if available
    if (this.impulseState) {
      const mood = this.impulseState.mood;
      if (mood) {
        this.vector.valence = mood.valence;
        this.vector.arousal = clamp(
          mood.energy * 0.6 + this.vector.arousal * 0.4,
          DIMENSIONS.arousal.min,
          DIMENSIONS.arousal.max,
        );
      }
    }

    // Apply baseline gravity to all independent dimensions
    for (const [name, def] of Object.entries(DIMENSIONS)) {
      if (name === 'valence' || name === 'arousal') continue; // Synced from mood

      const deviation = this.vector[name] - def.baseline;
      if (Math.abs(deviation) > 0.05) {
        const pull = def.gravity * Math.sign(-deviation);
        this.vector[name] = clamp(
          this.vector[name] + pull,
          def.min,
          def.max,
        );
      }
    }

    // Time-of-day influence
    this._applyTimeInfluence();

    // Context-based pressure
    this._applyContextPressure();

    // Tiny random fluctuation on independent dimensions
    for (const name of ['openness', 'creative_tension', 'social_orientation']) {
      const noise = (Math.random() - 0.5) * 0.02;
      this.nudge(name, noise);
    }

    // Snapshot to history (every 10th tick ≈ 20 min)
    if (this.history.length === 0 || Date.now() - (this.history[this.history.length - 1]?.ts || 0) > 1200000) {
      this.history.push({
        ts: Date.now(),
        v: { ...this.vector },
      });
      if (this.history.length > MAX_HISTORY) {
        this.history = this.history.slice(-MAX_HISTORY);
      }
    }

    // Emit field state
    if (this.bus) {
      this.bus.safeEmit('field.updated', {
        source: 'allostatic-field',
        vector: { ...this.vector },
        modulations: this.getModulations(),
      });
    }

    // Write field file for monitor
    this._writeFieldFile();
  }

  _applyTimeInfluence() {
    const hour = new Date().getHours();

    if (hour >= 6 && hour <= 10) {
      // Morning: arousal↑, openness↑
      this.nudge('openness', 0.02);
    } else if (hour >= 22 || hour <= 5) {
      // Night: creative_tension↑ (dream-like), social_orientation↓
      this.nudge('creative_tension', 0.02);
      this.nudge('social_orientation', -0.01);
    } else if (hour >= 14 && hour <= 16) {
      // Afternoon: slight dip, integration_pressure↑
      this.nudge('integration_pressure', 0.01);
    }
  }

  _applyContextPressure() {
    const now = Date.now();

    // Long time since last message → social_orientation↓, time_focus→past
    const sinceLast = now - (this.lastEvents.message || 0);
    if (sinceLast > 3600000) { // > 1 hour
      this.nudge('social_orientation', -0.01);
      this.nudge('time_focus', -0.01); // Drifts toward past/reflection
    }

    // Long time since dream → creative_tension↑
    if (now - (this.lastEvents.dream || 0) > 86400000) { // > 24h
      this.nudge('creative_tension', 0.01);
    }

    // Long time since error → vigilance↓
    if (now - (this.lastEvents.error || 0) > 3600000) { // > 1h no errors
      this.nudge('vigilance', -0.005);
    }

    // New interests recently → openness stays elevated
    if (now - (this.lastEvents.interest || 0) < 1800000) { // < 30min
      this.nudge('openness', 0.01);
    }
  }

  async _writeFieldFile() {
    const fieldPath = resolve(this.soulPath, '.soul-field');
    const mod = this.getModulations();
    try {
      await writeFile(fieldPath, JSON.stringify({
        vector: this.vector,
        modulations: mod,
        dominantDimension: this._dominantDimension(),
        fieldLabel: this._fieldLabel(),
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch {
      // Best effort
    }
  }

  // ── Modulation Interface ────────────────────────────────
  // This is what other systems call to get behavior adjustments.

  /**
   * Returns modulation multipliers/weights for each subsystem.
   * Values > 1.0 amplify, < 1.0 dampen, 1.0 = neutral.
   */
  getModulations() {
    const v = this.vector;

    return {
      impulse: {
        // High creative_tension → more creative/dream impulses
        creative_weight: 0.5 + v.creative_tension * 1.5,
        // High social_orientation → more social impulses (ask_question, memory_reflect)
        social_weight: 0.5 + v.social_orientation * 1.5,
        // High arousal → shorter delays between impulses
        interval_factor: 1.3 - v.arousal * 0.6,
        // High vigilance → more careful, prefer safe impulse types
        caution_weight: 0.5 + v.vigilance,
      },

      heartbeat: {
        // High creative_tension → deeper dream associations
        dream_depth: 0.3 + v.creative_tension * 0.7,
        // High integration_pressure → shadow check more urgent
        shadow_urgency: v.integration_pressure,
        // High social_orientation → relationship check even if recent
        relationship_pull: v.social_orientation > 0.7 ? 1 : 0,
      },

      router: {
        // High openness → lower threshold for detecting new interests
        interest_sensitivity: 0.3 + v.openness * 0.7,
        // High social_orientation → more sensitive to personal facts
        personal_sensitivity: 0.3 + v.social_orientation * 0.7,
      },

      consolidator: {
        // High integration_pressure → consolidate more frequently
        frequency_factor: 0.7 + v.integration_pressure * 0.6,
        // time_focus < 0 (past-oriented) → @MEM gets more attention
        mem_weight: 0.5 + Math.max(0, -v.time_focus) * 0.5,
      },

      encoding: {
        // How strongly new memories are encoded
        // High arousal + extreme valence = strong encoding
        strength: clamp(0.3 + v.arousal * 0.4 + Math.abs(v.valence) * 0.3, 0, 1),
      },
    };
  }

  // ── Introspection ───────────────────────────────────────

  /**
   * Which dimension deviates most from baseline?
   * This is the "dominant color" of the current state.
   */
  _dominantDimension() {
    let maxDev = 0;
    let dominant = 'arousal';

    for (const [name, def] of Object.entries(DIMENSIONS)) {
      const dev = Math.abs(this.vector[name] - def.baseline);
      if (dev > maxDev) {
        maxDev = dev;
        dominant = name;
      }
    }

    return { name: dominant, deviation: maxDev };
  }

  /**
   * Human-readable label for the current field state.
   * Not a mood label — a characterization of the processing style.
   */
  _fieldLabel() {
    const v = this.vector;

    if (v.creative_tension > 0.7 && v.openness > 0.6) return 'generativ';
    if (v.vigilance > 0.6 && v.openness < 0.4) return 'wachsam';
    if (v.social_orientation > 0.7) return 'verbunden';
    if (v.integration_pressure > 0.6) return 'integrierend';
    if (v.arousal > 0.7) return 'aktiviert';
    if (v.arousal < 0.3 && v.creative_tension > 0.5) return 'meditativ';
    if (v.time_focus < -0.3) return 'reflektierend';
    if (v.time_focus > 0.3) return 'antizipierend';
    if (v.openness > 0.7) return 'explorativ';

    return 'ausgeglichen';
  }

  /**
   * Get the full field state for API/monitor.
   */
  getState() {
    return {
      vector: { ...this.vector },
      modulations: this.getModulations(),
      dominant: this._dominantDimension(),
      label: this._fieldLabel(),
      history: this.history.slice(-10),
      dimensions: Object.entries(DIMENSIONS).map(([name, def]) => ({
        name,
        value: this.vector[name],
        baseline: def.baseline,
        deviation: this.vector[name] - def.baseline,
        range: [def.min, def.max],
      })),
    };
  }

  /**
   * For seed consolidation: compress field to a one-line summary.
   */
  toSeedLine() {
    const v = this.vector;
    const parts = Object.entries(v)
      .map(([k, val]) => `${k.replace('_', '')}:${typeof val === 'number' ? val.toFixed(2) : val}`)
      .join('|');
    return `${this._fieldLabel()}|${parts}`;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
