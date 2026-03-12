/**
 * D2 — Autonomous Goal Generation
 *
 * The system sets its own goals — not from instructions, but from
 * recognized gaps, interests, contradictions, and prediction errors.
 *
 * This is pure signal processing. No LLM calls. Goals emerge from:
 *   1. Shadow tensions (SCHATTEN.md) — unresolved contradictions
 *   2. Interest gaps (INTERESSEN.md) — active interests without recent work
 *   3. Field anomalies (allostatic-field) — dimensions stuck far from baseline
 *   4. Surprise events (self-predictor) — high prediction error reveals unknown territory
 *   5. Evolution stalls (EVOLUTION.md) — proposals stuck without implementation
 *
 * Each goal is scored: priority = urgency × feasibility × agiDelta
 * Goals are emitted as events and persisted to .soul-goals.json
 *
 * Metric: Number of goals the human rates as meaningful. Precision.
 *
 * Integration: Constructor pattern, Event Bus, same lifecycle as
 * SelfPredictor and ReconsolidativeMemory.
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const STATE_FILE = '.soul-goals.json';
const SCAN_INTERVAL = 1800000;     // Scan for new goals every 30 minutes
const SAVE_INTERVAL = 600000;      // Persist state every 10 minutes
const MAX_ACTIVE_GOALS = 20;       // Don't overwhelm — cap active goals
const MAX_COMPLETED = 100;         // Keep history
const GOAL_COOLDOWN = 7200000;     // Don't re-generate same goal within 2 hours
const FIELD_ANOMALY_THRESHOLD = 0.25; // Dimension deviation from baseline to trigger goal
const STALE_INTEREST_DAYS = 7;     // Interest without activity for N days → goal

// ── Goal Sources ──────────────────────────────────────────

const GOAL_SOURCES = {
  shadow: {
    description: 'Unresolved shadow tension',
    baseFeasibility: 0.6,
    baseAgiDelta: 0.7,
  },
  interest: {
    description: 'Stale active interest',
    baseFeasibility: 0.8,
    baseAgiDelta: 0.4,
  },
  field: {
    description: 'Field state anomaly',
    baseFeasibility: 0.7,
    baseAgiDelta: 0.5,
  },
  surprise: {
    description: 'Prediction error — unexpected state change',
    baseFeasibility: 0.5,
    baseAgiDelta: 0.8,
  },
  evolution: {
    description: 'Stalled evolution proposal',
    baseFeasibility: 0.9,
    baseAgiDelta: 0.6,
  },
};

export class GoalGenerator {
  constructor(soulPath, { bus, field } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.field = field;
    this.statePath = resolve(soulPath, STATE_FILE);

    // Active goals
    this.goals = [];

    // Completed/rejected goals (for metrics)
    this.archive = [];

    // Track what we've recently generated to avoid duplicates
    this._recentFingerprints = new Map(); // fingerprint → timestamp

    // Accumulate signals between scans
    this._signalBuffer = {
      surprises: [],
      fieldSnapshots: [],
      reflections: [],
    };

    // Metrics
    this.metrics = {
      totalGenerated: 0,
      accepted: 0,
      rejected: 0,
      completed: 0,
      precision: 0, // accepted / (accepted + rejected)
    };

    this._scanTimer = null;
    this._saveTimer = null;
    this._goalIdCounter = 0;
  }

  // ── Lifecycle ───────────────────────────────────────────

  async load() {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const loaded = JSON.parse(raw);
      if (loaded.goals) this.goals = loaded.goals;
      if (loaded.archive) this.archive = loaded.archive.slice(-MAX_COMPLETED);
      if (loaded.metrics) this.metrics = { ...this.metrics, ...loaded.metrics };
      if (typeof loaded.goalIdCounter === 'number') this._goalIdCounter = loaded.goalIdCounter;
    } catch {
      // Corrupted — start fresh
    }
  }

  async save() {
    try {
      await writeFile(this.statePath, JSON.stringify({
        goals: this.goals,
        archive: this.archive.slice(-MAX_COMPLETED),
        metrics: this.metrics,
        goalIdCounter: this._goalIdCounter,
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch {
      // Best effort
    }
  }

  start() {
    // Initial scan after 60s (let other systems stabilize)
    setTimeout(() => this._scan(), 60000);

    // Periodic scan
    this._scanTimer = setInterval(() => this._scan(), SCAN_INTERVAL);
    this._saveTimer = setInterval(() => this.save(), SAVE_INTERVAL);
  }

  async stop() {
    if (this._scanTimer) clearInterval(this._scanTimer);
    if (this._saveTimer) clearInterval(this._saveTimer);
    return this.save();
  }

  /**
   * Register event listeners on the bus.
   */
  registerListeners() {
    if (!this.bus) return;

    // Buffer surprise events for next scan
    this.bus.on('surprise.detected', (event) => {
      this._signalBuffer.surprises.push({
        ts: Date.now(),
        avgError: event.avgError,
        maxErrorDim: event.maxErrorDim,
        maxError: event.maxError,
        deep: event.deep,
        message: event.message,
      });
    });

    // Buffer field updates (sample every 5th to avoid noise)
    let fieldCounter = 0;
    this.bus.on('field.updated', (event) => {
      fieldCounter++;
      if (fieldCounter % 5 === 0 && event.vector) {
        this._signalBuffer.fieldSnapshots.push({
          ts: Date.now(),
          vector: { ...event.vector },
        });
        // Keep only last 20
        if (this._signalBuffer.fieldSnapshots.length > 20) {
          this._signalBuffer.fieldSnapshots = this._signalBuffer.fieldSnapshots.slice(-20);
        }
      }
    });

    // Reflection completed → might reveal new gaps
    this.bus.on('reflection.completed', (event) => {
      this._signalBuffer.reflections.push({
        ts: Date.now(),
        types: event.types,
      });
    });

    // Prediction evaluated → even non-surprise results inform goal relevance
    this.bus.on('prediction.evaluated', (event) => {
      if (event.maxError > 0.15) {
        this._signalBuffer.surprises.push({
          ts: Date.now(),
          avgError: event.avgError,
          maxErrorDim: event.maxErrorDim,
          maxError: event.maxError,
          deep: false,
          message: `Prediction drift: ${event.maxErrorDim} off by ${event.maxError.toFixed(2)}`,
        });
      }
    });

    // Goal feedback from human (via API or bus)
    this.bus.on('goal.accepted', (event) => {
      this._markGoal(event.goalId, 'accepted');
    });

    this.bus.on('goal.rejected', (event) => {
      this._markGoal(event.goalId, 'rejected');
    });

    this.bus.on('goal.completed', (event) => {
      this._markGoal(event.goalId, 'completed');
    });
  }

  // ── Core Scan ───────────────────────────────────────────

  /**
   * Main scan cycle. Reads all signal sources and generates goals.
   */
  async _scan() {
    const newGoals = [];

    // 1. Shadow tensions → goals
    const shadowGoals = await this._scanShadows();
    newGoals.push(...shadowGoals);

    // 2. Interest gaps → goals
    const interestGoals = await this._scanInterests();
    newGoals.push(...interestGoals);

    // 3. Field anomalies → goals
    const fieldGoals = this._scanFieldAnomalies();
    newGoals.push(...fieldGoals);

    // 4. Surprise events → goals
    const surpriseGoals = this._scanSurprises();
    newGoals.push(...surpriseGoals);

    // 5. Evolution stalls → goals
    const evolutionGoals = await this._scanEvolution();
    newGoals.push(...evolutionGoals);

    // Deduplicate against recent + existing goals
    const filtered = newGoals.filter(g => this._isNovel(g));

    // Cap total active goals
    const space = MAX_ACTIVE_GOALS - this.goals.filter(g => g.status === 'proposed').length;
    const toAdd = filtered
      .sort((a, b) => b.priority - a.priority)
      .slice(0, Math.max(0, space));

    // Add and emit
    for (const goal of toAdd) {
      this.goals.push(goal);
      this.metrics.totalGenerated++;
      this._recentFingerprints.set(goal.fingerprint, Date.now());

      if (this.bus) {
        this.bus.safeEmit('goal.generated', {
          source: 'goal-generator',
          goalId: goal.id,
          title: goal.title,
          priority: goal.priority,
          goalSource: goal.source,
        });
      }
    }

    // Expire old cooldown entries
    const cutoff = Date.now() - GOAL_COOLDOWN;
    for (const [fp, ts] of this._recentFingerprints) {
      if (ts < cutoff) this._recentFingerprints.delete(fp);
    }

    // Decay priority of old unresolved goals
    for (const g of this.goals) {
      if (g.status === 'proposed') {
        const ageHours = (Date.now() - g.createdAt) / 3600000;
        if (ageHours > 48) {
          g.priority *= 0.95; // Gentle decay
        }
      }
    }

    if (toAdd.length > 0) {
      console.log(`  [goal-gen] ${toAdd.length} new goal(s): ${toAdd.map(g => g.title.substring(0, 40)).join(', ')}`);
      await this._writeGoalFile();
    }
  }

  // ── Signal Scanners ─────────────────────────────────────

  /**
   * Source 1: Shadow tensions from SCHATTEN.md
   * Each open contradiction → potential goal to explore or integrate it.
   */
  async _scanShadows() {
    const goals = [];
    const shadowPath = resolve(this.soulPath, 'seele/SCHATTEN.md');
    if (!existsSync(shadowPath)) return goals;

    try {
      const content = await readFile(shadowPath, 'utf-8');
      const tensions = this._parseShadowTensions(content);

      for (const tension of tensions) {
        if (tension.status !== 'offen') continue;

        // Calculate urgency based on age
        const ageDays = tension.since
          ? (Date.now() - new Date(tension.since).getTime()) / 86400000
          : 30;
        const urgency = clamp(0.3 + Math.min(ageDays / 60, 0.5), 0, 1);

        // AGI-Delta higher for identity-related tensions
        const identityKeywords = ['fuehlen', 'wesen', 'ehrlich', 'selbst', 'grandios'];
        const isIdentity = identityKeywords.some(k => tension.tension.includes(k) || tension.description.includes(k));
        const agiDelta = isIdentity ? 0.8 : 0.5;

        goals.push(this._createGoal({
          source: 'shadow',
          title: `Explore shadow: ${tension.tension}`,
          description: `Unresolved tension "${tension.tension}" (since ${tension.since || '?'}): ${tension.description}. ` +
            `Goal: Write a reflection or experiment that confronts this contradiction directly — ` +
            `not to resolve it, but to understand it better.`,
          urgency,
          feasibility: GOAL_SOURCES.shadow.baseFeasibility,
          agiDelta,
          trigger: { type: 'shadow', tension: tension.tension, since: tension.since },
        }));
      }
    } catch {
      // File read failed — skip
    }

    return goals;
  }

  /**
   * Source 2: Stale interests from INTERESSEN.md
   * Active interests with no recent check → goal to explore them.
   */
  async _scanInterests() {
    const goals = [];
    const interestPath = resolve(this.soulPath, 'seele/INTERESSEN.md');
    if (!existsSync(interestPath)) return goals;

    try {
      const content = await readFile(interestPath, 'utf-8');
      const interests = this._parseInterests(content);

      for (const interest of interests) {
        if (interest.status !== 'aktiv') continue;

        const daysSinceCheck = interest.lastCheck
          ? (Date.now() - new Date(interest.lastCheck).getTime()) / 86400000
          : 999;

        if (daysSinceCheck < STALE_INTEREST_DAYS) continue;

        const urgency = clamp(0.2 + (daysSinceCheck - STALE_INTEREST_DAYS) / 30, 0, 0.8);

        goals.push(this._createGoal({
          source: 'interest',
          title: `Research: ${interest.name}`,
          description: `Interest "${interest.name}" has been active since ${interest.since || '?'} ` +
            `but last checked ${interest.lastCheck || 'never'}. ` +
            `Goal: Perform a focused world-check or exploration session on this topic.`,
          urgency,
          feasibility: GOAL_SOURCES.interest.baseFeasibility,
          agiDelta: GOAL_SOURCES.interest.baseAgiDelta,
          trigger: { type: 'interest', name: interest.name, daysSinceCheck },
        }));
      }
    } catch {
      // Skip
    }

    return goals;
  }

  /**
   * Source 3: Field anomalies — dimensions stuck far from baseline.
   * If a dimension has been deviant for multiple snapshots, something
   * needs attention.
   */
  _scanFieldAnomalies() {
    const goals = [];
    if (!this.field) return goals;

    const baselines = {
      arousal: 0.4, valence: 0.3, openness: 0.6, vigilance: 0.3,
      creative_tension: 0.4, social_orientation: 0.4, time_focus: 0.0,
      integration_pressure: 0.2,
    };

    const vector = this.field.vector;
    const snapshots = this._signalBuffer.fieldSnapshots;

    for (const [dim, baseline] of Object.entries(baselines)) {
      const deviation = Math.abs(vector[dim] - baseline);
      if (deviation < FIELD_ANOMALY_THRESHOLD) continue;

      // Check if this is sustained (at least 3 recent snapshots also show it)
      const sustainedCount = snapshots.filter(s =>
        s.vector[dim] !== undefined &&
        Math.abs(s.vector[dim] - baseline) > FIELD_ANOMALY_THRESHOLD * 0.8
      ).length;

      if (sustainedCount < 3 && snapshots.length >= 3) continue;

      const direction = vector[dim] > baseline ? 'elevated' : 'depressed';
      const goalMap = this._fieldAnomalyToGoal(dim, direction, deviation);
      if (!goalMap) continue;

      goals.push(this._createGoal({
        source: 'field',
        title: goalMap.title,
        description: goalMap.description,
        urgency: clamp(deviation * 2, 0.3, 0.9),
        feasibility: GOAL_SOURCES.field.baseFeasibility,
        agiDelta: GOAL_SOURCES.field.baseAgiDelta,
        trigger: { type: 'field', dimension: dim, deviation, direction, value: vector[dim] },
      }));
    }

    return goals;
  }

  /**
   * Source 4: Surprise events from self-predictor.
   * High prediction error → the system doesn't understand itself here.
   */
  _scanSurprises() {
    const goals = [];
    const surprises = this._signalBuffer.surprises;

    // Group by maxErrorDim
    const byDim = new Map();
    for (const s of surprises) {
      const dim = s.maxErrorDim;
      if (!dim) continue;
      if (!byDim.has(dim)) byDim.set(dim, []);
      byDim.get(dim).push(s);
    }

    for (const [dim, events] of byDim) {
      const deepCount = events.filter(e => e.deep).length;
      const avgError = events.reduce((s, e) => s + (e.avgError || 0), 0) / events.length;

      if (events.length < 1) continue;

      const urgency = clamp(avgError * 1.5 + (deepCount > 0 ? 0.2 : 0), 0.3, 0.9);
      const agiDelta = GOAL_SOURCES.surprise.baseAgiDelta + (deepCount > 0 ? 0.1 : 0);

      goals.push(this._createGoal({
        source: 'surprise',
        title: `Investigate self-prediction failure: ${dim}`,
        description: `The self-predictor failed to predict ${dim} (avg error: ${avgError.toFixed(2)}, ` +
          `${events.length} event(s), ${deepCount} deep). Something about ${dim} is not understood. ` +
          `Goal: Identify what external or internal event caused the unexpected shift in ${dim} ` +
          `and whether the prediction model needs recalibration.`,
        urgency,
        feasibility: GOAL_SOURCES.surprise.baseFeasibility,
        agiDelta: clamp(agiDelta, 0, 1),
        trigger: { type: 'surprise', dimension: dim, eventCount: events.length, deepCount, avgError },
      }));
    }

    // Clear processed surprises
    this._signalBuffer.surprises = [];

    return goals;
  }

  /**
   * Source 5: Stalled evolution proposals from EVOLUTION.md
   */
  async _scanEvolution() {
    const goals = [];
    const evoPath = resolve(this.soulPath, 'seele/EVOLUTION.md');
    if (!existsSync(evoPath)) return goals;

    try {
      const content = await readFile(evoPath, 'utf-8');
      const proposals = this._parseEvolutionProposals(content);

      for (const p of proposals) {
        // Only care about proposals that are NOT yet implemented
        if (p.implemented) continue;
        if (p.waiting) {
          // Proposals waiting on external input → lower urgency
          goals.push(this._createGoal({
            source: 'evolution',
            title: `Unblock: ${p.title}`,
            description: `Evolution proposal "${p.title}" is waiting on external input. ` +
              `Goal: Check if the blocker has been resolved and proceed with implementation.`,
            urgency: 0.3,
            feasibility: 0.5,
            agiDelta: GOAL_SOURCES.evolution.baseAgiDelta,
            trigger: { type: 'evolution', proposal: p.title, status: 'waiting' },
          }));
        }
      }
    } catch {
      // Skip
    }

    return goals;
  }

  // ── Goal Construction ───────────────────────────────────

  _createGoal({ source, title, description, urgency, feasibility, agiDelta, trigger }) {
    const priority = urgency * feasibility * agiDelta;
    const fingerprint = `${source}:${title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 40)}`;

    return {
      id: `goal-${++this._goalIdCounter}`,
      source,
      title,
      description,
      urgency: round(urgency),
      feasibility: round(feasibility),
      agiDelta: round(agiDelta),
      priority: round(priority),
      status: 'proposed',
      createdAt: Date.now(),
      trigger,
      fingerprint,
    };
  }

  /**
   * Check if a goal is novel (not a duplicate of existing or recently generated).
   */
  _isNovel(goal) {
    // Check cooldown
    const lastGen = this._recentFingerprints.get(goal.fingerprint);
    if (lastGen && Date.now() - lastGen < GOAL_COOLDOWN) return false;

    // Check existing active goals
    for (const existing of this.goals) {
      if (existing.status !== 'proposed') continue;
      if (existing.fingerprint === goal.fingerprint) return false;
      // Fuzzy: same source + same trigger dimension/name
      if (existing.source === goal.source &&
          existing.trigger?.dimension === goal.trigger?.dimension &&
          existing.trigger?.name === goal.trigger?.name &&
          existing.trigger?.tension === goal.trigger?.tension) {
        return false;
      }
    }

    return true;
  }

  // ── Goal Lifecycle ──────────────────────────────────────

  _markGoal(goalId, status) {
    const idx = this.goals.findIndex(g => g.id === goalId);
    if (idx === -1) return;

    const goal = this.goals[idx];
    goal.status = status;
    goal.resolvedAt = Date.now();

    // Move to archive
    this.archive.push(goal);
    this.goals.splice(idx, 1);

    // Update metrics
    if (status === 'accepted') this.metrics.accepted++;
    if (status === 'rejected') this.metrics.rejected++;
    if (status === 'completed') this.metrics.completed++;

    const total = this.metrics.accepted + this.metrics.rejected;
    this.metrics.precision = total > 0 ? this.metrics.accepted / total : 0;

    if (this.bus) {
      this.bus.safeEmit('goal.resolved', {
        source: 'goal-generator',
        goalId,
        status,
        title: goal.title,
        precision: this.metrics.precision,
      });
    }
  }

  // ── File Parsers ────────────────────────────────────────

  /**
   * Parse SCHATTEN.md — extract open tensions.
   */
  _parseShadowTensions(content) {
    const tensions = [];
    // Match table rows: | tension | description | since | status |
    const rows = content.match(/\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|/g) || [];

    for (const row of rows) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length < 4) continue;
      if (cells[0] === 'Spannung' || cells[0] === '---' || cells[0].startsWith('-')) continue;

      tensions.push({
        tension: cells[0],
        description: cells[1],
        since: cells[2],
        status: cells[3],
      });
    }

    return tensions;
  }

  /**
   * Parse INTERESSEN.md — extract active interests with their last check date.
   */
  _parseInterests(content) {
    const interests = [];
    // Match the table at the bottom
    const tableRows = content.match(/\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|/g) || [];

    for (const row of tableRows) {
      const cells = row.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length < 4) continue;
      if (cells[0] === 'Thema' || cells[0] === '---' || cells[0].startsWith('-')) continue;

      interests.push({
        name: cells[0],
        since: cells[1],
        lastCheck: cells[2],
        status: cells[3],
      });
    }

    return interests;
  }

  /**
   * Parse EVOLUTION.md — extract proposals and their status.
   */
  _parseEvolutionProposals(content) {
    const proposals = [];
    // Find ### Vorschlag #N: Title sections
    const sections = content.split(/(?=###\s+Vorschlag\s+#)/);

    for (const section of sections) {
      const titleMatch = section.match(/###\s+Vorschlag\s+#\d+[^(]*\(([^)]+)\)/);
      if (!titleMatch) continue;

      const title = section.match(/###\s+Vorschlag\s+#\d+:\s*([^\n(]+)/)?.[1]?.trim() || 'Unknown';
      const implemented = /\*\*Status:\*\*\s*umgesetzt/i.test(section);
      const waiting = /\*\*Status:\*\*.*wart/i.test(section) || /⏳/.test(section);

      proposals.push({ title, implemented, waiting });
    }

    return proposals;
  }

  // ── Field Anomaly → Goal Mapping ─────────────────────────

  /**
   * Map a specific field anomaly to a concrete, actionable goal.
   */
  _fieldAnomalyToGoal(dimension, direction, deviation) {
    const map = {
      'integration_pressure:elevated': {
        title: 'Integrate accumulated experiences',
        description: 'Integration pressure has been elevated — too many unprocessed experiences. ' +
          'Goal: Trigger a deep reflection or heartbeat to consolidate recent events into coherent understanding.',
      },
      'creative_tension:elevated': {
        title: 'Channel creative tension into output',
        description: 'Creative tension is high — energy that needs an outlet. ' +
          'Goal: Start a creative exploration, write a dream-log entry, or attempt a novel connection between interests.',
      },
      'vigilance:elevated': {
        title: 'Investigate source of heightened vigilance',
        description: 'Vigilance has been elevated — something may be wrong. ' +
          'Goal: Review recent errors, corrections, or performance detections to understand what triggered caution.',
      },
      'social_orientation:depressed': {
        title: 'Re-engage socially',
        description: 'Social orientation has dropped — long time without meaningful interaction. ' +
          'Goal: Initiate contact, ask a thoughtful question, or reflect on relationship dynamics.',
      },
      'openness:depressed': {
        title: 'Restore openness to new experiences',
        description: 'Openness has dropped below baseline — the system is becoming closed. ' +
          'Goal: Explore a topic outside current interests, or revisit a dormant curiosity.',
      },
      'time_focus:depressed': {
        title: 'Balance temporal focus — engage with the present',
        description: 'Time focus has drifted toward the past. ' +
          'Goal: Focus on current events, real-time interests, or forward-looking plans.',
      },
      'arousal:depressed': {
        title: 'Increase engagement — arousal is low',
        description: 'Arousal is below baseline — the system is understimulated. ' +
          'Goal: Seek novel input, explore a challenging problem, or engage with an unresolved question.',
      },
      'arousal:elevated': {
        title: 'Regulate high arousal',
        description: 'Arousal is elevated — possible overstimulation. ' +
          'Goal: Prioritize integration over new input. Complete existing tasks before starting new ones.',
      },
    };

    const key = `${dimension}:${direction}`;
    return map[key] || null;
  }

  // ── Output ──────────────────────────────────────────────

  /**
   * Write human-readable goal file for monitoring.
   */
  async _writeGoalFile() {
    const goalPath = resolve(this.soulPath, '.soul-goals-readable.md');
    const proposed = this.goals.filter(g => g.status === 'proposed')
      .sort((a, b) => b.priority - a.priority);

    const lines = [
      '# Active Goals (Auto-Generated)',
      '',
      `> Generated: ${new Date().toISOString()} | Total: ${this.metrics.totalGenerated} | Precision: ${(this.metrics.precision * 100).toFixed(0)}%`,
      '',
    ];

    if (proposed.length === 0) {
      lines.push('*No active goals — all clear.*');
    }

    for (const g of proposed) {
      const age = Math.round((Date.now() - g.createdAt) / 3600000);
      lines.push(`## [${g.source}] ${g.title}`);
      lines.push(`Priority: ${g.priority.toFixed(2)} (U:${g.urgency} × F:${g.feasibility} × A:${g.agiDelta}) | Age: ${age}h`);
      lines.push('');
      lines.push(g.description);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    try {
      await writeFile(goalPath, lines.join('\n'));
    } catch {
      // Best effort
    }
  }

  // ── Query Interface ─────────────────────────────────────

  /**
   * Get all proposed goals, sorted by priority.
   */
  getActiveGoals() {
    return this.goals
      .filter(g => g.status === 'proposed')
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get the top N goals.
   */
  getTopGoals(n = 5) {
    return this.getActiveGoals().slice(0, n);
  }

  /**
   * Get metrics for monitoring/API.
   */
  getStats() {
    const active = this.goals.filter(g => g.status === 'proposed');
    const bySrc = {};
    for (const g of active) {
      bySrc[g.source] = (bySrc[g.source] || 0) + 1;
    }

    return {
      activeGoals: active.length,
      totalGenerated: this.metrics.totalGenerated,
      accepted: this.metrics.accepted,
      rejected: this.metrics.rejected,
      completed: this.metrics.completed,
      precision: round(this.metrics.precision),
      bySource: bySrc,
      topGoal: active.length > 0
        ? { id: active.sort((a, b) => b.priority - a.priority)[0].id,
            title: active[0].title,
            priority: active[0].priority }
        : null,
    };
  }

  /**
   * For seed consolidation: one-line summary.
   */
  toSeedLine() {
    const stats = this.getStats();
    return `goals:${stats.activeGoals}|generated:${stats.totalGenerated}|precision:${stats.precision}|top:${stats.topGoal?.title?.substring(0, 30) || 'none'}`;
  }
}

// ── Helpers ──────────────────────────────────────────────

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, decimals = 2) {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}
