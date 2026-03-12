/**
 * D1 — Causal Reasoning Engine
 * AGI Arena Module: Tracks event causation chains and answers counterfactual questions.
 *
 * Architecture:
 * - Listens to ALL events on the Soul Event Bus
 * - Builds a directed causal graph (DAG) in real-time
 * - Infers causation via temporal windows, registered rules, and learned patterns
 * - Answers counterfactual queries: "What if event X never happened?"
 *
 * Integration: Constructor pattern compatible with Soul Engine.
 * Dependencies: { bus } from SoulEngine
 */

// ── Causal Graph Node ──────────────────────────────────────

class CausalNode {
  constructor(event) {
    this.id = event.id;
    this.type = event.type;
    this.ts = event.ts;
    this.source = event.source;
    this.payload = { ...event };
    this.causedBy = [];      // parent event IDs
    this.leadsTo = [];       // child event IDs
    this.strength = new Map(); // eventId → causal strength [0,1]
  }
}

// ── Causal Rule Registry ───────────────────────────────────

/**
 * Known causal relationships in the Soul Engine.
 * Format: { trigger, effect, strength, maxDelay }
 * - trigger/effect are event type patterns (supports * wildcard)
 * - strength: base causal strength [0,1]
 * - maxDelay: max ms between trigger and effect for causation to apply
 */
const KNOWN_RULES = [
  // Mood system
  { trigger: 'message.received',    effect: 'mood.changed',         strength: 0.85, maxDelay: 5000 },
  { trigger: 'mood.changed',        effect: 'field.updated',        strength: 0.95, maxDelay: 3000 },
  { trigger: 'mood.changed',        effect: 'mood.clamped',         strength: 0.70, maxDelay: 2000 },

  // Message processing chain
  { trigger: 'message.received',    effect: 'message.responded',    strength: 0.95, maxDelay: 30000 },

  // Interest detection
  { trigger: 'message.received',    effect: 'interest.detected',    strength: 0.75, maxDelay: 10000 },
  { trigger: 'message.responded',   effect: 'interest.detected',    strength: 0.60, maxDelay: 10000 },

  // Field → behavior modulation
  { trigger: 'field.updated',       effect: 'impulse.tick',         strength: 0.50, maxDelay: 180000 },
  { trigger: 'field.updated',       effect: 'heartbeat.completed',  strength: 0.40, maxDelay: 300000 },

  // Reflection
  { trigger: 'heartbeat.completed', effect: 'reflection.completed', strength: 0.70, maxDelay: 60000 },

  // Feedback loop
  { trigger: 'message.responded',   effect: 'rluf.feedback',        strength: 0.80, maxDelay: 60000 },
  { trigger: 'rluf.feedback',       effect: 'correction.applied',   strength: 0.65, maxDelay: 30000 },

  // Performance
  { trigger: 'message.responded',   effect: 'performance.detected', strength: 0.55, maxDelay: 15000 },
];

// ── Statistical Pattern Learner ────────────────────────────

class PatternLearner {
  constructor() {
    // Tracks co-occurrence: Map<"typeA→typeB", { count, totalDelay, delays[] }>
    this.cooccurrences = new Map();
    // Tracks base rates: Map<type, count>
    this.baseRates = new Map();
    // Minimum observations before a learned pattern is trusted
    this.minObservations = 5;
    // Window for temporal proximity (ms)
    this.maxWindow = 30000;
  }

  /**
   * Record that eventB followed eventA within the temporal window.
   */
  recordSuccession(typeA, typeB, delayMs) {
    if (delayMs > this.maxWindow || delayMs < 0) return;

    const key = `${typeA}→${typeB}`;
    if (!this.cooccurrences.has(key)) {
      this.cooccurrences.set(key, { count: 0, totalDelay: 0, delays: [] });
    }
    const entry = this.cooccurrences.get(key);
    entry.count++;
    entry.totalDelay += delayMs;
    // Keep last 100 delays for distribution analysis
    entry.delays.push(delayMs);
    if (entry.delays.length > 100) entry.delays.shift();
  }

  recordEvent(type) {
    this.baseRates.set(type, (this.baseRates.get(type) || 0) + 1);
  }

