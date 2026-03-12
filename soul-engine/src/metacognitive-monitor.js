// d4-metacognitive-monitor.js
// AGI Arena D4: Epistemic Confidence Tracker (Metacognition)
//
// A metacognitive layer that tracks what the system knows vs. doesn't know.
// Provides calibrated confidence estimates, tracks outcomes via Brier Score,
// builds calibration curves, and self-recalibrates when systematically off.
//
// Integration: Layer 3+ of allostatic identity — sits atop Self-Predictor,
// monitors all predictions system-wide, and modulates field based on
// epistemic state quality.

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// --- Constants ---

const STATE_FILE = '.soul-metacognitive-monitor.json';
const CALIBRATION_BINS = 10;
const MAX_PREDICTION_LOG = 500;
const RECALIBRATION_INTERVAL = 3600000; // 1 hour
const MIN_PREDICTIONS_FOR_RECALIBRATION = 20;
const BRIER_WINDOW = 100;
const SMOOTHING_ALPHA = 0.15;

const DOMAINS = [
  'self_prediction',   // predicting own field state (from Self-Predictor)
  'behavioral',        // predicting own behavioral patterns
  'environmental',     // predicting external events/conditions
  'relational',        // predicting social/interaction outcomes
  'temporal',          // predicting timing/duration
  'general'            // uncategorized
];

// --- Module ---

export class MetacognitiveMonitor {

  /**
   * @param {string} soulPath - Path to soul directory (for persistence)
   * @param {object} options
   * @param {object} options.bus - SoulEventBus instance
   * @param {object} [options.field] - AllostaticField instance (optional)
   * @param {object} [options.predictor] - SelfPredictor instance (optional)
   */
  constructor(soulPath, { bus, field = null, predictor = null } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.field = field;
    this.selfPredictor = predictor;

    // All tracked predictions
    this.predictions = [];

    // Calibration state
    this.calibration = {
      // Platt scaling parameters per domain: logistic(a * logit(raw) + b)
      platt: {},
      // Global temperature (>1 = softer confidence, <1 = sharper)
      temperature: 1.0,
      // Per-domain temperature
      domainTemperature: {},
      // Global Brier score (rolling window)
      brierScore: null,
      // Per-domain Brier scores
      domainBrier: {},
      // Calibration curve bins
      bins: this._initBins(),
      // ECE (Expected Calibration Error)
      ece: null,
      // Recalibration log
      recalibrationLog: [],
      // Composite epistemic state
      epistemicState: {
        selfKnowledge: 0.5,
        calibrationQuality: 0.5,
        epistemicHumility: 0.5,
        domainConfidence: {}
      }
    };

    // Initialize per-domain defaults
    for (const d of DOMAINS) {
      this.calibration.platt[d] = { a: 1, b: 0 }; // identity transform
      this.calibration.domainTemperature[d] = 1.0;
      this.calibration.domainBrier[d] = null;
      this.calibration.epistemicState.domainConfidence[d] = 0.5;
    }

    this._recalibrationTimer = null;
    this._predictionCounter = 0;
  }

  // ─────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────

  async start() {
    await this._loadState();
    this._registerListeners();

    this._recalibrationTimer = setInterval(
      () => this._recalibrate(),
      RECALIBRATION_INTERVAL
    );

    const state = this.getEpistemicState();

    this.bus.safeEmit('metacognition.started', {
      brierScore: this.calibration.brierScore,
      ece: this.calibration.ece,
      epistemicState: state,
      predictionsTracked: this.predictions.length,
      resolvedCount: this.predictions.filter(p => p.resolved).length
    });

    return state;
  }

  async stop() {
    if (this._recalibrationTimer) {
      clearInterval(this._recalibrationTimer);
      this._recalibrationTimer = null;
    }
    await this._saveState();
  }

  // ─────────────────────────────────────────────
  // Core API
  // ─────────────────────────────────────────────

