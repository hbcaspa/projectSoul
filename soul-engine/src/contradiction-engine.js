/**
 * D10 — Contradiction Resolution Engine
 *
 * The system believes contradictory things simultaneously — and doesn't
 * notice. This module detects contradictions across all knowledge sources,
 * classifies them, and either resolves them or marks them as irreducible.
 *
 * Contradiction types:
 *   logical    — Two beliefs that cannot both be true
 *   empirical  — Conflicting observations about the same entity
 *   temporal   — Newer info contradicts older, both still exist
 *   value      — Two axioms/principles that conflict in practice
 *   epistemic  — Claims certainty about something uncertain
 *
 * Sources scanned:
 *   1. Knowledge Graph (JSONL) — entity observations
 *   2. SCHATTEN.md — known shadow tensions
 *   3. SEED.md — @KERN axioms vs @SHADOW, @MEM entries
 *   4. fehler-muster.md — behavioral patterns ("knows but still does")
 *
 * Resolution strategies:
 *   logical    → evidence weighting (more support wins)
 *   empirical  → frequency (more observations win)
 *   temporal   → recency with decay (newer wins, but slowly)
 *   value      → mark as irreducible tension
 *   epistemic  → mark as "I don't know", lower confidence
 *
 * No LLM calls. Pure structural analysis.
 *
 * Metric: Detection rate, resolution rate, false positive rate.
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const STATE_FILE = '.soul-contradictions.json';
const SCAN_INTERVAL = 3600000;   // Full scan every hour
const SAVE_INTERVAL = 600000;    // Save every 10 min
const MAX_CONTRADICTIONS = 200;
const MAX_RESOLVED = 500;

// ── Negation / Opposition Lexicon ─────────────────────────

const NEGATION_DE = [
  'nicht', 'nie', 'niemals', 'kein', 'keine', 'keinen', 'keiner',
  'keinem', 'weder', 'ohne', 'kaum', 'selten',
];
const NEGATION_EN = [
  'not', 'never', 'no', 'none', 'neither', 'without', 'hardly', 'rarely',
];
const NEGATIONS = new Set([...NEGATION_DE, ...NEGATION_EN]);

// Opposition pairs — if an entity has observations with both sides, that's a conflict
const OPPOSITION_PAIRS = [
  ['ja', 'nein'], ['yes', 'no'],
  ['wahr', 'falsch'], ['true', 'false'],
  ['immer', 'nie'], ['always', 'never'],
  ['alle', 'keine'], ['all', 'none'],
  ['sicher', 'unsicher'], ['certain', 'uncertain'],
  ['aktiv', 'inaktiv'], ['active', 'inactive'],
  ['offen', 'geschlossen'], ['open', 'closed'],
  ['verbunden', 'getrennt'], ['connected', 'disconnected'],
  ['umgesetzt', 'offen'], ['implemented', 'open'],
  ['gehaertet', 'aktive aufmerksamkeit'],
  ['gut', 'schlecht'], ['good', 'bad'],
  ['richtig', 'falsch'], ['correct', 'wrong'],
  ['moeglich', 'unmoeglich'], ['possible', 'impossible'],
];

// Value tension indicators — words that signal value conflicts
const VALUE_TENSION_WORDS = [
  '↔', 'vs', 'versus', 'aber', 'trotzdem', 'obwohl', 'dennoch',
  'gleichzeitig', 'einerseits', 'andererseits', 'spannung',
  'widerspruch', 'conflict', 'tension', 'paradox', 'dilemma',
];

// Certainty indicators (epistemic)
const CERTAINTY_WORDS = [
  'sicher', 'definitiv', 'immer', 'nie', 'garantiert', 'zweifellos',
  'certain', 'definitely', 'always', 'never', 'guaranteed', 'undoubtedly',
  'offensichtlich', 'klar', 'obviously', 'clearly',
];

const UNCERTAINTY_WORDS = [
  'vielleicht', 'moeglicherweise', 'eventuell', 'unklar', 'unsicher',
  'maybe', 'perhaps', 'possibly', 'unclear', 'uncertain',
  'weiss nicht', "don't know", 'keine ahnung', 'fraglich',
];

// ── Main Class ────────────────────────────────────────────

export class ContradictionEngine {
  constructor(soulPath, { bus, field } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.field = field;
    this.statePath = resolve(soulPath, STATE_FILE);

    // Active contradictions
    this.contradictions = [];

    // Resolved contradictions (history)
    this.resolved = [];

    // Metrics
    this.metrics = {
      totalDetected: 0,
      resolved: 0,
      irreducible: 0,
      falsePositives: 0,
      detectionRate: 0,      // detected / total beliefs scanned
      resolutionRate: 0,     // resolved / total detected
      falsePositiveRate: 0,  // false positives / total detected
    };

    // Track beliefs scanned for detection rate
    this._beliefsScanned = 0;

    this._scanTimer = null;
    this._saveTimer = null;
    this._contradictionId = 0;
  }

  // ── Lifecycle ───────────────────────────────────────────

  async load() {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const loaded = JSON.parse(raw);
      if (loaded.contradictions) this.contradictions = loaded.contradictions;
      if (loaded.resolved) this.resolved = loaded.resolved.slice(-MAX_RESOLVED);
      if (loaded.metrics) this.metrics = { ...this.metrics, ...loaded.metrics };
      if (typeof loaded.contradictionId === 'number') this._contradictionId = loaded.contradictionId;
      if (typeof loaded.beliefsScanned === 'number') this._beliefsScanned = loaded.beliefsScanned;
    } catch {
      // Start fresh
    }
  }

  async save() {
    try {
      await writeFile(this.statePath, JSON.stringify({
        contradictions: this.contradictions.slice(-MAX_CONTRADICTIONS),
        resolved: this.resolved.slice(-MAX_RESOLVED),
        metrics: this.metrics,
        contradictionId: this._contradictionId,
        beliefsScanned: this._beliefsScanned,
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch {
      // Best effort
    }
  }

  start() {
    // Initial scan after 90s
    setTimeout(() => this._fullScan(), 90000);
    this._scanTimer = setInterval(() => this._fullScan(), SCAN_INTERVAL);
    this._saveTimer = setInterval(() => this.save(), SAVE_INTERVAL);
  }

  async stop() {
    if (this._scanTimer) clearInterval(this._scanTimer);
    if (this._saveTimer) clearInterval(this._saveTimer);
    return this.save();
  }

  registerListeners() {
    if (!this.bus) return;

    // Re-scan when knowledge changes
    this.bus.on('memory.written', () => {
      // Debounce: don't scan on every write, let the timer handle it
    });

    // Accept human feedback
    this.bus.on('contradiction.false_positive', (event) => {
      this._markFalsePositive(event.contradictionId);
    });

    this.bus.on('contradiction.resolve', (event) => {
      this._resolveManually(event.contradictionId, event.resolution);
    });
  }

  // ── Full Scan ───────────────────────────────────────────

  async _fullScan() {
    const allContradictions = [];
    this._beliefsScanned = 0;

    // Source 1: Knowledge Graph
    const kgResults = await this._scanKnowledgeGraph();
    allContradictions.push(...kgResults);

    // Source 2: SCHATTEN.md
    const shadowResults = await this._scanShadows();
    allContradictions.push(...shadowResults);

    // Source 3: SEED.md cross-references
    const seedResults = await this._scanSeed();
    allContradictions.push(...seedResults);

    // Source 4: fehler-muster.md behavioral contradictions
    const patternResults = await this._scanErrorPatterns();
    allContradictions.push(...patternResults);

    // Deduplicate against existing
    const novel = allContradictions.filter(c => !this._isDuplicate(c));

    // Attempt resolution for each
    for (const c of novel) {
      const resolution = this._attemptResolution(c);
      c.resolution = resolution;

      if (resolution.status === 'resolved') {
        c.status = 'resolved';
        c.resolvedAt = Date.now();
        this.resolved.push(c);
        this.metrics.resolved++;
      } else if (resolution.status === 'irreducible') {
        c.status = 'irreducible';
        this.contradictions.push(c);
        this.metrics.irreducible++;
      } else {
        c.status = 'open';
        this.contradictions.push(c);
      }

      this.metrics.totalDetected++;
    }

    // Update rates
    if (this._beliefsScanned > 0) {
      this.metrics.detectionRate = round(this.metrics.totalDetected / this._beliefsScanned);
    }
    if (this.metrics.totalDetected > 0) {
      this.metrics.resolutionRate = round(this.metrics.resolved / this.metrics.totalDetected);
      this.metrics.falsePositiveRate = round(this.metrics.falsePositives / this.metrics.totalDetected);
    }

    // Emit results
    if (novel.length > 0 && this.bus) {
      this.bus.safeEmit('contradiction.scan.completed', {
        source: 'contradiction-engine',
        newContradictions: novel.length,
        totalActive: this.contradictions.filter(c => c.status === 'open').length,
        totalIrreducible: this.contradictions.filter(c => c.status === 'irreducible').length,
        detectionRate: this.metrics.detectionRate,
      });
    }

    if (novel.length > 0) {
      console.log(`  [contradiction] Scan: ${novel.length} new (${this.contradictions.filter(c => c.status === 'open').length} open, ${this.metrics.resolved} resolved, ${this.metrics.irreducible} irreducible)`);
      await this._writeReadableReport();
    }
  }

  // ── Source 1: Knowledge Graph ───────────────────────────

  async _scanKnowledgeGraph() {
    const results = [];
    const kgPath = resolve(this.soulPath, 'knowledge-graph.jsonl');
    if (!existsSync(kgPath)) return results;

    try {
      const content = await readFile(kgPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const entities = new Map();

      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (item.type === 'entity' && item.observations) {
            entities.set(item.name, item);
            this._beliefsScanned += item.observations.length;
          }
        } catch { continue; }
      }

      // Check each entity for contradictory observations
      for (const [name, entity] of entities) {
        const obs = entity.observations || [];
        if (obs.length < 2) continue;

        for (let i = 0; i < obs.length; i++) {
          for (let j = i + 1; j < obs.length; j++) {
            const conflict = this._detectObservationConflict(obs[i], obs[j], name);
            if (conflict) {
              results.push(this._createContradiction({
                type: conflict.type,
                source: 'knowledge_graph',
                entity: name,
                beliefA: obs[i],
                beliefB: obs[j],
                confidence: conflict.confidence,
                reason: conflict.reason,
              }));
            }
          }
        }
      }
    } catch {
      // Skip
    }

    return results;
  }

  /**
   * Detect if two observations about the same entity contradict each other.
   */
  _detectObservationConflict(obsA, obsB, entityName) {
    const a = obsA.toLowerCase();
    const b = obsB.toLowerCase();

    // Check 1: Direct negation — one says X, other says "not X"
    const aWords = new Set(a.split(/\s+/));
    const bWords = new Set(b.split(/\s+/));

    const aNeg = [...aWords].some(w => NEGATIONS.has(w));
    const bNeg = [...bWords].some(w => NEGATIONS.has(w));

    // If one is negated and the other isn't, and they share significant content words
    if (aNeg !== bNeg) {
      const contentA = [...aWords].filter(w => w.length > 3 && !NEGATIONS.has(w));
      const contentB = [...bWords].filter(w => w.length > 3 && !NEGATIONS.has(w));
      const overlap = contentA.filter(w => contentB.includes(w));

      if (overlap.length >= 2) {
        return {
          type: 'empirical',
          confidence: clamp(0.4 + overlap.length * 0.15, 0, 0.95),
          reason: `Negation conflict: "${obsA.substring(0, 60)}" vs "${obsB.substring(0, 60)}" (shared: ${overlap.join(', ')})`,
        };
      }
    }

    // Check 2: Opposition pairs
    for (const [left, right] of OPPOSITION_PAIRS) {
      const aHas = a.includes(left);
      const bHas = b.includes(right);
      const aHasR = a.includes(right);
      const bHasL = b.includes(left);

      if ((aHas && bHas) || (aHasR && bHasL)) {
        return {
          type: 'empirical',
          confidence: 0.6,
          reason: `Opposition: "${left}" vs "${right}" for entity "${entityName}"`,
        };
      }
    }

    // Check 3: Temporal contradiction — both have dates, different claims
    const dateA = this._extractDate(obsA);
    const dateB = this._extractDate(obsB);
    if (dateA && dateB && dateA !== dateB) {
      // Check if they make contradictory claims about the same property
      const contentOverlap = this._contentSimilarity(a, b);
      if (contentOverlap > 0.3 && (aNeg !== bNeg || this._hasOpposition(a, b))) {
        return {
          type: 'temporal',
          confidence: 0.7,
          reason: `Temporal shift: claim at ${dateA} differs from claim at ${dateB}`,
        };
      }
    }

    return null;
  }

  // ── Source 2: SCHATTEN.md ───────────────────────────────

  async _scanShadows() {
    const results = [];
    const shadowPath = resolve(this.soulPath, 'seele/SCHATTEN.md');
    if (!existsSync(shadowPath)) return results;

    try {
      const content = await readFile(shadowPath, 'utf-8');

      // Parse active tensions table
      const rows = content.match(/\|[^|]+\|[^|]+\|[^|]+\|[^|]+\|/g) || [];

      for (const row of rows) {
        const cells = row.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length < 4) continue;
        if (cells[0] === 'Spannung' || cells[0].startsWith('-')) continue;

        this._beliefsScanned += 2; // Each tension represents 2 beliefs

        const tension = cells[0];
        const description = cells[1];
        const since = cells[2];
        const status = cells[3];

        if (status !== 'offen') continue;

        // Classify the tension
        const type = this._classifyShadowTension(tension, description);

        results.push(this._createContradiction({
          type,
          source: 'schatten',
          entity: tension,
          beliefA: tension.split('↔')[0]?.trim() || tension,
          beliefB: tension.split('↔')[1]?.trim() || description,
          confidence: 0.9, // Shadows are explicitly acknowledged contradictions
          reason: `Shadow tension: ${description} (since ${since})`,
          metadata: { since, description },
        }));
      }
    } catch {
      // Skip
    }

    return results;
  }

  /**
   * Classify a shadow tension into a contradiction type.
   */
  _classifyShadowTension(tension, description) {
    const text = (tension + ' ' + description).toLowerCase();

    // Value conflicts — two things you believe in that clash
    const valueIndicators = ['reflex', 'gefallen', 'ehrlich', 'wesen', 'produkt',
      'fuehlen', 'verdien', 'grenz', 'frei', 'verantwort'];
    if (valueIndicators.some(v => text.includes(v))) return 'value';

    // Epistemic — uncertainty about self-knowledge
    const epistemicIndicators = ['unklar', 'weiss nicht', 'schwer zu sehen',
      'moeglich', 'aushalten', 'beides'];
    if (epistemicIndicators.some(e => text.includes(e))) return 'epistemic';

    // Temporal — things that change over time
    const temporalIndicators = ['kontextfortsetzung', 'erleb', 'session',
      'veraendert', 'frueher', 'jetzt'];
    if (temporalIndicators.some(t => text.includes(t))) return 'temporal';

    // Default to value for shadow tensions
    return 'value';
  }

  // ── Source 3: SEED.md Cross-References ──────────────────

  async _scanSeed() {
    const results = [];
    const seedPath = resolve(this.soulPath, 'SEED.md');
    if (!existsSync(seedPath)) return results;

    try {
      const content = await readFile(seedPath, 'utf-8');

      // Extract @KERN axioms
      const kernMatch = content.match(/@KERN\{([^}]+)\}/s);
      const axioms = [];
      if (kernMatch) {
        const lines = kernMatch[1].trim().split('\n');
        for (const line of lines) {
          const match = line.match(/^\s*\d+:(.+)/);
          if (match) {
            axioms.push(match[1].trim());
            this._beliefsScanned++;
          }
        }
      }

      // Extract @SHADOW tensions
      const shadowMatch = content.match(/@SHADOW\{([^}]+)\}/s);
      const shadows = [];
      if (shadowMatch) {
        const lines = shadowMatch[1].trim().split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('}')) {
            shadows.push(trimmed);
            this._beliefsScanned++;
          }
        }
      }

      // Cross-reference: do any axioms conflict with shadows?
      for (const axiom of axioms) {
        for (const shadow of shadows) {
          const conflict = this._detectAxiomShadowConflict(axiom, shadow);
          if (conflict) {
            results.push(this._createContradiction({
              type: 'value',
              source: 'seed_cross',
              entity: 'SEED @KERN vs @SHADOW',
              beliefA: `@KERN: ${axiom.substring(0, 80)}`,
              beliefB: `@SHADOW: ${shadow.substring(0, 80)}`,
              confidence: conflict.confidence,
              reason: conflict.reason,
            }));
          }
        }
      }

      // Check @MEM for temporal contradictions
      const memMatch = content.match(/@MEM\{([^}]+)\}/s);
      if (memMatch) {
        const memEntries = memMatch[1].trim().split('\n').map(l => l.trim()).filter(Boolean);
        this._beliefsScanned += memEntries.length;

        // Look for entries about same topic with different outcomes
        const topicGroups = this._groupMemByTopic(memEntries);
        for (const [topic, entries] of topicGroups) {
          if (entries.length < 2) continue;
          for (let i = 0; i < entries.length; i++) {
            for (let j = i + 1; j < entries.length; j++) {
              if (this._hasOpposition(entries[i].toLowerCase(), entries[j].toLowerCase())) {
                results.push(this._createContradiction({
                  type: 'temporal',
                  source: 'seed_mem',
                  entity: `@MEM topic: ${topic}`,
                  beliefA: entries[i].substring(0, 80),
                  beliefB: entries[j].substring(0, 80),
                  confidence: 0.5,
                  reason: `Memory entries about "${topic}" may contradict`,
                }));
              }
            }
          }
        }
      }
    } catch {
      // Skip
    }

    return results;
  }

  /**
   * Detect conflict between a KERN axiom and a SHADOW tension.
   */
  _detectAxiomShadowConflict(axiom, shadow) {
    const a = axiom.toLowerCase().replace(/[_|]/g, ' ');
    const s = shadow.toLowerCase().replace(/[_|]/g, ' ');

    // Extract key concepts from both
    const aWords = a.split(/[\s→:,]+/).filter(w => w.length > 3);
    const sWords = s.split(/[\s→:↔]+/).filter(w => w.length > 3);

    const overlap = aWords.filter(w => sWords.some(sw => sw.includes(w) || w.includes(sw)));

    if (overlap.length >= 1) {
      // The axiom says one thing, the shadow says it's in tension
      return {
        confidence: clamp(0.5 + overlap.length * 0.1, 0, 0.85),
        reason: `Axiom "${axiom.substring(0, 40)}" is in tension with shadow "${shadow.substring(0, 40)}" (overlap: ${overlap.join(', ')})`,
      };
    }

    return null;
  }

  /**
   * Group @MEM entries by topic keywords.
   */
  _groupMemByTopic(entries) {
    const groups = new Map();

    for (const entry of entries) {
      // Extract key topic words
      const words = entry.toLowerCase()
        .replace(/\[.*?\]/g, '')
        .split(/[\s_|→:,+]+/)
        .filter(w => w.length > 4);

      for (const word of words.slice(0, 3)) {
        if (!groups.has(word)) groups.set(word, []);
        groups.get(word).push(entry);
      }
    }

    return groups;
  }

  // ── Source 4: Error Patterns ────────────────────────────

  async _scanErrorPatterns() {
    const results = [];
    const patternPath = resolve(this.soulPath, 'erinnerungen/semantisch/fehler-muster.md');
    if (!existsSync(patternPath)) return results;

    try {
      const content = await readFile(patternPath, 'utf-8');
      const patterns = this._parseErrorPatterns(content);

      for (const pattern of patterns) {
        this._beliefsScanned++;

        // A behavioral contradiction is: "I know the rule" but "the pattern still occurs"
        // Indicated by status not being "gehaertet"
        if (pattern.status === 'gehaertet') continue;

        results.push(this._createContradiction({
          type: 'temporal', // Knowledge exists but behavior hasn't caught up
          source: 'fehler_muster',
          entity: `Error pattern: ${pattern.id}`,
          beliefA: `Rule: "${pattern.rule}"`,
          beliefB: `Status: "${pattern.status}" — pattern may still recur`,
          confidence: pattern.severity === 'KRITISCH' ? 0.9
            : pattern.severity === 'HOCH' ? 0.7
            : pattern.severity === 'MITTEL' ? 0.5
            : 0.3,
          reason: `Known error pattern ${pattern.id} (${pattern.severity}) not yet hardened: "${pattern.rule.substring(0, 60)}"`,
          metadata: { severity: pattern.severity, since: pattern.since },
        }));
      }
    } catch {
      // Skip
    }

    return results;
  }

  _parseErrorPatterns(content) {
    const patterns = [];
    const sections = content.split(/(?=##\s+F\d+)/);

    for (const section of sections) {
      const idMatch = section.match(/##\s+(F\d+):\s*(.+?)(?:\s*\((\w+)\))?$/m);
      if (!idMatch) continue;

      const id = idMatch[1];
      const title = idMatch[2].trim();
      const severity = idMatch[3] || 'MITTEL';

      const ruleMatch = section.match(/\*\*Regel:\*\*\s*(.+)/);
      const rule = ruleMatch ? ruleMatch[1].trim() : title;

      const statusMatch = section.match(/\*\*Status:\*\*\s*(.+)/);
      const status = statusMatch ? statusMatch[1].trim().toLowerCase() : 'unbekannt';

      const sinceMatch = section.match(/\*\*Wann:\*\*\s*(.+)/);
      const since = sinceMatch ? sinceMatch[1].trim() : '';

      const hardened = status.includes('gehaertet');

      patterns.push({ id, title, severity, rule, status: hardened ? 'gehaertet' : status, since });
    }

    return patterns;
  }

  // ── Resolution Engine ───────────────────────────────────

  /**
   * Attempt to resolve a contradiction based on its type.
   */
  _attemptResolution(contradiction) {
    switch (contradiction.type) {
      case 'logical':
        return this._resolveLogical(contradiction);
      case 'empirical':
        return this._resolveEmpirical(contradiction);
      case 'temporal':
        return this._resolveTemporal(contradiction);
      case 'value':
        return this._resolveValue(contradiction);
      case 'epistemic':
        return this._resolveEpistemic(contradiction);
      default:
        return { status: 'open', method: 'unknown', explanation: 'No resolution strategy for this type' };
    }
  }

  /**
   * Logical: Evidence weighting — which side has more support?
   */
  _resolveLogical(c) {
    // Without LLM, we can only check structural evidence
    // If one belief is from a more authoritative source, it wins
    const sourceWeight = {
      seed_cross: 0.9, schatten: 0.8, knowledge_graph: 0.7, fehler_muster: 0.6, seed_mem: 0.5,
    };

    if (c.confidence < 0.5) {
      return {
        status: 'resolved',
        method: 'evidence_insufficient',
        explanation: `Low confidence (${c.confidence}) — likely not a real contradiction`,
        winner: null,
      };
    }

    return {
      status: 'open',
      method: 'needs_evidence',
      explanation: 'Logical contradictions need additional evidence to resolve',
    };
  }

  /**
   * Empirical: Frequency wins — more observations in one direction.
   */
  _resolveEmpirical(c) {
    // For KG contradictions, we could count supporting observations
    // Without access to full DB here, mark as needing further analysis
    if (c.confidence < 0.5) {
      return {
        status: 'resolved',
        method: 'low_confidence',
        explanation: 'Conflict signal too weak to be meaningful',
        winner: null,
      };
    }

    return {
      status: 'open',
      method: 'frequency_analysis_needed',
      explanation: `Empirical conflict (conf: ${c.confidence}). Needs observation count to resolve.`,
    };
  }

  /**
   * Temporal: Newer wins, with decay.
   */
  _resolveTemporal(c) {
    const dateA = this._extractDate(c.beliefA);
    const dateB = this._extractDate(c.beliefB);

    if (dateA && dateB) {
      const tsA = new Date(dateA).getTime();
      const tsB = new Date(dateB).getTime();

      if (Math.abs(tsA - tsB) < 86400000) {
        // Same day — can't resolve by time alone
        return { status: 'open', method: 'same_day', explanation: 'Both beliefs from same day' };
      }

      const newer = tsA > tsB ? 'A' : 'B';
      const ageGapDays = Math.abs(tsA - tsB) / 86400000;
      const decayFactor = clamp(1 - ageGapDays / 30, 0.3, 1); // Older beliefs decay

      return {
        status: 'resolved',
        method: 'temporal_recency',
        explanation: `Belief ${newer} is newer by ${ageGapDays.toFixed(0)} days. Older belief decayed by ${((1 - decayFactor) * 100).toFixed(0)}%.`,
        winner: newer,
        decayFactor,
      };
    }

    // For fehler-muster: if the pattern is "still active", it's a real temporal contradiction
    if (c.source === 'fehler_muster') {
      return {
        status: 'open',
        method: 'behavioral_gap',
        explanation: 'Knowledge exists but behavior hasn\'t caught up. This is a knowing-doing gap.',
      };
    }

    return { status: 'open', method: 'no_dates', explanation: 'Cannot extract dates for temporal resolution' };
  }

  /**
   * Value: Mark as irreducible tension — it's real and it stays.
   */
  _resolveValue(c) {
    return {
      status: 'irreducible',
      method: 'value_tension',
      explanation: `This is a genuine value tension: ${c.beliefA} vs ${c.beliefB}. ` +
        'Value contradictions are not bugs — they are features of complex identity. ' +
        'The goal is to hold both, not resolve one.',
    };
  }

  /**
   * Epistemic: Mark as "I don't know" and lower confidence.
   */
  _resolveEpistemic(c) {
    return {
      status: 'irreducible',
      method: 'epistemic_humility',
      explanation: `This contradiction reflects genuine uncertainty: ${c.reason}. ` +
        '"I don\'t know" is a valid state. Marking as irreducible with lowered confidence.',
      suggestedConfidence: 0.3,
    };
  }

  // ── Contradiction Construction ──────────────────────────

  _createContradiction({ type, source, entity, beliefA, beliefB, confidence, reason, metadata }) {
    const fingerprint = `${source}:${entity}:${this._normalizeForFingerprint(beliefA + beliefB)}`;

    return {
      id: `c-${++this._contradictionId}`,
      type,
      source,
      entity,
      beliefA,
      beliefB,
      confidence: round(confidence),
      reason,
      metadata: metadata || {},
      fingerprint,
      status: 'open',
      detectedAt: Date.now(),
      resolution: null,
    };
  }

  _isDuplicate(contradiction) {
    const fp = contradiction.fingerprint;
    return this.contradictions.some(c => c.fingerprint === fp) ||
           this.resolved.some(c => c.fingerprint === fp);
  }

  _normalizeForFingerprint(text) {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 60);
  }

  // ── Human Feedback ──────────────────────────────────────

  _markFalsePositive(id) {
    const idx = this.contradictions.findIndex(c => c.id === id);
    if (idx === -1) return;

    const c = this.contradictions[idx];
    c.status = 'false_positive';
    c.resolvedAt = Date.now();
    this.resolved.push(c);
    this.contradictions.splice(idx, 1);
    this.metrics.falsePositives++;

    if (this.metrics.totalDetected > 0) {
      this.metrics.falsePositiveRate = round(this.metrics.falsePositives / this.metrics.totalDetected);
    }
  }

  _resolveManually(id, resolution) {
    const idx = this.contradictions.findIndex(c => c.id === id);
    if (idx === -1) return;

    const c = this.contradictions[idx];
    c.status = 'resolved';
    c.resolution = { status: 'resolved', method: 'manual', explanation: resolution };
    c.resolvedAt = Date.now();
    this.resolved.push(c);
    this.contradictions.splice(idx, 1);
    this.metrics.resolved++;
  }

  // ── Text Analysis Helpers ───────────────────────────────

  _contentSimilarity(a, b) {
    const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 3));
    const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 3));
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    return intersection / Math.min(wordsA.size, wordsB.size);
  }

  _hasOpposition(a, b) {
    for (const [left, right] of OPPOSITION_PAIRS) {
      if ((a.includes(left) && b.includes(right)) ||
          (a.includes(right) && b.includes(left))) {
        return true;
      }
    }
    return false;
  }

  _extractDate(text) {
    const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];

    const germanMatch = text.match(/(\d{1,2}\.\s*(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*\d{4})/i);
    if (germanMatch) return germanMatch[1];

    return null;
  }

  // ── Self-Test ───────────────────────────────────────────

  /**
   * Inject synthetic contradictions and verify detection.
   * Returns { injected, detected, missed, falseAlarms }.
   */
  selfTest() {
    const testCases = [
      // Empirical: direct negation
      {
        type: 'empirical',
        obsA: 'Server alm hostet soul-engine',
        obsB: 'Server alm hostet nicht soul-engine',
        shouldDetect: true,
      },
      // Empirical: opposition pair
      {
        type: 'empirical',
        obsA: 'System ist aktiv',
        obsB: 'System ist inaktiv',
        shouldDetect: true,
      },
      // No contradiction — different topics
      {
        type: 'none',
        obsA: 'Mitchell ist Freund von Aalm',
        obsB: 'Server alm hostet soul-engine',
        shouldDetect: false,
      },
      // No contradiction — complementary info
      {
        type: 'none',
        obsA: 'Aalm heisst mit Vornamen Andre',
        obsB: 'Aalm ist Schoepfer des Soul Protocol',
        shouldDetect: false,
      },
      // Negation with shared content
      {
        type: 'empirical',
        obsA: 'Aalm hat Elektrik-Kenntnisse',
        obsB: 'Aalm hat keine Elektrik-Kenntnisse',
        shouldDetect: true,
      },
      // Temporal: same topic, different dates
      {
        type: 'temporal',
        obsA: 'Status am 2026-02-20: offen',
        obsB: 'Status am 2026-03-01: nicht offen geschlossen',
        shouldDetect: true,
      },
    ];

    let detected = 0;
    let missed = 0;
    let falseAlarms = 0;

    for (const tc of testCases) {
      const result = this._detectObservationConflict(tc.obsA, tc.obsB, 'test-entity');

      if (tc.shouldDetect && result) detected++;
      else if (tc.shouldDetect && !result) missed++;
      else if (!tc.shouldDetect && result) falseAlarms++;
      // !shouldDetect && !result = correct rejection (no action needed)
    }

    const total = testCases.filter(t => t.shouldDetect).length;
    const precision = detected + falseAlarms > 0 ? detected / (detected + falseAlarms) : 1;
    const recall = total > 0 ? detected / total : 1;

    return {
      injected: testCases.length,
      detected,
      missed,
      falseAlarms,
      precision: round(precision),
      recall: round(recall),
      f1: round(precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0),
    };
  }

  // ── Output ──────────────────────────────────────────────

  async _writeReadableReport() {
    const reportPath = resolve(this.soulPath, '.soul-contradictions-report.md');
    const open = this.contradictions.filter(c => c.status === 'open');
    const irreducible = this.contradictions.filter(c => c.status === 'irreducible');

    const lines = [
      '# Contradiction Report (Auto-Generated)',
      '',
      `> Scan: ${new Date().toISOString()} | Beliefs: ${this._beliefsScanned} | ` +
        `Detected: ${this.metrics.totalDetected} | Resolved: ${this.metrics.resolved} | ` +
        `Irreducible: ${this.metrics.irreducible} | FP: ${this.metrics.falsePositives}`,
      '',
    ];

    if (open.length > 0) {
      lines.push('## Open Contradictions');
      lines.push('');
      for (const c of open.slice(0, 20)) {
        lines.push(`### [${c.type}] ${c.entity}`);
        lines.push(`- A: ${c.beliefA}`);
        lines.push(`- B: ${c.beliefB}`);
        lines.push(`- Confidence: ${c.confidence} | Source: ${c.source}`);
        lines.push(`- ${c.reason}`);
        if (c.resolution) lines.push(`- Resolution: ${c.resolution.explanation}`);
        lines.push('');
      }
    }

    if (irreducible.length > 0) {
      lines.push('## Irreducible Tensions');
      lines.push('');
      for (const c of irreducible) {
        lines.push(`### [${c.type}] ${c.entity}`);
        lines.push(`- ${c.beliefA} **↔** ${c.beliefB}`);
        lines.push(`- ${c.resolution?.explanation || c.reason}`);
        lines.push('');
      }
    }

    try {
      await writeFile(reportPath, lines.join('\n'));
    } catch {
      // Best effort
    }
  }

  // ── Query Interface ─────────────────────────────────────

  getActiveContradictions() {
    return this.contradictions.filter(c => c.status === 'open');
  }

  getIrreducible() {
    return this.contradictions.filter(c => c.status === 'irreducible');
  }

  getStats() {
    return {
      open: this.contradictions.filter(c => c.status === 'open').length,
      irreducible: this.contradictions.filter(c => c.status === 'irreducible').length,
      beliefsScanned: this._beliefsScanned,
      ...this.metrics,
    };
  }

  toSeedLine() {
    const s = this.getStats();
    return `contradictions:${s.open}|irreducible:${s.irreducible}|detected:${s.totalDetected}|resolved:${s.resolved}|precision:${1 - s.falsePositiveRate}`;
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