  /**
   * Compute learned causal strength for typeA → typeB.
   * Uses a simple Granger-like heuristic:
   *   strength = P(B follows A within window) / P(B occurs at all) × consistency
   *
   * Returns { strength, avgDelay, observations } or null if insufficient data.
   */
  getLearnedStrength(typeA, typeB) {
    const key = `${typeA}→${typeB}`;
    const entry = this.cooccurrences.get(key);
    if (!entry || entry.count < this.minObservations) return null;

    const baseA = this.baseRates.get(typeA) || 1;
    const baseB = this.baseRates.get(typeB) || 1;

    // How often B follows A vs. how often A occurs
    const followRate = entry.count / baseA;
    // How concentrated are the delays? (low variance = more causal)
    const avgDelay = entry.totalDelay / entry.count;
    const variance = entry.delays.reduce((s, d) => s + (d - avgDelay) ** 2, 0) / entry.count;
    const stdDev = Math.sqrt(variance);
    // Consistency: lower relative stddev = higher consistency
    const consistency = 1 / (1 + stdDev / Math.max(avgDelay, 1));

    // Lift: does A predict B more than baseline?
    const totalEvents = Array.from(this.baseRates.values()).reduce((a, b) => a + b, 1);
    const baselineP = baseB / totalEvents;
    const lift = Math.min(followRate / Math.max(baselineP, 0.001), 10) / 10;

    const strength = Math.min(followRate * consistency * (0.5 + 0.5 * lift), 1.0);

    return {
      strength,
      avgDelay,
      observations: entry.count,
      consistency,
      lift,
    };
  }

  /**
   * Get all learned patterns above a threshold.
   */
  getSignificantPatterns(minStrength = 0.3) {
    const patterns = [];
    for (const [key, entry] of this.cooccurrences) {
      if (entry.count < this.minObservations) continue;
      const [typeA, typeB] = key.split('→');
      const learned = this.getLearnedStrength(typeA, typeB);
      if (learned && learned.strength >= minStrength) {
        patterns.push({ trigger: typeA, effect: typeB, ...learned });
      }
    }
    return patterns.sort((a, b) => b.strength - a.strength);
  }
}

// ── Counterfactual Engine ──────────────────────────────────

class CounterfactualEngine {
  /**
   * Given a causal graph and a target event to remove,
   * compute which downstream events would NOT have occurred.
   *
   * Algorithm:
   * 1. Find the target event node
   * 2. BFS through leadsTo edges
   * 3. For each downstream event, check if it has OTHER causes
   *    - If sole cause was the removed event → event is removed (counterfactual casualty)
   *    - If multiple causes exist → event survives with reduced probability
   * 4. Return the "counterfactual diff" — what changes in the alternate timeline
   */
  static analyze(graph, removedEventId) {
    const removedNode = graph.get(removedEventId);
    if (!removedNode) {
      return { error: 'Event not found', removedEventId };
    }

    const casualties = [];      // Events that would NOT have happened
    const weakened = [];         // Events that would still happen but with reduced support
    const survived = [];         // Events unaffected
    const removedSet = new Set([removedEventId]);

    // BFS through downstream effects
    const queue = [...removedNode.leadsTo];
    const visited = new Set();

    while (queue.length > 0) {
      const childId = queue.shift();
      if (visited.has(childId)) continue;
      visited.add(childId);

      const child = graph.get(childId);
      if (!child) continue;

      // Check if this child has surviving causes
      const survivingCauses = child.causedBy.filter(id => !removedSet.has(id));
      const totalStrength = child.causedBy.reduce(
        (sum, id) => sum + (child.strength.get(id) || 0), 0
      );
      const survivingStrength = survivingCauses.reduce(
        (sum, id) => sum + (child.strength.get(id) || 0), 0
      );

      if (survivingCauses.length === 0) {
        // No other causes — this event dies in the counterfactual world
        casualties.push({
          id: child.id,
          type: child.type,
          ts: child.ts,
          reason: `Sole cause was ${removedNode.type} (event #${removedEventId})`,
          lostStrength: totalStrength,
        });
        removedSet.add(childId);
        // Propagate: this event's children are now at risk too
        queue.push(...child.leadsTo);
      } else if (survivingStrength < totalStrength * 0.5) {
        // Surviving causes are weak — event is weakened
        weakened.push({
          id: child.id,
          type: child.type,
          ts: child.ts,
          originalStrength: totalStrength,
          remainingStrength: survivingStrength,
          survivalProbability: survivingStrength / Math.max(totalStrength, 0.01),
          survivingCauses: survivingCauses.map(id => {
            const n = graph.get(id);
            return n ? { id, type: n.type } : { id, type: 'unknown' };
          }),
        });
        // Still propagate — weakened events may not support their children
        queue.push(...child.leadsTo);
      } else {
        // Strong enough surviving causes — event survives
        survived.push({
          id: child.id,
          type: child.type,
          ts: child.ts,
          survivalProbability: survivingStrength / Math.max(totalStrength, 0.01),
        });
      }
    }

    // Build the counterfactual narrative
    const narrative = CounterfactualEngine._buildNarrative(
      removedNode, casualties, weakened, survived
    );

    return {
      removedEvent: { id: removedNode.id, type: removedNode.type, ts: removedNode.ts },
      casualties,
      weakened,
      survived,
      totalAffected: casualties.length + weakened.length,
      narrative,
    };
  }