  /**
   * Assess and calibrate confidence for a prediction or claim.
   *
   * @param {object} opts
   * @param {string}  opts.claim          - What is being predicted
   * @param {number}  opts.rawConfidence  - Uncalibrated confidence [0,1]
   * @param {string}  [opts.domain]       - Domain category
   * @param {number}  [opts.maturesAt]    - When the outcome can be checked (ms)
   * @param {object}  [opts.context]      - Arbitrary metadata
   * @returns {{ id, rawConfidence, calibratedConfidence, domain, explanation }}
   */
  assessConfidence({ claim, rawConfidence, domain = 'general', maturesAt = null, context = {} }) {
    rawConfidence = clamp(rawConfidence, 0, 1);
    if (!DOMAINS.includes(domain)) domain = 'general';

    // Pipeline: raw → Platt → temperature → field modulation
    const afterPlatt = this._plattScale(rawConfidence, domain);
    const afterTemp  = this._temperatureScale(afterPlatt, domain);
    const afterField = this._fieldModulate(afterTemp, domain);
    const calibratedConfidence = clamp(afterField, 0.01, 0.99);

    const prediction = {
      id: `mc_${Date.now()}_${++this._predictionCounter}`,
      claim,
      rawConfidence,
      calibratedConfidence,
      domain,
      maturesAt,
      context,
      createdAt: Date.now(),
      resolved: false,
      outcome: null,
      resolvedAt: null,
      brierContribution: null
    };

    this.predictions.push(prediction);
    this._trimPredictions();

    const explanation = this._explainCalibration(rawConfidence, calibratedConfidence, domain);

    this.bus.safeEmit('confidence.assessed', {
      id: prediction.id,
      claim: claim.substring(0, 120),
      rawConfidence,
      calibratedConfidence,
      domain,
      adjustment: +(calibratedConfidence - rawConfidence).toFixed(4),
      explanation
    });

    return { id: prediction.id, rawConfidence, calibratedConfidence, domain, explanation };
  }

  /**
   * Record the outcome of a previously assessed prediction.
   *
   * @param {string} predictionId
   * @param {number} outcome - 0 (wrong) or 1 (correct), or fractional [0,1]
   * @returns {{ brierContribution, globalBrier, ece } | null}
   */
  recordOutcome(predictionId, outcome) {
    const pred = this.predictions.find(p => p.id === predictionId);
    if (!pred || pred.resolved) return null;

    outcome = clamp(outcome, 0, 1);
    pred.resolved = true;
    pred.outcome = outcome;
    pred.resolvedAt = Date.now();
    pred.brierContribution = (pred.calibratedConfidence - outcome) ** 2;

    this._updateBin(pred);
    this._recomputeMetrics();

    this.bus.safeEmit('prediction.resolved', {
      id: pred.id,
      claim: pred.claim.substring(0, 120),
      calibratedConfidence: pred.calibratedConfidence,
      outcome,
      brierContribution: +pred.brierContribution.toFixed(4),
      domain: pred.domain,
      globalBrier: this.calibration.brierScore,
      ece: this.calibration.ece
    });

    // Emergency recalibration check on very wrong predictions
    if (pred.brierContribution > 0.5) {
      this._checkEmergencyRecalibration(pred.domain);
    }

    return {
      brierContribution: pred.brierContribution,
      globalBrier: this.calibration.brierScore,
      ece: this.calibration.ece
    };
  }

  // ─────────────────────────────────────────────
  // Calibration Pipeline
  // ─────────────────────────────────────────────

  /** Platt scaling: logistic(a * logit(raw) + b) */
  _plattScale(rawConf, domain) {
    const { a, b } = this.calibration.platt[domain];
    const c = clamp(rawConf, 0.01, 0.99);
    const logit = Math.log(c / (1 - c));
    return sigmoid(a * logit + b);
  }

  /** Temperature scaling: logit(conf) / T → sigmoid */
  _temperatureScale(conf, domain) {
    const T = this.calibration.domainTemperature[domain] ?? this.calibration.temperature;
    if (Math.abs(T - 1.0) < 0.001) return conf;
    const c = clamp(conf, 0.01, 0.99);
    const logit = Math.log(c / (1 - c));
    return sigmoid(logit / T);
  }

