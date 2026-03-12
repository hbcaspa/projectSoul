// d6-temporal-intelligence.js
// AGI Arena D6: Temporal Intelligence Module
//
// Real temporal understanding: not just timestamps, but learned duration models,
// time pressure detection, sequencing constraints, and adaptive estimation.
// The system learns how long things ACTUALLY take (not how long they should).
//
// Integration: Extends Allostatic Field's time_focus dimension with
// grounded temporal reasoning. Event Bus driven, Constructor pattern.

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// --- Constants ---

const STATE_FILE = '.soul-temporal-intelligence.json';
const TICK_INTERVAL = 60000;          // Check time pressure every 60s
const PRESSURE_WINDOW = 300000;       // 5-minute sliding window for event rate
const PRESSURE_BASELINE_WINDOW = 50;  // Last 50 windows to compute baseline rate
const BURST_THRESHOLD_SIGMA = 2.0;    // Events > mean + 2σ = burst
const MAX_DURATION_LOG = 300;         // Per event type
const MAX_ESTIMATION_LOG = 200;       // Track estimation accuracy
const MAX_SEQUENCE_LOG = 500;         // Observed event sequences
const EMA_ALPHA = 0.15;              // Exponential moving average decay
const ESTIMATION_HORIZON = 10;       // Use last N durations for estimation

// Event types we track durations for
const TRACKED_EVENTS = [
  'heartbeat.completed',
  'consolidation.completed',
  'reflection.completed',
  'prediction.evaluated',
  'message.received',
  'impulse.tick',
  'mood.changed',
  'interest.detected',
  'field.updated',
  'correction.applied',
  'memory.reconsolidated'
];

// Known process pairs: [start_event, end_event, process_name]
const PROCESS_PAIRS = [
  ['heartbeat.started',      'heartbeat.completed',      'heartbeat_execution'],
  ['consolidation.started',  'consolidation.completed',  'consolidation_execution'],
  ['reflection.started',     'reflection.completed',     'reflection_execution'],
  ['message.received',       'mood.changed',             'message_to_mood'],
  ['message.received',       'interest.detected',        'message_to_interest'],
  ['surprise.detected',      'reflection.completed',     'surprise_to_reflection'],
];

// --- Module ---

export class TemporalIntelligence {

  /**
   * @param {string} soulPath
   * @param {object} options
   * @param {object} options.bus - SoulEventBus instance
   * @param {object} [options.field] - AllostaticField instance
   */
  constructor(soulPath, { bus, field = null } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.field = field;

    // Duration models per event type: how long between consecutive occurrences
    // { [eventType]: { durations: number[], emaMean: number, emaVar: number, count: number, lastSeen: number } }
    this.intervalModels = {};

    // Process duration models: how long a process takes (start→end)
    // { [processName]: { durations: number[], emaMean: number, emaVar: number, count: number, pendingStart: number|null } }
    this.processModels = {};

    // Estimation log: tracks our time estimates vs actuals
    this.estimationLog = [];

    // Sequencing: observed event orderings
    // { [eventA→eventB]: { count, avgGap, lastSeen } }
    this.sequenceGraph = {};

    // Time pressure state
    this.pressure = {
      recentEvents: [],       // timestamps in current window
      windowRates: [],        // historical event rates per window
      currentRate: 0,         // events/sec in current window
      baselineRate: 0,        // normal events/sec
      baselineStddev: 0,      // stddev of rate
      isBurst: false,         // currently in a burst?
      burstStart: null,
      burstCount: 0,
      pressureLevel: 0        // 0-1 normalized pressure
    };

    // Last N events for sequence tracking
    this._recentEventSequence = [];
    this._tickTimer = null;
    this._estimationCounter = 0;

    // Initialize models
    for (const evt of TRACKED_EVENTS) {
      this.intervalModels[evt] = {
        durations: [],
        emaMean: null,
        emaVar: null,
        count: 0,
        lastSeen: null
      };
    }
    for (const [, , name] of PROCESS_PAIRS) {
      this.processModels[name] = {
        durations: [],
        emaMean: null,
        emaVar: null,
        count: 0,
        pendingStart: null
      };
    }
  }