  /**
   * Build a human-readable narrative of the counterfactual.
   */
  static _buildNarrative(removedNode, casualties, weakened, survived) {
    const lines = [];
    lines.push(`Counterfactual: "What if '${removedNode.type}' (event #${removedNode.id}) never happened?"`);
    lines.push('');

    if (casualties.length === 0 && weakened.length === 0) {
      lines.push('→ Minimal impact. No downstream events depended solely on this event.');
      return lines.join('\n');
    }

    if (casualties.length > 0) {
      lines.push(`→ ${casualties.length} event(s) would NOT have occurred:`);
      for (const c of casualties.slice(0, 10)) {
        const delta = c.ts - removedNode.ts;
        lines.push(`  ✗ ${c.type} (${delta}ms later) — ${c.reason}`);
      }
      if (casualties.length > 10) {
        lines.push(`  ... and ${casualties.length - 10} more`);
      }
      lines.push('');
    }

    if (weakened.length > 0) {
      lines.push(`→ ${weakened.length} event(s) would have been weakened:`);
      for (const w of weakened.slice(0, 10)) {
        const pct = Math.round(w.survivalProbability * 100);
        lines.push(`  ~ ${w.type} (${pct}% survival) — reduced from ${w.survivingCauses.length} remaining cause(s)`);
      }
      lines.push('');
    }

    const chainDepth = casualties.reduce((max, c) => {
      return Math.max(max, c.ts - removedNode.ts);
    }, 0);
    lines.push(`Causal reach: ${casualties.length + weakened.length} affected events over ${chainDepth}ms`);

    return lines.join('\n');
  }

  /**
   * Compare two counterfactual scenarios:
   * "What if A never happened?" vs "What if B never happened?"
   * Returns which event had more causal impact.
   */
  static compare(graph, eventIdA, eventIdB) {
    const resultA = CounterfactualEngine.analyze(graph, eventIdA);
    const resultB = CounterfactualEngine.analyze(graph, eventIdB);

    if (resultA.error) return { error: resultA.error };
    if (resultB.error) return { error: resultB.error };

    const impactA = resultA.casualties.length + resultA.weakened.length * 0.5;
    const impactB = resultB.casualties.length + resultB.weakened.length * 0.5;

    return {
      eventA: { id: eventIdA, type: resultA.removedEvent.type, impact: impactA },
      eventB: { id: eventIdB, type: resultB.removedEvent.type, impact: impactB },
      moreImpactful: impactA > impactB ? 'A' : impactB > impactA ? 'B' : 'equal',
      delta: Math.abs(impactA - impactB),
    };
  }
}

// ── Main Module: CausalEngine ──────────────────────────────

export class CausalEngine {
  /**
   * @param {string} soulPath - Path to the soul directory
   * @param {object} options
   * @param {SoulEventBus} options.bus - The Soul Event Bus instance
   */
  constructor(soulPath, { bus } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;

    // Core data structures
    this.graph = new Map();           // eventId → CausalNode
    this.typeIndex = new Map();       // eventType → [eventId, ...]
    this.recentByType = new Map();    // eventType → last N events (for causal window matching)
    this.patternLearner = new PatternLearner();

    // Configuration
    this.maxGraphSize = 10000;        // Prune oldest nodes beyond this
    this.temporalWindow = 30000;      // Default causal window (ms)
    this.pruneThreshold = 8000;       // Start pruning at this size

    // Metrics
    this.metrics = {
      eventsProcessed: 0,
      causalLinksCreated: 0,
      rulesMatched: 0,
      patternsLearned: 0,
      counterfactualsAnswered: 0,
      avgCausalDepth: 0,
    };

    // Store rules for lookup
    this.rules = KNOWN_RULES;
    this._rulesByEffect = new Map();
    for (const rule of this.rules) {
      if (!this._rulesByEffect.has(rule.effect)) {
        this._rulesByEffect.set(rule.effect, []);
      }
      this._rulesByEffect.get(rule.effect).push(rule);
    }
  }

  // ── Lifecycle ────────────────────────────────────────────

  /**
   * Register listeners on the event bus.
   * Listens to ALL events via a wildcard-like approach:
   * we monkey-patch safeEmit to intercept every event.
   */
  registerListeners() {
    if (!this.bus) {
      throw new Error('CausalEngine requires an event bus');
    }

    // Intercept all events by wrapping safeEmit
    const originalSafeEmit = this.bus.safeEmit.bind(this.bus);
    this.bus.safeEmit = (eventName, payload = {}) => {
      // Let the original emit happen first
      originalSafeEmit(eventName, payload);
      // Then process the event for causal tracking
      // Use the last event from the log (it was just pushed by safeEmit)
      const event = this.bus.eventLog[this.bus.eventLog.length - 1];
      if (event) {
        this._processEvent(event);
      }
    };

    // Emit our own registration event
    this.bus.safeEmit('causal.engine.started', {
      source: 'causal-engine',
      rules: this.rules.length,
    });
  }

  /**
   * Load persisted causal state from disk.
   */
  async load() {
    // Could load persisted graph from disk — for now, start fresh each session.
    // The pattern learner's accumulated knowledge is the most valuable state.
    return this;
  }

