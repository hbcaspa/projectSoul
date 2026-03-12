// d11-meta-learner.js
// AGI Arena D11: Meta-Learning Engine (Learning to Learn)
//
// Observes all learning modules in the Soul Engine, measures their learning
// curves, detects stagnation (converged vs stuck), suggests adaptations,
// and tracks whether its own suggestions lead to improvements.
//
// No LLM calls — pure metric analysis and signal processing.

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// --- Constants ---

const STATE_FILE = '.soul-meta-learner.json';
const POLL_INTERVAL = 300000;         // Poll metrics every 5 minutes
const SLOPE_WINDOW = 12;             // Last 12 data points for slope calculation
const STAGNATION_THRESHOLD = 0.001;  // |slope| below this = stagnation
const STUCK_MIN_POINTS = 8;          // Need at least 8 points to declare stuck
const MAX_TIMESERIES = 200;          // Max data points per metric
const MAX_SUGGESTIONS = 100;
const MAX_EVENTS = 200;

// Module definitions: what to poll, what's optimal, what's the metric direction
const MODULE_DEFS = [
  {
    id: 'selfPredictor',
    engineProp: 'predictor',
    pollFn: 'getStats',
    metrics: [
      { key: 'selfKnowledge',  optimal: 1.0, direction: 'higher', label: 'Self-Knowledge (EMA)' },
      { key: 'avgAccuracy',    optimal: 1.0, direction: 'higher', label: 'Prediction Accuracy' },
      { key: 'recentAccuracy', optimal: 1.0, direction: 'higher', label: 'Recent Accuracy (last 10)' },
      { key: 'surpriseRate',   optimal: 0.0, direction: 'lower',  label: 'Surprise Rate' },
    ],
    suggestions: {
      stuck: [
        'Increase prediction horizon to challenge the model with harder predictions',
        'Add momentum term to self-knowledge EMA to escape local optima',
        'Consider using weighted regression instead of linear extrapolation for field trends',
      ],
      crossModule: {
        causalEngine: 'Feed causal patterns into predictor as additional features for field prediction',
        temporalIntelligence: 'Use temporal duration models to improve prediction horizon calibration',
      }
    }
  },
  {
    id: 'reconsolidation',
    engineProp: 'reconsolidation',
    pollFn: 'getStats',
    metrics: [
      { key: 'avgConfidence',  optimal: 0.8, direction: 'higher', label: 'Avg Memory Confidence' },
      { key: 'fadingCount',    optimal: 0,   direction: 'lower',  label: 'Fading Memories' },
      { key: 'count',          optimal: null, direction: 'higher', label: 'Total Memories Tracked' },
    ],
    suggestions: {
      stuck: [
        'Reduce decay rate for frequently accessed memories to prevent premature fading',
        'Increase emotional encoding multiplier to strengthen important memories',
        'Add spaced-retrieval triggers to periodically re-access valuable memories',
      ],
      crossModule: {
        selfPredictor: 'Use self-prediction accuracy to weight memory reconsolidation strength',
        metacognition: 'Use epistemic confidence to gate memory encoding — high-confidence knowledge gets stronger encoding',
      }
    }
  },
  {
    id: 'metacognition',
    engineProp: 'metacognition',
    pollFn: 'getEpistemicState',
    metrics: [
      { key: 'brierScore',         optimal: 0.0,  direction: 'lower',  label: 'Brier Score' },
      { key: 'ece',                optimal: 0.0,  direction: 'lower',  label: 'Expected Calibration Error' },
      { key: 'calibrationQuality', optimal: 1.0,  direction: 'higher', label: 'Calibration Quality' },
      { key: 'selfKnowledge',      optimal: 1.0,  direction: 'higher', label: 'Epistemic Self-Knowledge' },
      { key: 'epistemicHumility',  optimal: 1.0,  direction: 'higher', label: 'Epistemic Humility' },
    ],
    suggestions: {
      stuck: [
        'Increase Platt scaling learning rate for faster adaptation',
        'Widen temperature scaling range to allow more aggressive recalibration',
        'Add domain-specific base rates from historical outcome frequencies',
      ],
      crossModule: {
        selfPredictor: 'Calibrate predictor confidence using metacognitive Brier decomposition',
        causalEngine: 'Use causal link strength as prior for confidence estimation',
      }
    }
  },
  {
    id: 'temporalIntelligence',
    engineProp: 'temporal',
    pollFn: 'getTemporalState',
    // Nested extraction — handled in _extractMetric
    metrics: [
      { key: 'estimation.globalMAE',    optimal: 0,   direction: 'lower',  label: 'Global MAE (ms)', nested: true },
      { key: 'totalObservations',       optimal: null, direction: 'higher', label: 'Total Observations' },
      { key: 'timePressure.pressureLevel', optimal: null, direction: null,  label: 'Pressure Level', nested: true },
    ],
    suggestions: {
      stuck: [
        'Increase EMA alpha for faster adaptation to changing temporal patterns',
        'Expand process pair definitions to capture more start→end relationships',
        'Weight recent observations more heavily — temporal patterns drift',
      ],
      crossModule: {
        causalEngine: 'Use causal ordering to validate temporal sequencing constraints',
        selfPredictor: 'Provide temporal rhythm data to improve field state prediction timing',
      }
    }
  },
  {
    id: 'causalEngine',
    engineProp: 'causal',
    pollFn: 'getMetrics',
    metrics: [
      { key: 'learnedPatterns',     optimal: null, direction: 'higher', label: 'Learned Causal Patterns' },
      { key: 'linkDensity',         optimal: null, direction: null,     label: 'Graph Link Density' },
      { key: 'patternsLearned',     optimal: null, direction: 'higher', label: 'Statistical Patterns' },
      { key: 'graphSize',           optimal: null, direction: null,     label: 'Causal Graph Size' },
      { key: 'avgCausalDepth',      optimal: null, direction: null,     label: 'Avg Causal Depth' },
    ],
    suggestions: {
      stuck: [
        'Lower pattern significance threshold from 0.3 to 0.2 to discover weaker causal links',
        'Increase temporal window for co-occurrence detection',
        'Add pruning of low-confidence patterns to make room for new discoveries',
      ],
      crossModule: {
        temporalIntelligence: 'Use temporal sequencing data as evidence for causal ordering',
        metacognition: 'Assign calibrated confidence to causal links for more reliable reasoning',
      }
    }
  },
  {
    id: 'rluf',
    engineProp: 'rluf',
    pollFn: 'getStats',
    metrics: [
      { key: 'avgSessionReward',    optimal: 1.0,  direction: 'higher', label: 'Avg Session Reward' },
      { key: 'totalFeedback',       optimal: null,  direction: 'higher', label: 'Total Feedback Signals' },
    ],
    suggestions: {
      stuck: [
        'Expand feedback signal sources beyond latency and sentiment keywords',
        'Add temporal discounting — recent feedback matters more than old feedback',
        'Widen impulse weight range from [0.1, 3.0] to allow more differentiation',
      ],
      crossModule: {
        metacognition: 'Use calibrated confidence to weight feedback signals — uncertain interactions get less weight',
        selfPredictor: 'Predict expected reward for upcoming interactions to enable proactive adjustment',
      }
    }
  }
];