  // ─────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────

  async start() {
    await this._loadState();
    this._registerListeners();

    this._tickTimer = setInterval(() => this._tick(), TICK_INTERVAL);

    const state = this.getTemporalState();
    this.bus.safeEmit('temporal.started', {
      trackedEventTypes: TRACKED_EVENTS.length,
      trackedProcesses: PROCESS_PAIRS.length,
      totalObservations: this._totalObservations(),
      estimationMAE: this._globalMAE(),
      pressureLevel: this.pressure.pressureLevel
    });

    return state;
  }

  async stop() {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
    await this._saveState();
  }

  // ─────────────────────────────────────────────
  // Core API
  // ─────────────────────────────────────────────

  /**
   * Estimate how long until the next occurrence of an event type.
   * Returns estimate with confidence interval.
   *
   * @param {string} eventType
   * @returns {{ estimatedMs, confidenceLow, confidenceHigh, confidence, basis, id } | null}
   */
  estimateNextOccurrence(eventType) {
    const model = this.intervalModels[eventType];
    if (!model || model.count < 2) return null;

    const mean = model.emaMean;
    const stddev = Math.sqrt(model.emaVar || 0);

    // Time since last occurrence
    const elapsed = model.lastSeen ? Date.now() - model.lastSeen : 0;
    const remaining = Math.max(0, mean - elapsed);

    // Confidence: inverse of coefficient of variation, capped
    const cv = stddev / (mean || 1);
    const confidence = clamp(1 - cv, 0.1, 0.95);

    const id = `te_${Date.now()}_${++this._estimationCounter}`;

    const estimation = {
      id,
      eventType,
      estimatedMs: Math.round(remaining),
      confidenceLow: Math.round(Math.max(0, remaining - 1.5 * stddev)),
      confidenceHigh: Math.round(remaining + 1.5 * stddev),
      confidence: +confidence.toFixed(3),
      basis: `${model.count} observations, EMA mean=${formatMs(mean)}, σ=${formatMs(stddev)}`,
      createdAt: Date.now(),
      resolved: false,
      actualMs: null,
      error: null
    };

    this.estimationLog.push(estimation);
    this._trimEstimationLog();

    this.bus.safeEmit('temporal.estimated', {
      id,
      eventType,
      estimatedMs: estimation.estimatedMs,
      confidence: estimation.confidence,
      basis: estimation.basis
    });

    return estimation;
  }

  /**
   * Estimate how long a process will take.
   *
   * @param {string} processName
   * @returns {{ estimatedMs, confidenceLow, confidenceHigh, confidence, basis } | null}
   */
  estimateProcessDuration(processName) {
    const model = this.processModels[processName];
    if (!model || model.count < 2) return null;

    const mean = model.emaMean;
    const stddev = Math.sqrt(model.emaVar || 0);
    const cv = stddev / (mean || 1);
    const confidence = clamp(1 - cv, 0.1, 0.95);

    // Time-of-day adjustment: processes may be slower at certain times
    const hourFactor = this._timeOfDayFactor();

    const adjusted = mean * hourFactor;

    return {
      estimatedMs: Math.round(adjusted),
      confidenceLow: Math.round(Math.max(0, adjusted - 1.5 * stddev)),
      confidenceHigh: Math.round(adjusted + 1.5 * stddev),
      confidence: +confidence.toFixed(3),
      basis: `${model.count} observations, EMA mean=${formatMs(mean)}, σ=${formatMs(stddev)}, hourFactor=${hourFactor.toFixed(2)}`
    };
  }