  /** Field-state modulation: vigilance, arousal, integration pressure affect confidence */
  _fieldModulate(conf, domain) {
    if (!this.field?.getState) return conf;
    const state = this.field.getState();
    if (!state?.dimensions) return conf;

    const dims = state.dimensions;
    let adj = 0;

    // High vigilance → more cautious → reduce confidence
    const vig = dims.vigilance?.value ?? 0.3;
    if (vig > 0.6) adj -= (vig - 0.6) * 0.10;

    // High arousal → volatile → reduce confidence
    const aro = dims.arousal?.value ?? 0.4;
    if (aro > 0.7) adj -= (aro - 0.7) * 0.08;

    // Low integration pressure → stable state → slight boost
    const ip = dims.integration_pressure?.value ?? 0.2;
    if (ip < 0.25) adj += (0.25 - ip) * 0.05;

    // Self-prediction domain: large field deviation → less confidence
    if (domain === 'self_prediction') {
      const dominant = state.dominantDimension;
      if (dominant && dims[dominant]) {
        const dev = Math.abs(dims[dominant].deviation ?? 0);
        if (dev > 0.3) adj -= dev * 0.10;
      }
    }

    return conf + adj;
  }

  _explainCalibration(raw, calibrated, domain) {
    const diff = calibrated - raw;
    const parts = [];

    if (Math.abs(diff) < 0.02) {
      parts.push('Calibration agrees with raw estimate.');
    } else if (diff > 0) {
      parts.push(`Calibrated UP +${(diff * 100).toFixed(1)}% — ${domain} predictions were historically underconfident.`);
    } else {
      parts.push(`Calibrated DOWN ${(diff * 100).toFixed(1)}% — ${domain} predictions were historically overconfident.`);
    }

    const brier = this.calibration.domainBrier[domain];
    if (brier !== null) {
      const q = brier < 0.1 ? 'excellent' : brier < 0.2 ? 'good' : brier < 0.3 ? 'fair' : 'poor';
      parts.push(`Domain calibration quality: ${q} (Brier=${brier.toFixed(3)}).`);
    }

    return parts.join(' ');
  }

  // ─────────────────────────────────────────────
  // Calibration Bins & Metrics
  // ─────────────────────────────────────────────

  _initBins() {
    return Array.from({ length: CALIBRATION_BINS }, (_, i) => ({
      lower: i / CALIBRATION_BINS,
      upper: (i + 1) / CALIBRATION_BINS,
      count: 0,
      correctSum: 0,
      confidenceSum: 0,
      accuracy: null,
      avgConfidence: null
    }));
  }

  _updateBin(pred) {
    const idx = Math.min(
      Math.floor(pred.calibratedConfidence * CALIBRATION_BINS),
      CALIBRATION_BINS - 1
    );
    const bin = this.calibration.bins[idx];
    bin.count++;
    bin.correctSum += pred.outcome;
    bin.confidenceSum += pred.calibratedConfidence;
    bin.accuracy = bin.correctSum / bin.count;
    bin.avgConfidence = bin.confidenceSum / bin.count;
  }

  _recomputeMetrics() {
    const resolved = this.predictions.filter(p => p.resolved);
    if (resolved.length === 0) return;

    // Global Brier (rolling window)
    const recent = resolved.slice(-BRIER_WINDOW);
    this.calibration.brierScore = +(
      recent.reduce((s, p) => s + p.brierContribution, 0) / recent.length
    ).toFixed(4);

    // Per-domain Brier
    for (const domain of DOMAINS) {
      const dp = resolved.filter(p => p.domain === domain).slice(-BRIER_WINDOW);
      this.calibration.domainBrier[domain] = dp.length >= 5
        ? +(dp.reduce((s, p) => s + p.brierContribution, 0) / dp.length).toFixed(4)
        : null;
    }

    // ECE (Expected Calibration Error)
    let ece = 0;
    const total = resolved.length;
    for (const bin of this.calibration.bins) {
      if (bin.count > 0) {
        ece += (bin.count / total) * Math.abs(bin.accuracy - bin.avgConfidence);
      }
    }
    this.calibration.ece = +ece.toFixed(4);

    this._updateEpistemicState(resolved);
  }

