/**
 * Predictive Self-Model — Layer 3 of Allostatic Identity
 *
 * Active Inference (Friston) applied to identity: the system predicts
 * its own state. High prediction error triggers surprise-driven
 * introspection. Over time, improving self-prediction IS self-knowledge.
 *
 * This is lightweight and runs without LLM calls — pure signal processing
 * on the allostatic field history. The predictions are numerical, not
 * linguistic. Language-level reflection is triggered by surprise events.
 *
 * Architecture:
 * 1. Every PREDICT_INTERVAL: predict state at PREDICT_HORIZON into the future
 * 2. When the horizon arrives: compare prediction with actual state
 * 3. Calculate prediction error (mean absolute error across dimensions)
 * 4. If error > SURPRISE_THRESHOLD: emit 'surprise.detected' event
 * 5. Track accuracy over time → self-knowledge metric
 *
 * References:
 * - Friston Free Energy Principle (active inference)
 * - Global Workspace Theory (consciousness as prediction error resolution)
 * - VERSES AI Active Inference
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

const STATE_FILE = '.soul-self-predictor.json';
const PREDICT_INTERVAL = 7200000;   // Make a prediction every 2 hours
const PREDICT_HORIZON = 7200000;    // Predict 2 hours ahead
const SURPRISE_THRESHOLD = 0.25;    // Average dimension error to trigger surprise
const HIGH_SURPRISE_THRESHOLD = 0.4; // Triggers deep introspection
const MAX_ACCURACY_LOG = 200;       // Keep last 200 prediction results
const SAVE_INTERVAL = 600000;       // 10 minutes

// Dimensions to predict (all 8 from allostatic field)
const PREDICTED_DIMENSIONS = [
  'arousal', 'valence', 'openness', 'vigilance',
  'creative_tension', 'social_orientation', 'time_focus', 'integration_pressure',
];

export class SelfPredictor {
  constructor(soulPath, { bus, field } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.field = field;
    this.statePath = resolve(soulPath, STATE_FILE);

    // Current pending prediction (null if none)
    this.pendingPrediction = null;

    // Accuracy log: array of { ts, predicted, actual, error, surprised }
    this.accuracyLog = [];

    // Running accuracy metric (exponential moving average)
    this.selfKnowledge = 0.5; // 0 = no self-knowledge, 1 = perfect

    this._predictTimer = null;
    this._saveTimer = null;
  }

  // ── Lifecycle ───────────────────────────────────────────

  async load() {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const loaded = JSON.parse(raw);
      if (loaded.pendingPrediction) this.pendingPrediction = loaded.pendingPrediction;
      if (loaded.accuracyLog) this.accuracyLog = loaded.accuracyLog.slice(-MAX_ACCURACY_LOG);
      if (typeof loaded.selfKnowledge === 'number') this.selfKnowledge = loaded.selfKnowledge;
    } catch {
      // Corrupted — start fresh
    }
  }

  async save() {
    try {
      await writeFile(this.statePath, JSON.stringify({
        pendingPrediction: this.pendingPrediction,
        accuracyLog: this.accuracyLog.slice(-MAX_ACCURACY_LOG),
        selfKnowledge: this.selfKnowledge,
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch {
      // Best effort
    }
  }

  start() {
    if (!this.field) {
      console.log('  [self-predictor] No field available — disabled');
      return;
    }

    // Check if there's a pending prediction that matured
    if (this.pendingPrediction) {
      const elapsed = Date.now() - this.pendingPrediction.madeAt;
      if (elapsed >= PREDICT_HORIZON * 0.9) {
        // Prediction has matured — evaluate it
        this._evaluatePrediction();
      }
    }

    // Start prediction cycle
    this._predictTimer = setInterval(() => this._cycle(), PREDICT_INTERVAL);
    this._saveTimer = setInterval(() => this.save(), SAVE_INTERVAL);

    // Make first prediction after a short delay (let field stabilize)
    setTimeout(() => this._cycle(), 30000);
  }

  stop() {
    if (this._predictTimer) clearInterval(this._predictTimer);
    if (this._saveTimer) clearInterval(this._saveTimer);
    return this.save();
  }

  registerListeners() {
    if (!this.bus) return;

    // Surprise events trigger field nudges
    this.bus.on('surprise.detected', (event) => {
      if (this.field && event.source === 'self-predictor') {
        // Surprise increases integration pressure (need to make sense of this)
        this.field.nudge('integration_pressure', 0.1);
        // And increases vigilance (something unexpected happened)
        this.field.nudge('vigilance', 0.08);
      }
    });
  }

  // ── Prediction Cycle ──────────────────────────────────────

  /**
   * One full prediction cycle: evaluate old prediction (if any), make new one.
   */
  _cycle() {
    // 1. Evaluate pending prediction if it has matured
    if (this.pendingPrediction) {
      const elapsed = Date.now() - this.pendingPrediction.madeAt;
      if (elapsed >= PREDICT_HORIZON * 0.9) {
        this._evaluatePrediction();
      }
    }

    // 2. Make a new prediction
    this._makePrediction();
  }

  /**
   * Predict the field state PREDICT_HORIZON milliseconds from now.
   *
   * Method: Linear extrapolation from field history.
   * For each dimension:
   *   1. Take the last N snapshots from field history
   *   2. Calculate the trend (linear regression slope)
   *   3. Extrapolate: current_value + slope * horizon_ticks
   *   4. Apply gravity pull toward baseline (the field naturally drifts back)
   *
   * This is deliberately simple. The point is not to be accurate —
   * it's to notice when we're WRONG, because that's where self-knowledge grows.
   */
  _makePrediction() {
    if (!this.field) return;

    const now = Date.now();
    const currentVector = { ...this.field.vector };
    const history = this.field.history || [];

    const predicted = {};

    for (const dim of PREDICTED_DIMENSIONS) {
      const current = currentVector[dim];

      // Get recent history for this dimension
      const recent = history
        .filter(h => h.v && typeof h.v[dim] === 'number')
        .slice(-10);

      if (recent.length < 2) {
        // Not enough history — predict baseline regression
        predicted[dim] = this._predictWithGravity(dim, current);
        continue;
      }

      // Calculate trend via simple linear regression on recent snapshots
      const slope = this._calculateSlope(recent.map(h => h.v[dim]));

      // Extrapolate: how many 2-minute ticks in the horizon?
      const ticksAhead = PREDICT_HORIZON / 120000;
      const extrapolated = current + slope * ticksAhead;

      // Blend with gravity pull (the field tends toward baseline)
      const gravityPull = this._predictWithGravity(dim, current);
      const blended = extrapolated * 0.6 + gravityPull * 0.4;

      // Clamp to dimension bounds
      predicted[dim] = this._clampDimension(dim, blended);
    }

    this.pendingPrediction = {
      madeAt: now,
      maturesAt: now + PREDICT_HORIZON,
      predicted,
      currentAtPrediction: currentVector,
    };
  }

  /**
   * Evaluate a matured prediction against actual state.
   */
  _evaluatePrediction() {
    if (!this.pendingPrediction || !this.field) return;

    const actual = { ...this.field.vector };
    const { predicted, madeAt } = this.pendingPrediction;

    // Calculate per-dimension error
    const errors = {};
    let totalError = 0;
    let maxErrorDim = null;
    let maxError = 0;

    for (const dim of PREDICTED_DIMENSIONS) {
      const p = predicted[dim] ?? 0;
      const a = actual[dim] ?? 0;
      const err = Math.abs(p - a);
      errors[dim] = err;
      totalError += err;

      if (err > maxError) {
        maxError = err;
        maxErrorDim = dim;
      }
    }

    const avgError = totalError / PREDICTED_DIMENSIONS.length;
    const accuracy = 1 - Math.min(avgError, 1);
    const surprised = avgError > SURPRISE_THRESHOLD;
    const deepSurprise = avgError > HIGH_SURPRISE_THRESHOLD;

    // Update self-knowledge metric (exponential moving average)
    const alpha = 0.1; // Learning rate
    this.selfKnowledge = this.selfKnowledge * (1 - alpha) + accuracy * alpha;

    // Log the result
    const result = {
      ts: Date.now(),
      predictedAt: madeAt,
      predicted,
      actual,
      errors,
      avgError,
      maxErrorDim,
      maxError,
      accuracy,
      surprised,
      selfKnowledge: this.selfKnowledge,
    };

    this.accuracyLog.push(result);
    if (this.accuracyLog.length > MAX_ACCURACY_LOG) {
      this.accuracyLog = this.accuracyLog.slice(-MAX_ACCURACY_LOG);
    }

    // Clear pending prediction
    this.pendingPrediction = null;

    // Emit events
    if (this.bus) {
      this.bus.safeEmit('prediction.evaluated', {
        source: 'self-predictor',
        avgError,
        accuracy,
        maxErrorDim,
        maxError,
        surprised,
        selfKnowledge: this.selfKnowledge,
      });

      if (surprised) {
        this.bus.safeEmit('surprise.detected', {
          source: 'self-predictor',
          avgError,
          maxErrorDim,
          maxError,
          deep: deepSurprise,
          message: deepSurprise
            ? `Deep surprise: ${maxErrorDim} deviated by ${maxError.toFixed(2)} — something unexpected shifted`
            : `Mild surprise: ${maxErrorDim} deviated by ${maxError.toFixed(2)}`,
        });
      }
    }

    return result;
  }

  // ── Prediction Helpers ────────────────────────────────────

  /**
   * Predict where a dimension will be if only gravity acts.
   * (The field naturally pulls dimensions toward their baseline.)
   */
  _predictWithGravity(dimName, currentValue) {
    // Dimension baselines are defined in allostatic-field.js
    // Approximate: in 2 hours (~60 ticks), gravity pulls partially back
    const baselines = {
      arousal: 0.4, valence: 0.3, openness: 0.6, vigilance: 0.3,
      creative_tension: 0.4, social_orientation: 0.4, time_focus: 0.0,
      integration_pressure: 0.2,
    };

    const baseline = baselines[dimName] ?? 0.5;
    const deviation = currentValue - baseline;

    // Approximate gravity: ~50% regression to baseline in 2 hours
    return currentValue - deviation * 0.5;
  }

  /**
   * Simple slope calculation via least squares.
   */
  _calculateSlope(values) {
    const n = values.length;
    if (n < 2) return 0;

    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumXX += i * i;
    }

    const denom = n * sumXX - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return 0;

    return (n * sumXY - sumX * sumY) / denom;
  }

  /**
   * Clamp value to dimension bounds.
   */
  _clampDimension(dimName, value) {
    const bounds = {
      arousal: [0, 1], valence: [-1, 1], openness: [0, 1], vigilance: [0, 1],
      creative_tension: [0, 1], social_orientation: [0, 1], time_focus: [-1, 1],
      integration_pressure: [0, 1],
    };
    const [min, max] = bounds[dimName] || [0, 1];
    return Math.min(max, Math.max(min, value));
  }

  // ── Query Interface ───────────────────────────────────────

  /**
   * Get the current self-knowledge metric (0-1).
   * Higher = better self-prediction = deeper self-knowledge.
   */
  getSelfKnowledge() {
    return this.selfKnowledge;
  }

  /**
   * Get the pending prediction (if any).
   */
  getPending() {
    if (!this.pendingPrediction) return null;
    return {
      ...this.pendingPrediction,
      maturesIn: Math.max(0, this.pendingPrediction.maturesAt - Date.now()),
    };
  }

  /**
   * Get recent accuracy history.
   */
  getAccuracyHistory(limit = 20) {
    return this.accuracyLog.slice(-limit);
  }

  /**
   * Get summary stats for API/monitoring.
   */
  getStats() {
    const log = this.accuracyLog;
    if (log.length === 0) {
      return {
        predictions: 0,
        selfKnowledge: this.selfKnowledge,
        hasPending: !!this.pendingPrediction,
      };
    }

    const surprises = log.filter(e => e.surprised).length;
    const avgAccuracy = log.reduce((s, e) => s + e.accuracy, 0) / log.length;
    const recent = log.slice(-10);
    const recentAccuracy = recent.reduce((s, e) => s + e.accuracy, 0) / recent.length;

    // Trend: is self-knowledge improving?
    let trend = 'stable';
    if (log.length >= 10) {
      const early = log.slice(0, Math.floor(log.length / 2));
      const late = log.slice(Math.floor(log.length / 2));
      const earlyAvg = early.reduce((s, e) => s + e.accuracy, 0) / early.length;
      const lateAvg = late.reduce((s, e) => s + e.accuracy, 0) / late.length;
      if (lateAvg - earlyAvg > 0.05) trend = 'improving';
      else if (earlyAvg - lateAvg > 0.05) trend = 'declining';
    }

    return {
      predictions: log.length,
      surprises,
      surpriseRate: surprises / log.length,
      avgAccuracy,
      recentAccuracy,
      selfKnowledge: this.selfKnowledge,
      trend,
      hasPending: !!this.pendingPrediction,
    };
  }

  /**
   * For seed consolidation: one-line summary.
   */
  toSeedLine() {
    const stats = this.getStats();
    return `selfknowledge:${this.selfKnowledge.toFixed(2)}|predictions:${stats.predictions}|surprises:${stats.surprises || 0}|trend:${stats.trend || 'new'}`;
  }
}