  /**
   * Query the learned temporal ordering between two event types.
   *
   * @param {string} eventA
   * @param {string} eventB
   * @returns {{ ordering, avgGapMs, count, confidence } | null}
   */
  querySequence(eventA, eventB) {
    const keyAB = `${eventA}→${eventB}`;
    const keyBA = `${eventB}→${eventA}`;
    const ab = this.sequenceGraph[keyAB];
    const ba = this.sequenceGraph[keyBA];

    if (!ab && !ba) return null;

    const countAB = ab?.count || 0;
    const countBA = ba?.count || 0;
    const total = countAB + countBA;

    if (total < 2) return null;

    // Which ordering is more common?
    const ordering = countAB >= countBA ? 'A_before_B' : 'B_before_A';
    const dominant = countAB >= countBA ? ab : ba;
    const confidence = +(Math.max(countAB, countBA) / total).toFixed(3);

    return {
      ordering,
      avgGapMs: Math.round(dominant.avgGap),
      count: total,
      confidence,
      description: ordering === 'A_before_B'
        ? `${eventA} typically precedes ${eventB} by ${formatMs(dominant.avgGap)} (${(confidence * 100).toFixed(0)}% of the time)`
        : `${eventB} typically precedes ${eventA} by ${formatMs(dominant.avgGap)} (${(confidence * 100).toFixed(0)}% of the time)`
    };
  }

  /**
   * Get current time pressure state.
   */
  getTimePressure() {
    return {
      pressureLevel: +this.pressure.pressureLevel.toFixed(3),
      currentRate: +this.pressure.currentRate.toFixed(3),
      baselineRate: +this.pressure.baselineRate.toFixed(3),
      isBurst: this.pressure.isBurst,
      burstDurationMs: this.pressure.isBurst && this.pressure.burstStart
        ? Date.now() - this.pressure.burstStart : 0,
      sigma: this.pressure.baselineStddev > 0
        ? +((this.pressure.currentRate - this.pressure.baselineRate) / this.pressure.baselineStddev).toFixed(2)
        : 0
    };
  }

  // ─────────────────────────────────────────────
  // Event Observation
  // ─────────────────────────────────────────────

  /**
   * Observe an event occurrence. Called by event listeners.
   */
  _observeEvent(eventName, timestamp = Date.now()) {
    // 1. Update interval model
    this._updateIntervalModel(eventName, timestamp);

    // 2. Track for time pressure
    this.pressure.recentEvents.push(timestamp);

    // 3. Track sequence
    this._updateSequence(eventName, timestamp);

    // 4. Check if this resolves any pending estimations
    this._resolveEstimations(eventName, timestamp);

    // 5. Check process pair starts/ends
    this._checkProcessPairs(eventName, timestamp);
  }

  _updateIntervalModel(eventName, timestamp) {
    const model = this.intervalModels[eventName];
    if (!model) return;

    if (model.lastSeen !== null) {
      const duration = timestamp - model.lastSeen;

      // Skip clearly anomalous gaps (> 24h likely means downtime)
      if (duration > 0 && duration < 86400000) {
        model.durations.push(duration);
        if (model.durations.length > MAX_DURATION_LOG) {
          model.durations = model.durations.slice(-MAX_DURATION_LOG);
        }

        // Update EMA
        if (model.emaMean === null) {
          model.emaMean = duration;
          model.emaVar = 0;
        } else {
          const delta = duration - model.emaMean;
          model.emaMean += EMA_ALPHA * delta;
          model.emaVar = (1 - EMA_ALPHA) * (model.emaVar + EMA_ALPHA * delta * delta);
        }

        model.count++;
      }
    }

    model.lastSeen = timestamp;
  }