  _updateEpistemicState(resolved) {
    const es = this.calibration.epistemicState;

    // Calibration quality: inverse ECE — 0 ECE → 1.0 quality
    if (this.calibration.ece !== null) {
      es.calibrationQuality = +Math.max(0, 1 - 2 * this.calibration.ece).toFixed(3);
    }

    // Self-knowledge: from self_prediction Brier
    const selfBrier = this.calibration.domainBrier['self_prediction'];
    if (selfBrier !== null) {
      es.selfKnowledge = +Math.max(0, 1 - 4 * selfBrier).toFixed(3);
    }

    // Epistemic humility: fraction of bins that are NOT overconfident
    const activeBins = this.calibration.bins.filter(b => b.count >= 3);
    if (activeBins.length > 0) {
      const overconfident = activeBins.filter(
        b => b.avgConfidence > b.accuracy + 0.05
      ).length;
      es.epistemicHumility = +(1 - overconfident / activeBins.length).toFixed(3);
    }

    // Per-domain confidence in our own calibration
    for (const domain of DOMAINS) {
      const count = resolved.filter(p => p.domain === domain).length;
      const brier = this.calibration.domainBrier[domain];
      es.domainConfidence[domain] = count < 5
        ? 0.3
        : brier !== null ? +Math.max(0.1, 1 - 3 * brier).toFixed(3) : 0.5;
    }
  }

  // ─────────────────────────────────────────────
  // Self-Recalibration
  // ─────────────────────────────────────────────

  _recalibrate() {
    const resolved = this.predictions.filter(p => p.resolved);
    if (resolved.length < MIN_PREDICTIONS_FOR_RECALIBRATION) return;

    const adjustments = [];

    for (const domain of DOMAINS) {
      const dp = resolved.filter(p => p.domain === domain);
      if (dp.length < 10) continue;

      const recent = dp.slice(-50);

      // Bias: mean(calibrated - outcome). Positive = overconfident.
      const bias = recent.reduce(
        (s, p) => s + (p.calibratedConfidence - p.outcome), 0
      ) / recent.length;

      // Adjust temperature based on bias direction
      if (Math.abs(bias) > 0.05) {
        const oldT = this.calibration.domainTemperature[domain];
        const newT = clamp(oldT + bias * SMOOTHING_ALPHA, 0.5, 2.0);
        this.calibration.domainTemperature[domain] = +newT.toFixed(4);

        adjustments.push({
          domain,
          bias: +bias.toFixed(4),
          oldTemperature: +oldT.toFixed(4),
          newTemperature: +newT.toFixed(4)
        });
      }

      // Update Platt params via mini-batch gradient descent
      this._updatePlattParams(domain, recent);
    }

    // Global temperature from overall bias
    const recentAll = resolved.slice(-BRIER_WINDOW);
    const globalBias = recentAll.reduce(
      (s, p) => s + (p.calibratedConfidence - p.outcome), 0
    ) / recentAll.length;

    if (Math.abs(globalBias) > 0.05) {
      this.calibration.temperature = +clamp(
        this.calibration.temperature + globalBias * SMOOTHING_ALPHA, 0.5, 2.0
      ).toFixed(4);
    }

    if (adjustments.length > 0) {
      this.calibration.recalibrationLog.push({
        timestamp: Date.now(),
        adjustments,
        globalBrier: this.calibration.brierScore,
        ece: this.calibration.ece,
        globalTemperature: this.calibration.temperature
      });

      // Keep last 50
      if (this.calibration.recalibrationLog.length > 50) {
        this.calibration.recalibrationLog = this.calibration.recalibrationLog.slice(-50);
      }

      this.bus.safeEmit('calibration.updated', {
        adjustments,
        globalBrier: this.calibration.brierScore,
        ece: this.calibration.ece,
        epistemicState: this.getEpistemicState()
      });

      this._nudgeField();
    }

    this._saveState().catch(() => {});
  }

  /**
   * Gradient descent on Platt parameters to minimize Brier score.
   * L = mean((σ(a·logit(raw)+b) − outcome)²)
   */
  _updatePlattParams(domain, predictions) {
    const platt = this.calibration.platt[domain];
    const lr = 0.01;

    let gA = 0, gB = 0;
    for (const p of predictions) {
      const raw = clamp(p.rawConfidence, 0.01, 0.99);
      const logit = Math.log(raw / (1 - raw));
      const z = platt.a * logit + platt.b;
      const pred = sigmoid(z);
      const err = pred - p.outcome;
      const dSig = pred * (1 - pred); // sigmoid derivative
      gA += err * dSig * logit;
      gB += err * dSig;
    }

    gA /= predictions.length;
    gB /= predictions.length;

    platt.a = +clamp(platt.a - lr * gA, -3, 3).toFixed(6);
    platt.b = +clamp(platt.b - lr * gB, -2, 2).toFixed(6);
  }