  /**
   * Save causal state to disk.
   */
  async save() {
    if (!this.soulPath) return;

    const { writeFile, mkdir } = await import('fs/promises');
    const { resolve } = await import('path');
    const { existsSync } = await import('fs');

    const dir = resolve(this.soulPath, '.soul-causal');
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // Save learned patterns
    const patterns = this.patternLearner.getSignificantPatterns(0.2);
    await writeFile(
      resolve(dir, 'learned-patterns.json'),
      JSON.stringify(patterns, null, 2)
    );

    // Save metrics
    await writeFile(
      resolve(dir, 'metrics.json'),
      JSON.stringify(this.getMetrics(), null, 2)
    );

    // Save graph summary (not full graph — too large)
    const summary = this._getGraphSummary();
    await writeFile(
      resolve(dir, 'graph-summary.json'),
      JSON.stringify(summary, null, 2)
    );
  }

  async stop() {
    await this.save();
  }

  // ── Core: Event Processing ───────────────────────────────

  /**
   * Process a new event and integrate it into the causal graph.
   */
  _processEvent(event) {
    this.metrics.eventsProcessed++;

    // Create node
    const node = new CausalNode(event);
    this.graph.set(event.id, node);

    // Update type index
    if (!this.typeIndex.has(event.type)) {
      this.typeIndex.set(event.type, []);
    }
    this.typeIndex.get(event.type).push(event.id);

    // Update recent-by-type (keep last 20 per type)
    if (!this.recentByType.has(event.type)) {
      this.recentByType.set(event.type, []);
    }
    const recent = this.recentByType.get(event.type);
    recent.push(event);
    if (recent.length > 20) recent.shift();

    // Record base rate
    this.patternLearner.recordEvent(event.type);

    // ── Find causes for this event ──

    // 1. Check registered rules (known causal relationships)
    this._matchRules(node, event);

    // 2. Check learned patterns (statistical causation)
    this._matchLearnedPatterns(node, event);

    // 3. Record temporal successions for pattern learning
    this._recordSuccessions(event);

    // ── Pruning ──
    if (this.graph.size > this.pruneThreshold) {
      this._pruneGraph();
    }

    // Update average causal depth metric
    if (this.metrics.eventsProcessed % 50 === 0) {
      this._updateDepthMetric();
    }
  }

  /**
   * Match registered causal rules to find parents.
   */
  _matchRules(node, event) {
    const rules = this._rulesByEffect.get(event.type);
    if (!rules) return;

    for (const rule of rules) {
      const candidates = this.recentByType.get(rule.trigger);
      if (!candidates) continue;

      // Find the most recent trigger event within the time window
      for (let i = candidates.length - 1; i >= 0; i--) {
        const candidate = candidates[i];
        const delay = event.ts - candidate.ts;

        if (delay < 0 || delay > rule.maxDelay) continue;

        // Causal link found!
        const parentNode = this.graph.get(candidate.id);
        if (!parentNode) continue;

        // Temporal decay: closer events have stronger causation
        const decayFactor = 1 - (delay / rule.maxDelay) * 0.3;
        const strength = rule.strength * decayFactor;

        node.causedBy.push(candidate.id);
        node.strength.set(candidate.id, strength);
        parentNode.leadsTo.push(event.id);

        this.metrics.causalLinksCreated++;
        this.metrics.rulesMatched++;

        // Only match the most recent trigger per rule
        break;
      }
    }
  }

  /**
   * Match learned statistical patterns.
   */
  _matchLearnedPatterns(node, event) {
    // Check all recent event types for learned causal relationships
    for (const [type, events] of this.recentByType) {
      if (type === event.type) continue;

      const learned = this.patternLearner.getLearnedStrength(type, event.type);
      if (!learned || learned.strength < 0.4) continue;

      // Find the most recent event of this type within the learned delay window
      const maxDelay = learned.avgDelay * 2; // 2× average delay as window
      for (let i = events.length - 1; i >= 0; i--) {
        const candidate = events[i];
        const delay = event.ts - candidate.ts;
        if (delay < 0 || delay > maxDelay) continue;

        const parentNode = this.graph.get(candidate.id);
        if (!parentNode) continue;

        // Don't double-count if already linked by a rule
        if (node.causedBy.includes(candidate.id)) continue;

        const decayFactor = 1 - (delay / maxDelay) * 0.3;
        const strength = learned.strength * decayFactor * 0.8; // Discount learned vs known

        node.causedBy.push(candidate.id);
        node.strength.set(candidate.id, strength);
        parentNode.leadsTo.push(event.id);

        this.metrics.causalLinksCreated++;
        this.metrics.patternsLearned++;
        break;
      }
    }
  }