  _checkProcessPairs(eventName, timestamp) {
    for (const [startEvt, endEvt, processName] of PROCESS_PAIRS) {
      const model = this.processModels[processName];
      if (!model) continue;

      if (eventName === startEvt) {
        model.pendingStart = timestamp;
      } else if (eventName === endEvt && model.pendingStart !== null) {
        const duration = timestamp - model.pendingStart;
        model.pendingStart = null;

        if (duration > 0 && duration < 3600000) { // < 1h sanity check
          model.durations.push(duration);
          if (model.durations.length > MAX_DURATION_LOG) {
            model.durations = model.durations.slice(-MAX_DURATION_LOG);
          }

          if (model.emaMean === null) {
            model.emaMean = duration;
            model.emaVar = 0;
          } else {
            const delta = duration - model.emaMean;
            model.emaMean += EMA_ALPHA * delta;
            model.emaVar = (1 - EMA_ALPHA) * (model.emaVar + EMA_ALPHA * delta * delta);
          }

          model.count++;

          this.bus.safeEmit('temporal.process.measured', {
            process: processName,
            durationMs: Math.round(duration),
            emaMean: Math.round(model.emaMean),
            count: model.count
          });
        }
      }
    }
  }

  _updateSequence(eventName, timestamp) {
    // Track ordering with last few events
    for (const prev of this._recentEventSequence) {
      if (prev.name === eventName) continue; // skip self-loops
      const gap = timestamp - prev.timestamp;
      if (gap > 300000) continue; // only track events within 5 min of each other

      const key = `${prev.name}→${eventName}`;
      if (!this.sequenceGraph[key]) {
        this.sequenceGraph[key] = { count: 0, avgGap: 0, lastSeen: null };
      }

      const seq = this.sequenceGraph[key];
      // Incremental mean update
      seq.avgGap = (seq.avgGap * seq.count + gap) / (seq.count + 1);
      seq.count++;
      seq.lastSeen = timestamp;
    }

    this._recentEventSequence.push({ name: eventName, timestamp });

    // Keep last 20 events for sequence tracking
    if (this._recentEventSequence.length > 20) {
      this._recentEventSequence = this._recentEventSequence.slice(-20);
    }

    // Trim sequence graph: remove rarely seen sequences
    const keys = Object.keys(this.sequenceGraph);
    if (keys.length > MAX_SEQUENCE_LOG) {
      const sorted = keys.sort((a, b) => this.sequenceGraph[a].count - this.sequenceGraph[b].count);
      for (const k of sorted.slice(0, keys.length - MAX_SEQUENCE_LOG)) {
        delete this.sequenceGraph[k];
      }
    }
  }

  _resolveEstimations(eventName, timestamp) {
    const pending = this.estimationLog.filter(
      e => !e.resolved && e.eventType === eventName
    );

    for (const est of pending) {
      est.resolved = true;
      est.actualMs = timestamp - est.createdAt;
      est.error = est.actualMs - est.estimatedMs;
      est.absoluteError = Math.abs(est.error);

      this.bus.safeEmit('temporal.estimation.resolved', {
        id: est.id,
        eventType: est.eventType,
        estimatedMs: est.estimatedMs,
        actualMs: est.actualMs,
        errorMs: est.error,
        absoluteErrorMs: est.absoluteError
      });
    }
  }

  // ─────────────────────────────────────────────
  // Time Pressure Detection
  // ─────────────────────────────────────────────