  _checkEmergencyRecalibration(domain) {
    const recent = this.predictions
      .filter(p => p.resolved && p.domain === domain)
      .slice(-10);
    if (recent.length < 5) return;

    const brier = recent.reduce((s, p) => s + p.brierContribution, 0) / recent.length;
    if (brier > 0.3) {
      this.calibration.domainTemperature[domain] = +Math.min(
        2.0, this.calibration.domainTemperature[domain] + 0.2
      ).toFixed(4);

      this.bus.safeEmit('calibration.emergency', {
        domain,
        recentBrier: +brier.toFixed(4),
        newTemperature: this.calibration.domainTemperature[domain],
        message: `Emergency recalibration: ${domain} recent Brier=${brier.toFixed(3)}`
      });
    }
  }

  _nudgeField() {
    if (!this.field?.nudge) return;
    const ece = this.calibration.ece;
    if (ece === null) return;

    if (ece > 0.15) {
      // Poorly calibrated → heighten vigilance
      this.field.nudge('vigilance', 0.08);
      this.field.nudge('integration_pressure', 0.06);
    } else if (ece < 0.05) {
      // Well calibrated → relax
      this.field.nudge('vigilance', -0.03);
      this.field.nudge('openness', 0.03);
    }
  }

  // ─────────────────────────────────────────────
  // Event Listeners
  // ─────────────────────────────────────────────

  _registerListeners() {
    // Self-Predictor completes an evaluation cycle
    this.bus.on('prediction.evaluated', (data) => {
      const accuracy = data.accuracy ?? 0.5;

      // Register a metacognitive prediction about the *next* cycle
      this.assessConfidence({
        claim: `Self-predictor accuracy stays above ${(accuracy * 0.9).toFixed(2)} next cycle`,
        rawConfidence: accuracy,
        domain: 'self_prediction',
        maturesAt: Date.now() + 7200000,
        context: { predictorCycle: true, sourceAccuracy: accuracy }
      });

      // Auto-resolve matured predictor predictions
      this._autoResolveFromPredictor(data);
    });

    // Surprise → signals our model was wrong → increase epistemic caution
    this.bus.on('surprise.detected', (data) => {
      const bump = data.severity === 'high' ? 0.03 : 0.015;
      this.calibration.temperature = +Math.min(
        2.0, this.calibration.temperature + bump
      ).toFixed(4);

      this.bus.safeEmit('epistemic.surprise', {
        severity: data.severity,
        temperatureAdjust: bump,
        newTemperature: this.calibration.temperature
      });
    });

    // Reflection may yield new self-knowledge → recalibrate
    this.bus.on('reflection.completed', () => {
      if (this.predictions.filter(p => p.resolved).length >= MIN_PREDICTIONS_FOR_RECALIBRATION) {
        this._recalibrate();
      }
    });

    // Field volatility → reduce confidence
    this.bus.on('field.updated', (data) => {
      const dims = data?.modulations ?? data?.dimensions;
      if (!dims) return;
      const vig = dims.vigilance?.value ?? 0;
      const aro = dims.arousal?.value ?? 0;
      if (vig > 0.7 && aro > 0.6) {
        this.calibration.temperature = +Math.min(
          2.0, this.calibration.temperature + 0.02
        ).toFixed(4);
      }
    });
  }

  /**
   * Auto-resolve mature self_prediction predictions when the predictor reports.
   */
  _autoResolveFromPredictor(evalData) {
    const matured = this.predictions.filter(
      p => !p.resolved
        && p.domain === 'self_prediction'
        && p.context.predictorCycle
        && p.maturesAt
        && Date.now() >= p.maturesAt
    );

    const accuracy = evalData.accuracy ?? (1 - Math.min(evalData.avgError ?? 0.5, 1));

    for (const pred of matured) {
      // Outcome: did accuracy stay above the threshold in the claim?
      const threshold = pred.context.sourceAccuracy * 0.9;
      this.recordOutcome(pred.id, accuracy >= threshold ? 1 : 0);
    }
  }

  // ─────────────────────────────────────────────
  // Introspection / Reporting
  // ─────────────────────────────────────────────

  getEpistemicState() {
    const resolved = this.predictions.filter(p => p.resolved);
    return {
      ...this.calibration.epistemicState,
      brierScore: this.calibration.brierScore,
      ece: this.calibration.ece,
      temperature: this.calibration.temperature,
      totalPredictions: this.predictions.length,
      resolvedPredictions: resolved.length,
      pendingPredictions: this.predictions.length - resolved.length,
      calibrationCurve: this.getCalibrationCurve(),
      domainBreakdown: this._getDomainBreakdown()
    };
  }