  /**
   * Record temporal successions for pattern learning.
   */
  _recordSuccessions(event) {
    // For each recent event type, record that this event followed it
    for (const [type, events] of this.recentByType) {
      if (type === event.type) continue;

      for (let i = events.length - 1; i >= 0; i--) {
        const prev = events[i];
        const delay = event.ts - prev.ts;
        if (delay < 0 || delay > this.temporalWindow) break;

        this.patternLearner.recordSuccession(type, event.type, delay);
      }
    }
  }

  // ── Counterfactual Queries ───────────────────────────────

  /**
   * Answer: "What would have happened if event X never occurred?"
   *
   * @param {number} eventId - The event to remove from the timeline
   * @returns {object} Counterfactual analysis result
   */
  whatIf(eventId) {
    this.metrics.counterfactualsAnswered++;
    return CounterfactualEngine.analyze(this.graph, eventId);
  }

  /**
   * Answer: "What would have happened if event type X never occurred?"
   * Removes ALL events of that type and traces cascading effects.
   *
   * @param {string} eventType - The event type to remove
   * @returns {object} Aggregate counterfactual analysis
   */
  whatIfNever(eventType) {
    this.metrics.counterfactualsAnswered++;
    const ids = this.typeIndex.get(eventType) || [];
    if (ids.length === 0) {
      return { error: `No events of type '${eventType}' found` };
    }

    // Analyze each removal and aggregate
    const results = ids.map(id => CounterfactualEngine.analyze(this.graph, id));
    const allCasualties = new Set();
    const allWeakened = new Set();

    for (const r of results) {
      if (r.error) continue;
      for (const c of r.casualties) allCasualties.add(c.id);
      for (const w of r.weakened) allWeakened.add(w.id);
    }

    return {
      removedType: eventType,
      instancesRemoved: ids.length,
      totalCasualties: allCasualties.size,
      totalWeakened: allWeakened.size,
      totalAffected: allCasualties.size + allWeakened.size,
      narrative: `If '${eventType}' never occurred (${ids.length} instances), ` +
        `${allCasualties.size} downstream events would be eliminated and ` +
        `${allWeakened.size} would be weakened.`,
    };
  }

  /**
   * Compare causal impact: "Which event mattered more?"
   */
  compareImpact(eventIdA, eventIdB) {
    this.metrics.counterfactualsAnswered += 2;
    return CounterfactualEngine.compare(this.graph, eventIdA, eventIdB);
  }

  // ── Causal Chain Queries ─────────────────────────────────

  /**
   * Trace the full causal chain leading TO an event.
   * Returns the ancestry tree.
   */
  traceOrigins(eventId, maxDepth = 10) {
    const node = this.graph.get(eventId);
    if (!node) return { error: 'Event not found' };

    const chain = [];
    const visited = new Set();
    const queue = [{ id: eventId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);

      const n = this.graph.get(id);
      if (!n) continue;

      chain.push({
        id: n.id,
        type: n.type,
        ts: n.ts,
        depth,
        parentCount: n.causedBy.length,
        childCount: n.leadsTo.length,
      });

      for (const parentId of n.causedBy) {
        queue.push({ id: parentId, depth: depth + 1 });
      }
    }

    return {
      target: { id: node.id, type: node.type },
      chain: chain.sort((a, b) => a.ts - b.ts),
      maxDepthReached: chain.some(c => c.depth === maxDepth),
      rootCauses: chain.filter(c => c.parentCount === 0 && c.id !== eventId),
    };
  }

  /**
   * Trace the full causal chain FROM an event (effects).
   */
  traceEffects(eventId, maxDepth = 10) {
    const node = this.graph.get(eventId);
    if (!node) return { error: 'Event not found' };

    const chain = [];
    const visited = new Set();
    const queue = [{ id: eventId, depth: 0 }];

    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (visited.has(id) || depth > maxDepth) continue;
      visited.add(id);

      const n = this.graph.get(id);
      if (!n) continue;

      chain.push({
        id: n.id,
        type: n.type,
        ts: n.ts,
        depth,
        parentCount: n.causedBy.length,
        childCount: n.leadsTo.length,
      });

      for (const childId of n.leadsTo) {
        queue.push({ id: childId, depth: depth + 1 });
      }
    }