  _tick() {
    const now = Date.now();

    // Clean old events from pressure window
    this.pressure.recentEvents = this.pressure.recentEvents.filter(
      t => now - t < PRESSURE_WINDOW
    );

    // Current rate (events per second)
    this.pressure.currentRate = this.pressure.recentEvents.length / (PRESSURE_WINDOW / 1000);

    // Record this window's rate
    this.pressure.windowRates.push(this.pressure.currentRate);
    if (this.pressure.windowRates.length > PRESSURE_BASELINE_WINDOW) {
      this.pressure.windowRates = this.pressure.windowRates.slice(-PRESSURE_BASELINE_WINDOW);
    }

    // Compute baseline (mean + stddev of historical rates)
    if (this.pressure.windowRates.length >= 3) {
      const rates = this.pressure.windowRates;
      const mean = rates.reduce((s, r) => s + r, 0) / rates.length;
      const variance = rates.reduce((s, r) => s + (r - mean) ** 2, 0) / rates.length;
      this.pressure.baselineRate = mean;
      this.pressure.baselineStddev = Math.sqrt(variance);

      // Burst detection: current rate > baseline + 2σ
      const threshold = mean + BURST_THRESHOLD_SIGMA * this.pressure.baselineStddev;
      const wasBurst = this.pressure.isBurst;

      if (this.pressure.currentRate > threshold && this.pressure.baselineStddev > 0.001) {
        if (!this.pressure.isBurst) {
          this.pressure.isBurst = true;
          this.pressure.burstStart = now;
          this.pressure.burstCount++;

          this.bus.safeEmit('temporal.burst.started', {
            currentRate: +this.pressure.currentRate.toFixed(3),
            baselineRate: +mean.toFixed(3),
            threshold: +threshold.toFixed(3),
            sigma: +((this.pressure.currentRate - mean) / this.pressure.baselineStddev).toFixed(2)
          });
        }
      } else if (this.pressure.isBurst) {
        const burstDuration = now - this.pressure.burstStart;
        this.pressure.isBurst = false;

        this.bus.safeEmit('temporal.burst.ended', {
          durationMs: burstDuration,
          peakRate: +this.pressure.currentRate.toFixed(3)
        });

        this.pressure.burstStart = null;
      }

      // Normalized pressure level [0, 1]
      if (this.pressure.baselineStddev > 0.001) {
        const sigma = (this.pressure.currentRate - mean) / this.pressure.baselineStddev;
        // Map: 0σ→0, 2σ→0.5, 4σ→1.0
        this.pressure.pressureLevel = clamp(sigma / 4, 0, 1);
      } else {
        this.pressure.pressureLevel = 0;
      }
    }

    // Nudge field based on time pressure
    this._nudgeFieldPressure();

    // Emit periodic temporal state
    this.bus.safeEmit('temporal.tick', {
      pressureLevel: +this.pressure.pressureLevel.toFixed(3),
      currentRate: +this.pressure.currentRate.toFixed(3),
      isBurst: this.pressure.isBurst,
      mae: this._globalMAE()
    });
  }

  _nudgeFieldPressure() {
    if (!this.field?.nudge) return;

    const p = this.pressure.pressureLevel;

    if (p > 0.5) {
      // High pressure → arousal up, time_focus toward present (negative = past, positive = future, 0 = present)
      this.field.nudge('arousal', (p - 0.5) * 0.15);
      this.field.nudge('vigilance', (p - 0.5) * 0.10);
      // Pull time_focus toward 0 (present) under pressure
      const currentTimeFocus = this.field.getState?.()?.dimensions?.time_focus?.value ?? 0;
      if (Math.abs(currentTimeFocus) > 0.2) {
        this.field.nudge('time_focus', -currentTimeFocus * 0.1);
      }
    } else if (p < 0.1) {
      // Very low pressure → allow temporal exploration
      this.field.nudge('arousal', -0.02);
    }
  }

  // ─────────────────────────────────────────────
  // Time-of-Day Awareness
  // ─────────────────────────────────────────────

  /**
   * Returns a factor [0.8, 1.3] reflecting time-of-day influence on process duration.
   * Night operations tend to be slower (less load but also less responsive infra).
   * Morning/afternoon are baseline.
   */
  _timeOfDayFactor() {
    const hour = new Date().getHours();
    if (hour >= 2 && hour < 6)  return 1.2;  // Deep night: slower
    if (hour >= 6 && hour < 9)  return 0.9;  // Morning: fresh, faster
    if (hour >= 9 && hour < 12) return 1.0;  // Baseline
    if (hour >= 12 && hour < 14) return 1.05; // Post-lunch: slightly slower
    if (hour >= 14 && hour < 18) return 1.0;  // Afternoon: baseline
    if (hour >= 18 && hour < 22) return 1.1;  // Evening: slightly slower
    return 1.15; // Late night
  }