// --- Module ---

export class MetaLearner {

  /**
   * @param {string} soulPath
   * @param {object} opts
   * @param {object} opts.bus    - SoulEventBus instance
   * @param {object} opts.engine - SoulEngine instance (access to all modules)
   */
  constructor(soulPath, { bus, engine }) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.engine = engine;

    // Time series per module per metric: { [moduleId]: { [metricKey]: { values, timestamps } } }
    this.timeSeries = {};

    // Learning curve analysis results: { [moduleId]: { [metricKey]: { slope, status, ... } } }
    this.analysis = {};

    // Suggestions history
    this.suggestions = [];

    // Self-tracking: did our suggestions lead to improvements?
    this.selfMetrics = {
      suggestionsProposed: 0,
      suggestionsFollowed: 0,  // followed = metric improved after suggestion
      suggestionSuccessRate: null,
      ownLearningCurve: [],    // track our detection accuracy over time
      stagnationsDetected: 0,
      convergedDetected: 0,
      stuckDetected: 0,
    };

    this._pollTimer = null;
    this._pollCount = 0;

    // Initialize time series structure
    for (const def of MODULE_DEFS) {
      this.timeSeries[def.id] = {};
      this.analysis[def.id] = {};
      for (const metric of def.metrics) {
        this.timeSeries[def.id][metric.key] = { values: [], timestamps: [] };
        this.analysis[def.id][metric.key] = {
          slope: null,
          status: 'insufficient_data', // insufficient_data | learning | stagnating | converged | stuck | regressing
          convergenceDistance: null,
          lastValue: null,
        };
      }
    }
  }

  // ─────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────

  async start() {
    await this._loadState();

    // Immediate first poll
    this._poll();

    // Start periodic polling
    this._pollTimer = setInterval(() => this._poll(), POLL_INTERVAL);

    this.bus.safeEmit('meta.started', {
      trackedModules: MODULE_DEFS.length,
      trackedMetrics: MODULE_DEFS.reduce((s, d) => s + d.metrics.length, 0),
      dataPoints: this._totalDataPoints(),
      suggestionsProposed: this.selfMetrics.suggestionsProposed
    });

    return this.getMetaState();
  }

  async stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    await this._saveState();
  }

  // ─────────────────────────────────────────────
  // Polling
  // ─────────────────────────────────────────────

  _poll() {
    const now = Date.now();
    this._pollCount++;

    for (const def of MODULE_DEFS) {
      const mod = this.engine?.[def.engineProp];
      if (!mod) continue; // graceful: module not loaded

      let stats;
      try {
        stats = typeof mod[def.pollFn] === 'function' ? mod[def.pollFn]() : null;
      } catch {
        continue; // graceful: method failed
      }
      if (!stats) continue;

      for (const metric of def.metrics) {
        const value = this._extractMetric(stats, metric.key);
        if (value === null || value === undefined || typeof value !== 'number' || !isFinite(value)) continue;

        const ts = this.timeSeries[def.id][metric.key];
        ts.values.push(value);
        ts.timestamps.push(now);

        // Trim
        if (ts.values.length > MAX_TIMESERIES) {
          ts.values = ts.values.slice(-MAX_TIMESERIES);
          ts.timestamps = ts.timestamps.slice(-MAX_TIMESERIES);
        }
      }
    }

    // Analyze after polling
    this._analyze();
  }

  _extractMetric(stats, key) {
    // Handle nested keys like 'estimation.globalMAE' or 'timePressure.pressureLevel'
    const parts = key.split('.');
    let val = stats;
    for (const part of parts) {
      if (val === null || val === undefined) return null;
      val = val[part];
    }
    return typeof val === 'number' ? val : null;
  }

  // ─────────────────────────────────────────────
  // Analysis
  // ─────────────────────────────────────────────

  _analyze() {
    const newStagnations = [];

    for (const def of MODULE_DEFS) {
      for (const metric of def.metrics) {
        const ts = this.timeSeries[def.id][metric.key];
        const a = this.analysis[def.id][metric.key];

        if (ts.values.length < 3) {
          a.status = 'insufficient_data';
          a.slope = null;
          continue;
        }

        a.lastValue = ts.values[ts.values.length - 1];

        // Compute slope over last SLOPE_WINDOW points
        const window = Math.min(ts.values.length, SLOPE_WINDOW);
        const recentValues = ts.values.slice(-window);
        const slope = linearRegressionSlope(recentValues);
        a.slope = +slope.toFixed(6);

        // Convergence distance (only for metrics with known optimum)
        if (metric.optimal !== null) {
          a.convergenceDistance = Math.abs(a.lastValue - metric.optimal);
        } else {
          a.convergenceDistance = null;
        }

        // Classify status
        const prevStatus = a.status;

        if (metric.direction === null) {
          // No direction — just report slope, no stagnation concept
          a.status = Math.abs(slope) < STAGNATION_THRESHOLD ? 'stable' : slope > 0 ? 'increasing' : 'decreasing';
        } else if (metric.direction === 'higher') {
          a.status = this._classifyLearning(slope, a.convergenceDistance, metric.optimal, recentValues, 'higher');
        } else {
          a.status = this._classifyLearning(slope, a.convergenceDistance, metric.optimal, recentValues, 'lower');
        }

        // Detect transitions to stagnation
        if (a.status === 'stuck' && prevStatus !== 'stuck' && ts.values.length >= STUCK_MIN_POINTS) {
          newStagnations.push({ moduleId: def.id, metricKey: metric.key, metric, analysis: { ...a } });
        }
      }
    }

    // Process stagnations
    for (const stag of newStagnations) {
      this._handleStagnation(stag);
    }

    // Check cross-module learning opportunities
    this._checkCrossModuleOpportunities();

    // Check if previous suggestions led to improvements
    this._evaluateSuggestions();

    // Emit analysis update
    if (this._pollCount % 3 === 0) { // Every 3rd poll (~15 min)
      this.bus.safeEmit('meta.analysis.updated', {
        summary: this._summarizeAnalysis(),
        selfMetrics: { ...this.selfMetrics }
      });
    }
  }

  _classifyLearning(slope, convergenceDistance, optimal, recentValues, direction) {
    const absSlope = Math.abs(slope);
    const isImproving = direction === 'higher' ? slope > STAGNATION_THRESHOLD : slope < -STAGNATION_THRESHOLD;
    const isRegressing = direction === 'higher' ? slope < -STAGNATION_THRESHOLD : slope > STAGNATION_THRESHOLD;

    if (isImproving) return 'learning';
    if (isRegressing) return 'regressing';

    // Slope is flat — stagnation. But is it converged or stuck?
    if (absSlope <= STAGNATION_THRESHOLD) {
      if (optimal === null) return 'stagnating'; // No optimum known

      // How close to optimal?
      const nearOptimal = direction === 'higher'
        ? (convergenceDistance < 0.1 || recentValues[recentValues.length - 1] > optimal * 0.9)
        : (convergenceDistance < 0.05 || recentValues[recentValues.length - 1] < optimal + 0.05);

      if (nearOptimal) return 'converged';

      // Check variance — truly stuck has low variance
      const variance = computeVariance(recentValues);
      if (variance < 0.0001) return 'stuck'; // Very flat, far from optimal

      return 'stagnating'; // Some fluctuation but no clear trend
    }

    return 'stagnating';
  }

  // ─────────────────────────────────────────────
  // Stagnation Handling
  // ─────────────────────────────────────────────

  _handleStagnation(stag) {
    const { moduleId, metricKey, metric, analysis } = stag;
    this.selfMetrics.stagnationsDetected++;
    this.selfMetrics.stuckDetected++;

    const def = MODULE_DEFS.find(d => d.id === moduleId);
    if (!def) return;

    // Pick a suggestion for this stuck module
    const stuckSuggestions = def.suggestions?.stuck || [];
    const suggestionIdx = this.selfMetrics.suggestionsProposed % stuckSuggestions.length;
    const suggestionText = stuckSuggestions[suggestionIdx] || `Investigate ${moduleId}.${metricKey} stagnation`;

    const suggestion = {
      id: `sug_${Date.now()}_${this.selfMetrics.suggestionsProposed}`,
      moduleId,
      metricKey,
      metricLabel: metric.label,
      type: 'stuck',
      suggestion: suggestionText,
      metricValueAtSuggestion: analysis.lastValue,
      convergenceDistance: analysis.convergenceDistance,
      slope: analysis.slope,
      createdAt: Date.now(),
      resolved: false,
      improved: null,
      metricValueAtResolution: null,
    };

    this.suggestions.push(suggestion);
    this.selfMetrics.suggestionsProposed++;
    this._trimSuggestions();

    this.bus.safeEmit('meta.stagnation.detected', {
      moduleId,
      metricKey,
      metricLabel: metric.label,
      status: 'stuck',
      currentValue: analysis.lastValue,
      convergenceDistance: analysis.convergenceDistance,
      slope: analysis.slope,
      suggestion: suggestionText
    });

    this.bus.safeEmit('meta.suggestion.proposed', {
      id: suggestion.id,
      moduleId,
      metricKey,
      type: 'stuck',
      suggestion: suggestionText
    });
  }

  // ─────────────────────────────────────────────
  // Cross-Module Learning
  // ─────────────────────────────────────────────

  _checkCrossModuleOpportunities() {
    // Find modules that are learning well vs stuck
    const learningWell = [];
    const stuck = [];

    for (const def of MODULE_DEFS) {
      const analyses = this.analysis[def.id];
      const statuses = Object.values(analyses).map(a => a.status);

      if (statuses.some(s => s === 'learning')) {
        learningWell.push(def.id);
      }
      if (statuses.some(s => s === 'stuck' || s === 'regressing')) {
        stuck.push(def.id);
      }
    }

    // For each stuck module, check if a well-learning module has a cross-module suggestion
    for (const stuckId of stuck) {
      const stuckDef = MODULE_DEFS.find(d => d.id === stuckId);
      if (!stuckDef?.suggestions?.crossModule) continue;

      for (const wellId of learningWell) {
        const crossSuggestion = stuckDef.suggestions.crossModule[wellId];
        if (!crossSuggestion) continue;

        // Don't repeat the same cross-module suggestion within 1 hour
        const recentCross = this.suggestions.find(
          s => s.type === 'cross_module'
            && s.moduleId === stuckId
            && s.sourceModule === wellId
            && Date.now() - s.createdAt < 3600000
        );
        if (recentCross) continue;

        const suggestion = {
          id: `sug_${Date.now()}_${this.selfMetrics.suggestionsProposed}`,
          moduleId: stuckId,
          metricKey: '_cross',
          metricLabel: `Cross-module: ${wellId} → ${stuckId}`,
          type: 'cross_module',
          sourceModule: wellId,
          suggestion: crossSuggestion,
          createdAt: Date.now(),
          resolved: false,
          improved: null,
        };

        this.suggestions.push(suggestion);
        this.selfMetrics.suggestionsProposed++;

        this.bus.safeEmit('meta.suggestion.proposed', {
          id: suggestion.id,
          moduleId: stuckId,
          sourceModule: wellId,
          type: 'cross_module',
          suggestion: crossSuggestion
        });
      }
    }
  }

  // ─────────────────────────────────────────────
  // Self-Evaluation
  // ─────────────────────────────────────────────

  _evaluateSuggestions() {
    // Check unresolved suggestions: did the metric improve since the suggestion?
    const now = Date.now();

    for (const sug of this.suggestions) {
      if (sug.resolved) continue;
      if (sug.type === 'cross_module') continue; // cross-module harder to evaluate
      if (now - sug.createdAt < POLL_INTERVAL * 3) continue; // wait at least 3 polls

      const analysis = this.analysis[sug.moduleId]?.[sug.metricKey];
      if (!analysis || analysis.lastValue === null) continue;

      const def = MODULE_DEFS.find(d => d.id === sug.moduleId);
      const metric = def?.metrics.find(m => m.key === sug.metricKey);
      if (!metric) continue;

      sug.metricValueAtResolution = analysis.lastValue;

      // Did it improve?
      if (metric.direction === 'higher') {
        sug.improved = analysis.lastValue > sug.metricValueAtSuggestion + STAGNATION_THRESHOLD;
      } else if (metric.direction === 'lower') {
        sug.improved = analysis.lastValue < sug.metricValueAtSuggestion - STAGNATION_THRESHOLD;
      } else {
        sug.improved = null;
      }

      sug.resolved = true;
      if (sug.improved) {
        this.selfMetrics.suggestionsFollowed++;
      }
    }

    // Update success rate
    const resolved = this.suggestions.filter(s => s.resolved && s.improved !== null);
    if (resolved.length > 0) {
      this.selfMetrics.suggestionSuccessRate = +(
        resolved.filter(s => s.improved).length / resolved.length
      ).toFixed(3);
    }

    // Track own learning curve (how well our stagnation detection works)
    if (this._pollCount % 6 === 0 && this.selfMetrics.suggestionsProposed > 0) {
      this.selfMetrics.ownLearningCurve.push({
        timestamp: now,
        successRate: this.selfMetrics.suggestionSuccessRate,
        stagnationsDetected: this.selfMetrics.stagnationsDetected,
        suggestionsProposed: this.selfMetrics.suggestionsProposed,
      });

      if (this.selfMetrics.ownLearningCurve.length > MAX_TIMESERIES) {
        this.selfMetrics.ownLearningCurve = this.selfMetrics.ownLearningCurve.slice(-MAX_TIMESERIES);
      }
    }
  }

  // ─────────────────────────────────────────────
  // Introspection / Reporting
  // ─────────────────────────────────────────────

  getMetaState() {
    return {
      modules: this._summarizeAnalysis(),
      selfMetrics: { ...this.selfMetrics },
      recentSuggestions: this.suggestions.slice(-10).map(s => ({
        id: s.id,
        moduleId: s.moduleId,
        metricKey: s.metricKey,
        type: s.type,
        suggestion: s.suggestion,
        improved: s.improved,
        age: formatMs(Date.now() - s.createdAt)
      })),
      totalDataPoints: this._totalDataPoints(),
      pollCount: this._pollCount
    };
  }

  _summarizeAnalysis() {
    const summary = {};

    for (const def of MODULE_DEFS) {
      const mod = this.engine?.[def.engineProp];
      const available = !!mod;

      const metrics = {};
      for (const metric of def.metrics) {
        const a = this.analysis[def.id][metric.key];
        const ts = this.timeSeries[def.id][metric.key];
        metrics[metric.key] = {
          label: metric.label,
          status: a.status,
          slope: a.slope,
          lastValue: a.lastValue,
          convergenceDistance: a.convergenceDistance,
          optimal: metric.optimal,
          direction: metric.direction,
          dataPoints: ts.values.length,
        };
      }

      // Overall module status: worst metric status wins
      const statuses = Object.values(metrics).map(m => m.status);
      const overall = statuses.includes('stuck') ? 'stuck'
        : statuses.includes('regressing') ? 'regressing'
        : statuses.includes('stagnating') ? 'stagnating'
        : statuses.includes('learning') ? 'learning'
        : statuses.includes('converged') ? 'converged'
        : 'insufficient_data';

      summary[def.id] = {
        available,
        overallStatus: overall,
        metrics
      };
    }

    return summary;
  }

  /**
   * Get learning curves for a specific module.
   */
  getLearningCurves(moduleId) {
    const ts = this.timeSeries[moduleId];
    if (!ts) return null;

    const curves = {};
    for (const [key, data] of Object.entries(ts)) {
      if (data.values.length < 2) continue;
      curves[key] = {
        values: data.values.slice(-SLOPE_WINDOW),
        timestamps: data.timestamps.slice(-SLOPE_WINDOW),
        slope: this.analysis[moduleId][key]?.slope,
        status: this.analysis[moduleId][key]?.status,
      };
    }
    return curves;
  }

  /**
   * Get all sequencing constraints from cross-module analysis.
   */
  getStagnationReport() {
    const report = [];

    for (const def of MODULE_DEFS) {
      for (const metric of def.metrics) {
        const a = this.analysis[def.id][metric.key];
        if (a.status === 'stuck' || a.status === 'regressing' || a.status === 'stagnating') {
          report.push({
            moduleId: def.id,
            metricKey: metric.key,
            metricLabel: metric.label,
            status: a.status,
            slope: a.slope,
            lastValue: a.lastValue,
            convergenceDistance: a.convergenceDistance,
            optimal: metric.optimal,
            dataPoints: this.timeSeries[def.id][metric.key].values.length,
          });
        }
      }
    }

    return report.sort((a, b) => {
      const priority = { stuck: 0, regressing: 1, stagnating: 2 };
      return (priority[a.status] ?? 3) - (priority[b.status] ?? 3);
    });
  }

  _totalDataPoints() {
    let total = 0;
    for (const moduleTs of Object.values(this.timeSeries)) {
      for (const ts of Object.values(moduleTs)) {
        total += ts.values.length;
      }
    }
    return total;
  }

  // ─────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────

  async _loadState() {
    try {
      const raw = await readFile(join(this.soulPath, STATE_FILE), 'utf-8');
      const data = JSON.parse(raw);

      if (data.timeSeries) {
        for (const [modId, metrics] of Object.entries(data.timeSeries)) {
          if (!this.timeSeries[modId]) continue;
          for (const [key, ts] of Object.entries(metrics)) {
            if (!this.timeSeries[modId][key]) continue;
            this.timeSeries[modId][key] = ts;
          }
        }
      }
      if (data.suggestions) this.suggestions = data.suggestions;
      if (data.selfMetrics) Object.assign(this.selfMetrics, data.selfMetrics);
      if (data.pollCount) this._pollCount = data.pollCount;
    } catch {
      // Fresh start
    }
  }

  async _saveState() {
    try {
      await writeFile(
        join(this.soulPath, STATE_FILE),
        JSON.stringify({
          version: 1,
          savedAt: new Date().toISOString(),
          pollCount: this._pollCount,
          timeSeries: this.timeSeries,
          suggestions: this.suggestions.slice(-MAX_SUGGESTIONS),
          selfMetrics: this.selfMetrics,
        }, null, 2),
        'utf-8'
      );
    } catch (err) {
      this.bus.safeEmit('meta.error', { phase: 'save', error: err.message });
    }
  }

  _trimSuggestions() {
    if (this.suggestions.length > MAX_SUGGESTIONS) {
      this.suggestions = this.suggestions.slice(-MAX_SUGGESTIONS);
    }
  }
}

// ─────────────────────────────────────────────
// Math Helpers
// ─────────────────────────────────────────────

/**
 * Compute slope via least-squares linear regression.
 * x = [0, 1, 2, ...], y = values
 */
function linearRegressionSlope(values) {
  const n = values.length;
  if (n < 2) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}

function computeVariance(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

function formatMs(ms) {
  if (ms === null || ms === undefined) return '?';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}