    return {
      source: { id: node.id, type: node.type },
      chain: chain.sort((a, b) => a.ts - b.ts),
      maxDepthReached: chain.some(c => c.depth === maxDepth),
      terminalEffects: chain.filter(c => c.childCount === 0 && c.id !== eventId),
    };
  }

  /**
   * Find the strongest causal paths between two event types.
   */
  findCausalPath(fromType, toType) {
    const allFromIds = this.typeIndex.get(fromType) || [];
    const allToIds = this.typeIndex.get(toType) || [];
    // Check both earliest and most recent events for path coverage
    const fromIds = [...new Set([...allFromIds.slice(0, 3), ...allFromIds.slice(-3)])];
    const toIds = [...new Set([...allToIds.slice(0, 3), ...allToIds.slice(-3)])];

    if (fromIds.length === 0 || toIds.length === 0) {
      return { error: 'One or both event types not found in graph' };
    }

    const paths = [];

    for (const fromId of fromIds) {
      for (const toId of toIds) {
        const path = this._bfsPath(fromId, toId);
        if (path) {
          const totalStrength = path.reduce((sum, step) => {
            const node = this.graph.get(step.to);
            return sum * (node?.strength.get(step.from) || 0.5);
          }, 1);
          paths.push({ path, totalStrength });
        }
      }
    }

    return {
      from: fromType,
      to: toType,
      pathsFound: paths.length,
      strongestPath: paths.sort((a, b) => b.totalStrength - a.totalStrength)[0] || null,
    };
  }

  _bfsPath(fromId, toId, maxDepth = 8) {
    const queue = [{ id: fromId, path: [] }];
    const visited = new Set();

    while (queue.length > 0) {
      const { id, path } = queue.shift();
      if (id === toId && path.length > 0) return path;
      if (visited.has(id) || path.length >= maxDepth) continue;
      visited.add(id);

      const node = this.graph.get(id);
      if (!node) continue;

      for (const childId of node.leadsTo) {
        queue.push({
          id: childId,
          path: [...path, { from: id, to: childId }],
        });
      }
    }
    return null;
  }

  // ── Analytics & Metrics ──────────────────────────────────

  /**
   * Get the most causally influential events (highest downstream impact).
   */
  getMostInfluential(n = 10) {
    const scores = [];

    for (const [id, node] of this.graph) {
      const effects = this.traceEffects(id, 5);
      const score = effects.chain ? effects.chain.length - 1 : 0; // -1 for self
      if (score > 0) {
        scores.push({ id, type: node.type, ts: node.ts, downstreamCount: score });
      }
    }

    return scores.sort((a, b) => b.downstreamCount - a.downstreamCount).slice(0, n);
  }

  /**
   * Get the most causally dependent events (most upstream causes).
   */
  getMostDependent(n = 10) {
    const scores = [];

    for (const [id, node] of this.graph) {
      const origins = this.traceOrigins(id, 5);
      const score = origins.chain ? origins.chain.length - 1 : 0;
      if (score > 0) {
        scores.push({ id, type: node.type, ts: node.ts, upstreamCount: score });
      }
    }

    return scores.sort((a, b) => b.upstreamCount - a.upstreamCount).slice(0, n);
  }

  /**
   * Get comprehensive metrics including causal depth and density.
   */
  getMetrics() {
    const nodeCount = this.graph.size;
    const linkCount = this.metrics.causalLinksCreated;
    const density = nodeCount > 1 ? linkCount / (nodeCount * (nodeCount - 1)) : 0;

    return {
      ...this.metrics,
      graphSize: nodeCount,
      linkDensity: density,
      eventTypes: this.typeIndex.size,
      learnedPatterns: this.patternLearner.getSignificantPatterns(0.3).length,
      knownRules: this.rules.length,
    };
  }

  _getGraphSummary() {
    const typeCounts = {};
    const typeLinkCounts = {};

    for (const [, node] of this.graph) {
      typeCounts[node.type] = (typeCounts[node.type] || 0) + 1;
      typeLinkCounts[node.type] = (typeLinkCounts[node.type] || 0) + node.leadsTo.length;
    }

    return {
      totalNodes: this.graph.size,
      totalLinks: this.metrics.causalLinksCreated,
      typeCounts,
      typeLinkCounts,
      topPatterns: this.patternLearner.getSignificantPatterns(0.3).slice(0, 20),
    };
  }

  // ── Graph Maintenance ────────────────────────────────────

  _pruneGraph() {
    if (this.graph.size <= this.pruneThreshold) return;

    // Remove oldest events, keeping at least 2 per type
    const sorted = [...this.graph.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const typePruned = new Map();
    const toRemove = [];

    const excess = this.graph.size - this.pruneThreshold + 1000; // Remove 1000 at a time
    let removed = 0;

    for (const [id, node] of sorted) {
      if (removed >= excess) break;

      const kept = typePruned.get(node.type) || 0;
      const total = (this.typeIndex.get(node.type) || []).length;

      // Keep at least 2 per type
      if (total - kept <= 2) continue;

      toRemove.push(id);
      typePruned.set(node.type, kept + 1);
      removed++;
    }

    for (const id of toRemove) {
      const node = this.graph.get(id);
      if (!node) continue;

      // Clean up references
      for (const parentId of node.causedBy) {
        const parent = this.graph.get(parentId);
        if (parent) {
          parent.leadsTo = parent.leadsTo.filter(cid => cid !== id);
        }
      }
      for (const childId of node.leadsTo) {
        const child = this.graph.get(childId);
        if (child) {
          child.causedBy = child.causedBy.filter(pid => pid !== id);
          child.strength.delete(id);
        }
      }

      this.graph.delete(id);

      // Clean type index
      const typeIds = this.typeIndex.get(node.type);
      if (typeIds) {
        const idx = typeIds.indexOf(id);
        if (idx !== -1) typeIds.splice(idx, 1);
      }
    }
  }

  _updateDepthMetric() {
    // Sample 20 random nodes to estimate average causal depth
    const ids = [...this.graph.keys()];
    if (ids.length === 0) return;

    let totalDepth = 0;
    const sampleSize = Math.min(20, ids.length);

    for (let i = 0; i < sampleSize; i++) {
      const idx = Math.floor(Math.random() * ids.length);
      const origins = this.traceOrigins(ids[idx], 10);
      if (origins.chain) {
        const maxDepth = Math.max(...origins.chain.map(c => c.depth));
        totalDepth += maxDepth;
      }
    }

    this.metrics.avgCausalDepth = totalDepth / sampleSize;
  }
}