  // ─────────────────────────────────────────────
  // Event Listeners
  // ─────────────────────────────────────────────

  _registerListeners() {
    // Listen to all tracked events
    for (const evt of TRACKED_EVENTS) {
      this.bus.on(evt, () => this._observeEvent(evt));
    }

    // Also listen to process pair start events not in TRACKED_EVENTS
    const startEvents = PROCESS_PAIRS.map(p => p[0]).filter(e => !TRACKED_EVENTS.includes(e));
    for (const evt of new Set(startEvents)) {
      this.bus.on(evt, () => this._observeEvent(evt));
    }

    // Surprise events are temporally interesting
    this.bus.on('surprise.detected', () => this._observeEvent('surprise.detected'));

    // Field updates: track timing
    this.bus.on('field.updated', (data) => {
      // Already tracked via TRACKED_EVENTS, but also check for rapid field changes
      if (data?.modulations) {
        const changes = Object.values(data.modulations).filter(
          m => m && typeof m.delta === 'number' && Math.abs(m.delta) > 0.1
        );
        if (changes.length >= 3) {
          // Many field dimensions changing at once — temporal turbulence
          this.bus.safeEmit('temporal.turbulence', {
            changingDimensions: changes.length,
            pressureLevel: this.pressure.pressureLevel
          });
        }
      }
    });
  }

  // ─────────────────────────────────────────────
  // Metrics & Introspection
  // ─────────────────────────────────────────────

  /**
   * Global Mean Absolute Error of time estimations.
   */
  _globalMAE() {
    const resolved = this.estimationLog.filter(e => e.resolved);
    if (resolved.length === 0) return null;
    return Math.round(
      resolved.reduce((s, e) => s + e.absoluteError, 0) / resolved.length
    );
  }

  /**
   * Per-event-type MAE.
   */
  _perEventMAE() {
    const result = {};
    for (const evt of TRACKED_EVENTS) {
      const resolved = this.estimationLog.filter(
        e => e.resolved && e.eventType === evt
      );
      if (resolved.length >= 2) {
        result[evt] = Math.round(
          resolved.reduce((s, e) => s + e.absoluteError, 0) / resolved.length
        );
      }
    }
    return result;
  }

  _totalObservations() {
    let total = 0;
    for (const model of Object.values(this.intervalModels)) total += model.count;
    for (const model of Object.values(this.processModels)) total += model.count;
    return total;
  }

  /**
   * Full temporal state snapshot.
   */
  getTemporalState() {
    const resolved = this.estimationLog.filter(e => e.resolved);

    return {
      intervalModels: this._summarizeIntervalModels(),
      processModels: this._summarizeProcessModels(),
      timePressure: this.getTimePressure(),
      estimation: {
        totalEstimations: this.estimationLog.length,
        resolvedEstimations: resolved.length,
        globalMAE: this._globalMAE(),
        perEventMAE: this._perEventMAE(),
        globalMAEFormatted: this._globalMAE() !== null ? formatMs(this._globalMAE()) : null
      },
      sequencing: this._summarizeSequences(),
      totalObservations: this._totalObservations()
    };
  }

  _summarizeIntervalModels() {
    const summary = {};
    for (const [evt, model] of Object.entries(this.intervalModels)) {
      if (model.count < 2) continue;
      const stddev = Math.sqrt(model.emaVar || 0);
      summary[evt] = {
        count: model.count,
        emaMean: Math.round(model.emaMean),
        emaMeanFormatted: formatMs(model.emaMean),
        stddev: Math.round(stddev),
        stddevFormatted: formatMs(stddev),
        cv: model.emaMean > 0 ? +(stddev / model.emaMean).toFixed(3) : null,
        lastSeen: model.lastSeen,
        lastSeenAgo: model.lastSeen ? formatMs(Date.now() - model.lastSeen) : null
      };
    }
    return summary;
  }