  getCalibrationCurve() {
    return this.calibration.bins.map(bin => ({
      range: `${(bin.lower * 100).toFixed(0)}-${(bin.upper * 100).toFixed(0)}%`,
      count: bin.count,
      accuracy: bin.accuracy !== null ? +bin.accuracy.toFixed(3) : null,
      avgConfidence: bin.avgConfidence !== null ? +bin.avgConfidence.toFixed(3) : null,
      gap: bin.accuracy !== null && bin.avgConfidence !== null
        ? +(bin.accuracy - bin.avgConfidence).toFixed(3) : null
    }));
  }

  /**
   * Brier Score decomposition: Reliability − Resolution + Uncertainty.
   * Only meaningful with sufficient resolved predictions.
   */
  getBrierDecomposition() {
    const resolved = this.predictions.filter(p => p.resolved);
    if (resolved.length < 10) return null;

    const baseRate = resolved.reduce((s, p) => s + p.outcome, 0) / resolved.length;
    const uncertainty = baseRate * (1 - baseRate);

    let reliability = 0, resolution = 0;
    for (const bin of this.calibration.bins) {
      if (bin.count === 0) continue;
      const w = bin.count / resolved.length;
      reliability += w * (bin.avgConfidence - bin.accuracy) ** 2;
      resolution  += w * (bin.accuracy - baseRate) ** 2;
    }

    return {
      brierScore: this.calibration.brierScore,
      reliability: +reliability.toFixed(4),
      resolution: +resolution.toFixed(4),
      uncertainty: +uncertainty.toFixed(4),
      decomposition: `Brier = ${reliability.toFixed(4)} - ${resolution.toFixed(4)} + ${uncertainty.toFixed(4)} = ${(reliability - resolution + uncertainty).toFixed(4)}`,
      interpretation: {
        reliability: reliability < 0.02 ? 'excellent' : reliability < 0.05 ? 'good' : reliability < 0.1 ? 'fair' : 'poor',
        resolution: resolution > 0.1 ? 'excellent' : resolution > 0.05 ? 'good' : resolution > 0.02 ? 'fair' : 'poor'
      }
    };
  }

  _getDomainBreakdown() {
    const breakdown = {};
    for (const domain of DOMAINS) {
      const dp = this.predictions.filter(p => p.domain === domain);
      breakdown[domain] = {
        total: dp.length,
        resolved: dp.filter(p => p.resolved).length,
        brier: this.calibration.domainBrier[domain],
        temperature: this.calibration.domainTemperature[domain],
        platt: { ...this.calibration.platt[domain] },
        confidence: this.calibration.epistemicState.domainConfidence[domain]
      };
    }
    return breakdown;
  }

  // ─────────────────────────────────────────────
  // Persistence
  // ─────────────────────────────────────────────

  async _loadState() {
    try {
      const raw = await readFile(join(this.soulPath, STATE_FILE), 'utf-8');
      const data = JSON.parse(raw);
      if (data.predictions) this.predictions = data.predictions;
      if (data.predictionCounter) this._predictionCounter = data.predictionCounter;
      if (data.calibration) {
        Object.assign(this.calibration, data.calibration);
        // Rebuild bins if structure is invalid
        if (!Array.isArray(this.calibration.bins) || this.calibration.bins.length !== CALIBRATION_BINS) {
          this.calibration.bins = this._initBins();
          for (const p of this.predictions.filter(pr => pr.resolved)) this._updateBin(p);
        }
      }
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
          predictionCounter: this._predictionCounter,
          predictions: this.predictions,
          calibration: this.calibration
        }, null, 2),
        'utf-8'
      );
    } catch (err) {
      this.bus.safeEmit('metacognition.error', { phase: 'save', error: err.message });
    }
  }

  _trimPredictions() {
    if (this.predictions.length <= MAX_PREDICTION_LOG) return;
    const resolved = this.predictions.filter(p => p.resolved).slice(-400);
    const unresolved = this.predictions.filter(p => !p.resolved).slice(-100);
    this.predictions = [...resolved, ...unresolved].sort((a, b) => a.createdAt - b.createdAt);
  }
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