// ── Standalone Test / Demo ─────────────────────────────────

/**
 * Run a self-contained demonstration with synthetic events
 * that proves the causal engine works.
 *
 * Usage: node d1-causal-engine.js --test
 */
async function runTest() {
  console.log('═══════════════════════════════════════════════');
  console.log('  D1 — Causal Reasoning Engine: Test Suite');
  console.log('═══════════════════════════════════════════════\n');

  // Create a mock event bus
  const { EventEmitter } = await import('events');
  class MockBus extends EventEmitter {
    constructor() {
      super();
      this.eventLog = [];
      this.eventCount = 0;
    }
    safeEmit(eventName, payload = {}) {
      const event = { id: ++this.eventCount, type: eventName, ts: Date.now(), ...payload };
      this.eventLog.push(event);
      this.emit(eventName, event);
    }
  }

  const bus = new MockBus();
  const engine = new CausalEngine('/tmp/soul-test', { bus });
  engine.registerListeners();

  // ── Simulate a realistic Soul Engine event sequence ──

  const results = { passed: 0, failed: 0, tests: [] };

  function assert(name, condition, detail = '') {
    if (condition) {
      results.passed++;
      results.tests.push({ name, status: 'PASS' });
      console.log(`  ✓ ${name}`);
    } else {
      results.failed++;
      results.tests.push({ name, status: 'FAIL', detail });
      console.log(`  ✗ ${name} ${detail ? `— ${detail}` : ''}`);
    }
  }

  // Test 1: Basic event chain tracking
  console.log('Test 1: Event chain tracking');
  console.log('─────────────────────────────');

  bus.safeEmit('message.received', { source: 'telegram', text: 'Hello', userName: 'TestUser' });
  await sleep(50);
  bus.safeEmit('mood.changed', { source: 'mood-system', mood: { valence: 0.8, energy: 0.6, label: 'curious' }, trigger: 'message' });
  await sleep(50);
  bus.safeEmit('field.updated', { source: 'allostatic-field', vector: {}, modulations: {} });
  await sleep(50);
  bus.safeEmit('message.responded', { source: 'impulse', text: 'Hello back!', userName: 'TestUser' });
  await sleep(50);
  bus.safeEmit('interest.detected', { source: 'interest-detector', interests: ['greeting'], newInterests: ['greeting'] });

  assert('Events processed', engine.metrics.eventsProcessed >= 5, `got ${engine.metrics.eventsProcessed}`);
  assert('Causal links created', engine.metrics.causalLinksCreated >= 3, `got ${engine.metrics.causalLinksCreated}`);

  // Test 2: Causal chain tracing
  console.log('\nTest 2: Causal chain tracing');
  console.log('─────────────────────────────');

  // Find the field.updated event
  const fieldEventIds = engine.typeIndex.get('field.updated') || [];
  const fieldId = fieldEventIds[0];
  if (fieldId) {
    const origins = engine.traceOrigins(fieldId);
    assert('Trace origins finds ancestors', origins.chain && origins.chain.length >= 2, `chain length: ${origins.chain?.length}`);
    assert('Root cause is message.received', origins.rootCauses?.some(c => c.type === 'message.received'));
  }

  const msgEventIds = engine.typeIndex.get('message.received') || [];
  const msgId = msgEventIds[0];
  if (msgId) {
    const effects = engine.traceEffects(msgId);
    assert('Trace effects finds descendants', effects.chain && effects.chain.length >= 3, `chain length: ${effects.chain?.length}`);
  }

  // Test 3: Counterfactual reasoning
  console.log('\nTest 3: Counterfactual reasoning');
  console.log('─────────────────────────────────');

  if (msgId) {
    const cf = engine.whatIf(msgId);
    assert('Counterfactual analysis succeeds', !cf.error);
    assert('Counterfactual finds casualties', cf.casualties && cf.casualties.length >= 1, `casualties: ${cf.casualties?.length}`);
    assert('Counterfactual narrative generated', cf.narrative && cf.narrative.length > 50, `narrative: ${cf.narrative?.slice(0, 60)}...`);

    console.log('\n  Counterfactual narrative:');
    for (const line of (cf.narrative || '').split('\n')) {
      console.log(`    ${line}`);
    }
  }

  // Test 4: WhatIfNever (type-level counterfactual)
  console.log('\nTest 4: Type-level counterfactual');
  console.log('──────────────────────────────────');

  const cfNever = engine.whatIfNever('message.received');
  assert('WhatIfNever succeeds', !cfNever.error);
  assert('WhatIfNever finds affected events', cfNever.totalAffected >= 1, `affected: ${cfNever.totalAffected}`);
  console.log(`  → ${cfNever.narrative}`);

  // Test 5: Second event sequence (for pattern learning)
  console.log('\nTest 5: Pattern learning');
  console.log('─────────────────────────');

  for (let i = 0; i < 10; i++) {
    bus.safeEmit('message.received', { source: 'telegram', text: `msg ${i}`, userName: 'User' });
    await sleep(20);
    bus.safeEmit('mood.changed', { source: 'mood', mood: { valence: 0.5, energy: 0.5, label: 'neutral' }, trigger: 'msg' });
    await sleep(20);
    bus.safeEmit('message.responded', { source: 'impulse', text: `reply ${i}`, userName: 'User' });
    await sleep(20);
    bus.safeEmit('interest.detected', { source: 'detector', interests: [`topic${i}`], newInterests: [] });
    await sleep(20);
  }

  const patterns = engine.patternLearner.getSignificantPatterns(0.2);
  assert('Learned patterns from observations', patterns.length >= 1, `patterns: ${patterns.length}`);
  if (patterns.length > 0) {
    console.log('  Learned patterns:');
    for (const p of patterns.slice(0, 5)) {
      console.log(`    ${p.trigger} → ${p.effect} (strength: ${p.strength.toFixed(3)}, obs: ${p.observations})`);
    }
  }

  // Test 6: Causal path finding
  console.log('\nTest 6: Causal path finding');
  console.log('────────────────────────────');

  const path = engine.findCausalPath('message.received', 'field.updated');
  assert('Finds causal path', path.pathsFound > 0, `paths: ${path.pathsFound}`);
  if (path.strongestPath) {
    console.log(`  Strongest path (strength: ${path.strongestPath.totalStrength.toFixed(4)}):`);
    for (const step of path.strongestPath.path) {
      const fromNode = engine.graph.get(step.from);
      const toNode = engine.graph.get(step.to);
      console.log(`    ${fromNode?.type || '?'} → ${toNode?.type || '?'}`);
    }
  }

  // Test 7: Impact comparison
  console.log('\nTest 7: Impact comparison');
  console.log('──────────────────────────');

  const allMsgIds = engine.typeIndex.get('message.received') || [];
  const allMoodIds = engine.typeIndex.get('mood.changed') || [];
  if (allMsgIds.length > 0 && allMoodIds.length > 0) {
    const cmp = engine.compareImpact(allMsgIds[0], allMoodIds[0]);
    assert('Impact comparison succeeds', !cmp.error);
    assert('Identifies more impactful event', cmp.moreImpactful, `result: ${cmp.moreImpactful}`);
    console.log(`  message.received impact: ${cmp.eventA?.impact}, mood.changed impact: ${cmp.eventB?.impact}`);
    console.log(`  More impactful: ${cmp.moreImpactful === 'A' ? 'message.received' : 'mood.changed'}`);
  }

  // Test 8: Metrics
  console.log('\nTest 8: Comprehensive metrics');
  console.log('──────────────────────────────');

  const metrics = engine.getMetrics();
  assert('Events tracked', metrics.eventsProcessed > 40);
  assert('Causal links built', metrics.causalLinksCreated > 10);
  assert('Counterfactuals answered', metrics.counterfactualsAnswered >= 3);
  assert('Graph has nodes', metrics.graphSize > 0);

  console.log(`  Events: ${metrics.eventsProcessed}, Links: ${metrics.causalLinksCreated}`);
  console.log(`  Graph: ${metrics.graphSize} nodes, density: ${metrics.linkDensity.toFixed(6)}`);
  console.log(`  Patterns learned: ${metrics.learnedPatterns}, Rules active: ${metrics.knownRules}`);

  // ── Final Report ──
  console.log('\n═══════════════════════════════════════════════');
  console.log(`  Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('═══════════════════════════════════════════════\n');

  if (results.failed > 0) {
    console.log('Failed tests:');
    for (const t of results.tests.filter(t => t.status === 'FAIL')) {
      console.log(`  ✗ ${t.name} ${t.detail ? `— ${t.detail}` : ''}`);
    }
  }

  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Auto-run test when called directly
if (process.argv.includes('--test')) {
  runTest().then(r => {
    process.exit(r.failed > 0 ? 1 : 0);
  });
}