  _summarizeProcessModels() {
    const summary = {};
    for (const [name, model] of Object.entries(this.processModels)) {
      if (model.count < 1) continue;
      const stddev = Math.sqrt(model.emaVar || 0);
      summary[name] = {
        count: model.count,
        emaMean: Math.round(model.emaMean),
        emaMeanFormatted: formatMs(model.emaMean),
        stddev: Math.round(stddev),
        cv: model.emaMean > 0 ? +(stddev / model.emaMean).toFixed(3) : null
      };
    }
    return summary;
  }

  _summarizeSequences() {
    const entries = Object.entries(this.sequenceGraph)
      .filter(([, v]) => v.count >= 3)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 30);

    return entries.map(([key, val]) => ({
      sequence: key,
      count: val.count,
      avgGap: Math.round(val.avgGap),
      avgGapFormatted: formatMs(val.avgGap)
    }));
  }

  /**
   * Get the most reliable sequencing constraints (high-confidence orderings).
   */
  getSequencingConstraints() {
    const constraints = [];

    // Find event pairs where ordering is highly consistent
    const pairsSeen = new Set();
    for (const key of Object.keys(this.sequenceGraph)) {
      const [a, b] = key.split('→');
      const pairKey = [a, b].sort().join('|');
      if (pairsSeen.has(pairKey)) continue;
      pairsSeen.add(pairKey);

      const result = this.querySequence(a, b);
      if (result && result.confidence > 0.8 && result.count >= 5) {
        constraints.push(result);
      }
    }

    return constraints.sort((a, b) => b.confidence - a.confidence);
  }

  // ─────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────

  async _loadState() {
    try {
      const raw = await readFile(join(this.soulPath, STATE_FILE), 'utf-8');
      const data = JSON.parse(raw);

      if (data.intervalModels) {
        for (const [evt, saved] of Object.entries(data.intervalModels)) {
          if (this.intervalModels[evt]) {
            Object.assign(this.intervalModels[evt], saved);
          }
        }
      }
      if (data.processModels) {
        for (const [name, saved] of Object.entries(data.processModels)) {
          if (this.processModels[name]) {
            Object.assign(this.processModels[name], saved);
            // Don't restore pendingStart — it's stale
            this.processModels[name].pendingStart = null;
          }
        }
      }
      if (data.estimationLog) this.estimationLog = data.estimationLog;
      if (data.sequenceGraph) this.sequenceGraph = data.sequenceGraph;
      if (data.pressure?.windowRates) this.pressure.windowRates = data.pressure.windowRates;
      if (data.estimationCounter) this._estimationCounter = data.estimationCounter;
    } catch {
      // Fresh start
    }
  }

  async _saveState() {
    try {
      // Strip pendingStart from process models (stale across restarts)
      const processModels = {};
      for (const [name, model] of Object.entries(this.processModels)) {
        processModels[name] = { ...model, pendingStart: null };
      }

      await writeFile(
        join(this.soulPath, STATE_FILE),
        JSON.stringify({
          version: 1,
          savedAt: new Date().toISOString(),
          estimationCounter: this._estimationCounter,
          intervalModels: this.intervalModels,
          processModels,
          estimationLog: this.estimationLog.slice(-MAX_ESTIMATION_LOG),
          sequenceGraph: this.sequenceGraph,
          pressure: { windowRates: this.pressure.windowRates }
        }, null, 2),
        'utf-8'
      );
    } catch (err) {
      this.bus.safeEmit('temporal.error', { phase: 'save', error: err.message });
    }
  }

  _trimEstimationLog() {
    if (this.estimationLog.length > MAX_ESTIMATION_LOG) {
      this.estimationLog = this.estimationLog.slice(-MAX_ESTIMATION_LOG);
    }
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function formatMs(ms) {
  if (ms === null || ms === undefined) return '?';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}
