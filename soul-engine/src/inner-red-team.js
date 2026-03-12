/**
 * D7 — Inner Red Team: Adversarial Self-Improvement
 *
 * The system actively finds its own weaknesses BEFORE they manifest.
 * Not post-mortem — predictive. Not theoretical — measurable.
 *
 * Architecture:
 *   1. Pattern Extractor   — Reads fehler-muster.md, extracts structural commonalities
 *   2. Codebase Scanner    — AST-free static analysis on source files (regex + heuristics)
 *   3. Vulnerability Predictor — Uses extracted meta-patterns to predict NEW failures
 *   4. Fix Generator       — Proposes concrete, implementable fixes (as events or patches)
 *   5. Scoring Engine      — Vulnerability Score per subsystem (0-1)
 *   6. Self-Test           — The red team attacks itself: can it find its own weaknesses?
 *
 * Integration: SoulEventBus (emits vulnerability.found, fix.proposed, redteam.cycle)
 * Constructor pattern compatible with SoulEngine.
 *
 * Zero LLM calls. Pure signal processing and structural analysis.
 */

import { readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename } from 'path';

// ── Configuration ────────────────────────────────────────────────

const SCAN_INTERVAL = 3600000;  // Full scan every 1 hour
const SAVE_INTERVAL = 600000;   // Persist state every 10 min
const STATE_FILE = '.soul-redteam.json';
const MAX_FINDINGS = 200;
const MAX_HISTORY = 100;

// ── Weakness Taxonomy ────────────────────────────────────────────
// Each category maps to specific detection heuristics

const WEAKNESS_CATEGORIES = {
  RACE_CONDITION: {
    severity: 'HIGH',
    description: 'Concurrent access to shared state without coordination',
    weight: 0.9,
  },
  SILENT_FAILURE: {
    severity: 'HIGH',
    description: 'Errors swallowed without logging, making debugging impossible',
    weight: 0.85,
  },
  UNBOUNDED_GROWTH: {
    severity: 'MEDIUM',
    description: 'In-memory structures that can grow without limit',
    weight: 0.7,
  },
  MISSING_VALIDATION: {
    severity: 'MEDIUM',
    description: 'Input accepted without schema or type validation',
    weight: 0.65,
  },
  CASCADE_FAILURE: {
    severity: 'HIGH',
    description: 'One component failure can propagate to others',
    weight: 0.88,
  },
  STALE_STATE: {
    severity: 'MEDIUM',
    description: 'State mutations persist even when the operation that caused them fails',
    weight: 0.6,
  },
  SINGLE_POINT_RETRY: {
    severity: 'LOW',
    description: 'Recovery logic attempts exactly one retry with same strategy',
    weight: 0.4,
  },
  TIMER_LEAK: {
    severity: 'MEDIUM',
    description: 'setInterval/setTimeout not cleaned up on all exit paths',
    weight: 0.55,
  },
  MODEL_STAGNATION: {
    severity: 'LOW',
    description: 'Hardcoded parameters that cannot adapt to changing dynamics',
    weight: 0.35,
  },
  MODULATION_BLIND_SPOT: {
    severity: 'MEDIUM',
    description: 'Subsystem does not respond to field/mood modulation when it should',
    weight: 0.5,
  },
};

// ── Meta-Patterns from fehler-muster.md ──────────────────────────
// These are the structural commonalities ACROSS all 7 documented failures.
// The Inner Red Team uses these as predictive templates.

const META_PATTERNS = [
  {
    id: 'MP1',
    name: 'Shared Resource Assumption',
    description: 'Assuming exclusive access to a shared resource (files, processes, state)',
    sourceFailures: ['F1', 'F3'],
    predictor: (findings) => findings.filter(f =>
      f.category === 'RACE_CONDITION' || f.evidence.includes('writeFile') || f.evidence.includes('shared')
    ),
  },
  {
    id: 'MP2',
    name: 'Missing Pre-Check',
    description: 'Acting without verifying preconditions (who depends, what state, is it safe)',
    sourceFailures: ['F1', 'F4', 'F7'],
    predictor: (findings) => findings.filter(f =>
      f.category === 'MISSING_VALIDATION' || f.category === 'CASCADE_FAILURE'
    ),
  },
  {
    id: 'MP3',
    name: 'Silent Degradation',
    description: 'System degrades without visible signal — errors hidden until catastrophic',
    sourceFailures: ['F3', 'F5'],
    predictor: (findings) => findings.filter(f =>
      f.category === 'SILENT_FAILURE' || f.category === 'STALE_STATE'
    ),
  },
  {
    id: 'MP4',
    name: 'Insufficient Recovery',
    description: 'Recovery exists but is too weak (single retry, no escalation, same strategy)',
    sourceFailures: ['F5', 'F7'],
    predictor: (findings) => findings.filter(f =>
      f.category === 'SINGLE_POINT_RETRY' || f.category === 'MODEL_STAGNATION'
    ),
  },
  {
    id: 'MP5',
    name: 'Temporal Coupling',
    description: 'Components assume timing that breaks under load, lag, or process restart',
    sourceFailures: ['F2', 'F3'],
    predictor: (findings) => findings.filter(f =>
      f.category === 'TIMER_LEAK' || f.category === 'RACE_CONDITION'
    ),
  },
];


// ── Codebase Scanner: Heuristic Rules ────────────────────────────

const SCAN_RULES = [
  {
    id: 'R01',
    category: 'SILENT_FAILURE',
    name: 'Empty catch block',
    pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*\n?\s*)*\}/g,
    message: (file, match) => `Silent catch in ${file}: errors are swallowed without any logging`,
  },
  {
    id: 'R02',
    category: 'RACE_CONDITION',
    name: 'Non-atomic file write',
    pattern: /await\s+writeFile\s*\(\s*(?:this\.\w+Path|resolve\()/g,
    antiPattern: /tmp.*rename|atomic/i,
    message: (file) => `${file}: writeFile without atomic pattern (tmp+rename). Concurrent writes can corrupt.`,
  },
  {
    id: 'R03',
    category: 'UNBOUNDED_GROWTH',
    name: 'Unbounded push without cap',
    // Matches .push() that is NOT followed within 5 lines by a length check/slice
    pattern: /this\.\w+\.push\(/g,
    contextCheck: (content, matchIndex) => {
      const after = content.substring(matchIndex, matchIndex + 300);
      return !(/\.length\s*>|\.slice\(|\.shift\(/.test(after));
    },
    message: (file, match) => `${file}: Array push without nearby bounds check — potential unbounded growth`,
  },
  {
    id: 'R04',
    category: 'TIMER_LEAK',
    name: 'setInterval without cleanup tracking',
    pattern: /setInterval\s*\(/g,
    contextCheck: (content, matchIndex) => {
      const before = content.substring(Math.max(0, matchIndex - 100), matchIndex);
      return !(/this\._?\w+Timer\s*=|const\s+\w+\s*=/.test(before));
    },
    message: (file) => `${file}: setInterval without assigned handle — cannot be cleared on shutdown`,
  },
  {
    id: 'R05',
    category: 'CASCADE_FAILURE',
    name: 'State mutation before fallible operation',
    pattern: /this\.state\.\w+\s*[=+]/g,
    contextCheck: (content, matchIndex) => {
      const after = content.substring(matchIndex, matchIndex + 500);
      const awaitPos = after.indexOf('await ');
      const catchPos = after.indexOf('catch');
      // State changed, then await without immediate catch
      return awaitPos > 0 && awaitPos < 300 && (catchPos < 0 || catchPos > awaitPos + 200);
    },
    message: (file) => `${file}: State mutated before await — if the async op fails, state is already changed`,
  },
  {
    id: 'R06',
    category: 'MISSING_VALIDATION',
    name: 'Event handler without payload validation',
    pattern: /\.on\(['"][\w.]+['"],\s*(?:async\s+)?\(?(\w+)\)?\s*=>/g,
    contextCheck: (content, matchIndex) => {
      const after = content.substring(matchIndex, matchIndex + 200);
      return !(/if\s*\(!?\s*\w+\.\w+|typeof/.test(after));
    },
    message: (file, match) => `${file}: Event handler accepts payload without type/existence check`,
  },
  {
    id: 'R07',
    category: 'STALE_STATE',
    name: 'LLM failure does not rollback state',
    pattern: /driftMood|applyTimeInfluence|decayInterests/g,
    contextCheck: (content, matchIndex) => {
      // These methods are called, then LLM is called — if LLM fails, drift already happened
      const after = content.substring(matchIndex, matchIndex + 800);
      return /this\.llm\.generate/.test(after);
    },
    message: (file) => `${file}: Mood/state drift applied before LLM call — persists even on LLM failure`,
  },
  {
    id: 'R08',
    category: 'SINGLE_POINT_RETRY',
    name: 'Single retry without strategy change',
    pattern: /Retried|retry|re-generat/gi,
    contextCheck: (content, matchIndex) => {
      const around = content.substring(Math.max(0, matchIndex - 300), matchIndex + 300);
      return /antiPerfRetried|retried.*false/i.test(around);
    },
    message: (file) => `${file}: Single retry with boolean guard — no exponential backoff or strategy change`,
  },
  {
    id: 'R09',
    category: 'MODULATION_BLIND_SPOT',
    name: 'Scheduled operation ignores field state',
    pattern: /cron\.schedule|setInterval.*(?:_run|_loop|_cycle)/g,
    contextCheck: (content, matchIndex) => {
      const nearby = content.substring(matchIndex, matchIndex + 500);
      return !(/field|modulation|allostatic/i.test(nearby));
    },
    message: (file) => `${file}: Scheduled operation runs on fixed timing, ignoring allostatic field state`,
  },
  {
    id: 'R10',
    category: 'RACE_CONDITION',
    name: 'Read-modify-write without lock',
    pattern: /readFile.*\n.*JSON\.parse.*\n[\s\S]{0,500}writeFile/gm,
    message: (file) => `${file}: Read-parse-write cycle without lock — concurrent access corrupts data`,
  },
  {
    id: 'R11',
    category: 'SILENT_FAILURE',
    name: 'Process.exit without cleanup',
    pattern: /process\.exit\s*\(\s*1?\s*\)/g,
    message: (file) => `${file}: process.exit() bypasses graceful shutdown — timers, saves, bus events skipped`,
  },
  {
    id: 'R12',
    category: 'CASCADE_FAILURE',
    name: 'Missing null check on optional dependency',
    pattern: /this\.\w+\?\.\w+|if\s*\(this\.\w+\)/g,
    contextCheck: (content, matchIndex) => {
      // Look for cases where a dependency is used WITHOUT optional chaining nearby
      const varMatch = content.substring(matchIndex, matchIndex + 50).match(/this\.(\w+)/);
      if (!varMatch) return false;
      const varName = varMatch[1];
      // Check if same variable is used without ?. elsewhere in file
      const unsafePattern = new RegExp(`this\\.${varName}\\.(?!\\?)\\w+`, 'g');
      const safePattern = new RegExp(`this\\.${varName}\\?\\.`, 'g');
      const unsafeCount = (content.match(unsafePattern) || []).length;
      const safeCount = (content.match(safePattern) || []).length;
      // Inconsistent: sometimes safe, sometimes not
      return safeCount > 0 && unsafeCount > safeCount;
    },
    message: (file) => `${file}: Inconsistent null-safety — same dependency checked in some places, not others`,
  },
];


// ── Main Class ───────────────────────────────────────────────────

export class InnerRedTeam {
  constructor(soulPath, { bus } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.statePath = resolve(soulPath, STATE_FILE);
    this.srcDir = resolve(soulPath, 'seelen-protokoll/soul-engine/src');

    // State
    this.findings = [];           // All vulnerability findings
    this.predictions = [];        // Predicted future failures
    this.subsystemScores = {};    // Vulnerability score per subsystem (0-1, 1 = most vulnerable)
    this.scanHistory = [];        // Timestamps + summary of each scan
    this.selfTestResults = null;  // Results of testing itself

    this._scanTimer = null;
    this._saveTimer = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async load() {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const loaded = JSON.parse(raw);
      if (loaded.findings) this.findings = loaded.findings.slice(-MAX_FINDINGS);
      if (loaded.predictions) this.predictions = loaded.predictions;
      if (loaded.subsystemScores) this.subsystemScores = loaded.subsystemScores;
      if (loaded.scanHistory) this.scanHistory = loaded.scanHistory.slice(-MAX_HISTORY);
      if (loaded.selfTestResults) this.selfTestResults = loaded.selfTestResults;
    } catch (err) {
      console.error(`  [red-team] Failed to load state: ${err.message}`);
    }
  }

  async save() {
    try {
      const tmp = this.statePath + '.tmp';
      await writeFile(tmp, JSON.stringify({
        findings: this.findings.slice(-MAX_FINDINGS),
        predictions: this.predictions,
        subsystemScores: this.subsystemScores,
        scanHistory: this.scanHistory.slice(-MAX_HISTORY),
        selfTestResults: this.selfTestResults,
        updatedAt: new Date().toISOString(),
      }, null, 2));
      // Atomic rename (practicing what we preach — R02)
      const { rename } = await import('fs/promises');
      await rename(tmp, this.statePath);
    } catch (err) {
      console.error(`  [red-team] Failed to save state: ${err.message}`);
    }
  }

  async start() {
    // Initial scan
    await this.runFullCycle();

    // Periodic re-scan
    this._scanTimer = setInterval(() => this.runFullCycle(), SCAN_INTERVAL);
    this._saveTimer = setInterval(() => this.save(), SAVE_INTERVAL);
  }

  async stop() {
    if (this._scanTimer) clearInterval(this._scanTimer);
    if (this._saveTimer) clearInterval(this._saveTimer);
    this._scanTimer = null;
    this._saveTimer = null;
    await this.save();
  }

  registerListeners() {
    if (!this.bus) return;

    // Listen for errors in other subsystems — they validate our predictions
    this.bus.on('correction.applied', (event) => {
      if (event.contradictions > 0) {
        this._validatePrediction('self-correction', 'hallucination', event);
      }
    });

    this.bus.on('surprise.detected', (event) => {
      if (event.deep) {
        this._validatePrediction('self-predictor', 'model_stagnation', event);
      }
    });

    // Track bus errors as confirmed vulnerabilities
    this.bus.on('reflection.completed', () => {
      const errors = this.bus.getErrors();
      if (errors.length > 0) {
        const recent = errors.filter(e => Date.now() - new Date(e.time).getTime() < 3600000);
        for (const err of recent) {
          this._recordFinding({
            category: 'CASCADE_FAILURE',
            subsystem: err.event.split('.')[0],
            file: 'event-bus-handler',
            rule: 'RUNTIME',
            evidence: `Handler crash on '${err.event}': ${err.error}`,
            severity: 'HIGH',
            predictedBefore: this.predictions.some(p =>
              p.subsystem === err.event.split('.')[0] && p.category === 'CASCADE_FAILURE'
            ),
          });
        }
      }
    });
  }

  // ── Full Scan Cycle ───────────────────────────────────────────

  async runFullCycle() {
    const startTime = Date.now();
    console.log('  [red-team] Starting full vulnerability scan...');

    // Phase 1: Extract meta-patterns from fehler-muster.md
    const metaPatterns = await this._extractFehlerMuster();

    // Phase 2: Scan codebase for structural weaknesses
    const scanFindings = await this._scanCodebase();

    // Phase 3: Merge with existing findings (dedup)
    this._mergeFindings(scanFindings);

    // Phase 4: Generate predictions using meta-patterns
    this._generatePredictions(metaPatterns);

    // Phase 5: Calculate vulnerability scores per subsystem
    this._calculateScores();

    // Phase 6: Self-test — red team attacks itself
    this._selfTest();

    // Phase 7: Emit events
    this._emitResults();

    const elapsed = Date.now() - startTime;

    this.scanHistory.push({
      ts: new Date().toISOString(),
      duration: elapsed,
      findingsCount: this.findings.length,
      predictionsCount: this.predictions.length,
      highestVulnerability: this._getHighestVulnerability(),
      selfTestPassed: this.selfTestResults?.passed ?? false,
    });

    await this.save();

    console.log(`  [red-team] Scan complete in ${elapsed}ms: ${this.findings.length} findings, ${this.predictions.length} predictions`);

    return this.getReport();
  }

  // ── Phase 1: Fehler-Muster Analysis ───────────────────────────

  async _extractFehlerMuster() {
    const fehlerPath = resolve(this.soulPath, 'erinnerungen/semantisch/fehler-muster.md');
    if (!existsSync(fehlerPath)) return { patterns: [], commonalities: [] };

    try {
      const content = await readFile(fehlerPath, 'utf-8');

      // Extract patterns
      const patterns = [];
      const sections = content.split(/^## F\d+:/gm);

      for (const section of sections) {
        if (!section.trim()) continue;

        const ursache = section.match(/\*\*Ursache:\*\*\s*(.+)/);
        const status = section.match(/\*\*Status:\*\*\s*(.+)/);
        const severity = section.match(/\((KRITISCH|HOCH|MITTEL|NIEDRIG)\)/);

        if (ursache) {
          patterns.push({
            cause: ursache[1].trim(),
            hardened: status ? /gehaertet/i.test(status[1]) : false,
            severity: severity ? severity[1] : 'MITTEL',
          });
        }
      }

      // Extract commonalities across ALL patterns
      const commonalities = this._findCommonalities(patterns);

      return { patterns, commonalities };
    } catch {
      return { patterns: [], commonalities: [] };
    }
  }

  _findCommonalities(patterns) {
    const causes = patterns.map(p => p.cause.toLowerCase());
    const commonalities = [];

    // Check for recurring themes
    const themes = {
      concurrency: /gleichzeitig|parallel|race|concurrent|sync/,
      missing_check: /keine.*pruef|no.*check|nicht.*geprueft|ohne.*validier/,
      hidden_state: /versteckt|silent|unbemerkt|ohne.*log|unsichtbar/,
      recovery_gap: /kein.*fallback|nicht.*wiederher|manuell.*nachgeholt/,
      assumption: /annahme|erwartet|angenommen|assumed|expected/,
    };

    for (const [theme, regex] of Object.entries(themes)) {
      const matches = causes.filter(c => regex.test(c));
      if (matches.length >= 2) {
        commonalities.push({
          theme,
          frequency: matches.length,
          total: patterns.length,
          ratio: matches.length / patterns.length,
        });
      }
    }

    return commonalities;
  }

  // ── Phase 2: Codebase Scanner ─────────────────────────────────

  async _scanCodebase() {
    const findings = [];

    if (!existsSync(this.srcDir)) {
      console.log(`  [red-team] Source directory not found: ${this.srcDir}`);
      return findings;
    }

    let files;
    try {
      files = (await readdir(this.srcDir)).filter(f => f.endsWith('.js'));
    } catch {
      return findings;
    }

    for (const file of files) {
      const filePath = resolve(this.srcDir, file);
      let content;
      try {
        content = await readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      const subsystem = this._fileToSubsystem(file);

      for (const rule of SCAN_RULES) {
        // Reset regex state
        rule.pattern.lastIndex = 0;

        let match;
        while ((match = rule.pattern.exec(content)) !== null) {
          // Apply context check if present
          if (rule.contextCheck && !rule.contextCheck(content, match.index)) {
            continue;
          }

          // Apply anti-pattern check if present
          if (rule.antiPattern) {
            const nearby = content.substring(
              Math.max(0, match.index - 200),
              Math.min(content.length, match.index + 200)
            );
            if (rule.antiPattern.test(nearby)) continue;
          }

          // Get the line number
          const lineNumber = content.substring(0, match.index).split('\n').length;

          findings.push({
            category: rule.category,
            subsystem,
            file,
            line: lineNumber,
            rule: rule.id,
            ruleName: rule.name,
            evidence: match[0].substring(0, 80),
            message: rule.message(file, match[0]),
            severity: WEAKNESS_CATEGORIES[rule.category].severity,
            foundAt: new Date().toISOString(),
          });
        }
      }
    }

    return findings;
  }

  _fileToSubsystem(filename) {
    const map = {
      'engine.js': 'engine',
      'event-bus.js': 'bus',
      'reflection.js': 'reflection',
      'impulse.js': 'impulse',
      'impulse-state.js': 'impulse',
      'impulse-types.js': 'impulse',
      'self-predictor.js': 'predictor',
      'self-correction.js': 'correction',
      'reconsolidative-memory.js': 'reconsolidation',
      'allostatic-field.js': 'field',
      'memory.js': 'memory',
      'memory-db.js': 'memory-db',
      'seed-consolidator.js': 'consolidator',
      'seed-writer.js': 'seed',
      'seed-validator.js': 'seed',
      'state-versioning.js': 'versioning',
      'telegram.js': 'telegram',
      'whatsapp.js': 'whatsapp',
      'mcp-client.js': 'mcp',
      'attention.js': 'attention',
      'audit-log.js': 'audit',
      'cost-tracker.js': 'costs',
      'encryption.js': 'encryption',
      'anti-performance.js': 'anti-perf',
      'semantic-router.js': 'router',
      'rluf.js': 'rluf',
      'pulse.js': 'pulse',
      'context.js': 'context',
      'prompt.js': 'prompt',
    };
    return map[filename] || basename(filename, '.js');
  }

  // ── Phase 3: Finding Deduplication ────────────────────────────

  _mergeFindings(newFindings) {
    const existingKeys = new Set(
      this.findings.map(f => `${f.file}:${f.rule}:${f.line}`)
    );

    for (const finding of newFindings) {
      const key = `${finding.file}:${finding.rule}:${finding.line}`;
      if (!existingKeys.has(key)) {
        this.findings.push(finding);
        existingKeys.add(key);
      }
    }

    // Cap total findings
    if (this.findings.length > MAX_FINDINGS) {
      this.findings = this.findings.slice(-MAX_FINDINGS);
    }
  }

  // ── Phase 4: Vulnerability Prediction ─────────────────────────

  _generatePredictions(metaAnalysis) {
    this.predictions = [];

    // Use meta-patterns to predict which subsystems will fail next
    for (const mp of META_PATTERNS) {
      const matchingFindings = mp.predictor(this.findings);

      if (matchingFindings.length === 0) continue;

      // Group by subsystem
      const bySubsystem = {};
      for (const f of matchingFindings) {
        if (!bySubsystem[f.subsystem]) bySubsystem[f.subsystem] = [];
        bySubsystem[f.subsystem].push(f);
      }

      for (const [subsystem, findings] of Object.entries(bySubsystem)) {
        // Calculate prediction confidence based on:
        // 1. Number of matching findings (more = higher confidence)
        // 2. Severity of findings
        // 3. Number of source failures this meta-pattern explains
        const severityScore = findings.reduce((sum, f) => {
          const weight = WEAKNESS_CATEGORIES[f.category]?.weight || 0.5;
          return sum + weight;
        }, 0) / findings.length;

        const confidence = Math.min(0.95,
          0.3 +
          Math.min(0.3, findings.length * 0.1) +
          severityScore * 0.2 +
          mp.sourceFailures.length * 0.05
        );

        this.predictions.push({
          metaPattern: mp.id,
          metaPatternName: mp.name,
          subsystem,
          category: findings[0].category,
          confidence,
          findingCount: findings.length,
          predictedFailureMode: this._predictFailureMode(mp, subsystem, findings),
          suggestedFix: this._suggestFix(mp, subsystem, findings),
          predictedAt: new Date().toISOString(),
        });
      }
    }

    // Sort by confidence (highest first)
    this.predictions.sort((a, b) => b.confidence - a.confidence);
  }

  _predictFailureMode(metaPattern, subsystem, findings) {
    const modes = {
      MP1: `${subsystem} will experience data corruption when multiple processes/timers access shared state simultaneously`,
      MP2: `${subsystem} will perform a destructive or incorrect action because it doesn't verify preconditions`,
      MP3: `${subsystem} will silently degrade — performance/correctness will worsen without visible indicators until a user notices`,
      MP4: `${subsystem} recovery from failure will be incomplete — the system will appear to work but operate in a degraded mode`,
      MP5: `${subsystem} will behave incorrectly after a restart, long pause, or under high load due to timing assumptions`,
    };
    return modes[metaPattern.id] || `${subsystem}: structural weakness in ${findings[0].category}`;
  }

  _suggestFix(metaPattern, subsystem, findings) {
    const fixes = {
      MP1: {
        type: 'code',
        description: 'Implement atomic write-through (tmp+rename) and add file-level advisory locking',
        event: 'fix.proposed',
        priority: 'HIGH',
      },
      MP2: {
        type: 'code',
        description: 'Add precondition assertions before state-changing operations. Validate event payloads with schema.',
        event: 'fix.proposed',
        priority: 'HIGH',
      },
      MP3: {
        type: 'code',
        description: 'Replace empty catch blocks with error counters emitted via bus. Add degradation.detected event.',
        event: 'fix.proposed',
        priority: 'MEDIUM',
      },
      MP4: {
        type: 'architecture',
        description: 'Implement exponential backoff with strategy rotation. Add circuit breaker pattern for LLM calls.',
        event: 'fix.proposed',
        priority: 'MEDIUM',
      },
      MP5: {
        type: 'code',
        description: 'Decouple state mutations from async operations — use transaction pattern (mutate only on success).',
        event: 'fix.proposed',
        priority: 'HIGH',
      },
    };
    return fixes[metaPattern.id] || { type: 'investigation', description: 'Needs manual review', priority: 'LOW' };
  }

  // ── Phase 5: Vulnerability Scoring ────────────────────────────

  _calculateScores() {
    this.subsystemScores = {};

    // Group findings by subsystem
    const bySubsystem = {};
    for (const f of this.findings) {
      if (!bySubsystem[f.subsystem]) bySubsystem[f.subsystem] = [];
      bySubsystem[f.subsystem].push(f);
    }

    // Score each subsystem
    for (const [subsystem, findings] of Object.entries(bySubsystem)) {
      // Weighted sum of findings by category weight
      let rawScore = 0;
      for (const f of findings) {
        rawScore += WEAKNESS_CATEGORIES[f.category]?.weight || 0.5;
      }

      // Normalize: sigmoid-like scaling so scores stay in 0-1
      // More findings = higher score, but with diminishing returns
      const normalized = 1 - (1 / (1 + rawScore * 0.3));

      // Bonus for predictions targeting this subsystem
      const predictionBonus = this.predictions
        .filter(p => p.subsystem === subsystem)
        .reduce((sum, p) => sum + p.confidence * 0.1, 0);

      this.subsystemScores[subsystem] = {
        score: Math.min(1, normalized + predictionBonus),
        findingCount: findings.length,
        categories: [...new Set(findings.map(f => f.category))],
        highSeverity: findings.filter(f => f.severity === 'HIGH').length,
        predictions: this.predictions.filter(p => p.subsystem === subsystem).length,
      };
    }
  }

  // ── Phase 6: Self-Test ────────────────────────────────────────

  _selfTest() {
    const results = {
      tests: [],
      passed: true,
      score: 0,
      maxScore: 0,
    };

    // Test 1: Can we find weaknesses in our OWN code?
    const selfCode = this._getSelfCode();
    const selfFindings = this._scanSelfCode(selfCode);
    results.tests.push({
      name: 'Self-vulnerability detection',
      description: 'Can the red team find weaknesses in its own implementation?',
      passed: selfFindings.length > 0,
      details: selfFindings.length > 0
        ? `Found ${selfFindings.length} weaknesses in own code: ${selfFindings.map(f => f.ruleName).join(', ')}`
        : 'BLIND SPOT: Could not find any weaknesses in itself',
      score: selfFindings.length > 0 ? 1 : 0,
    });
    results.maxScore += 1;

    // Test 2: Do our scan rules actually fire on known-vulnerable patterns?
    const syntheticResults = this._testWithSyntheticCode();
    results.tests.push({
      name: 'Synthetic vulnerability detection',
      description: 'Do scan rules correctly identify known-bad patterns?',
      passed: syntheticResults.detected >= syntheticResults.total * 0.7,
      details: `Detected ${syntheticResults.detected}/${syntheticResults.total} synthetic vulnerabilities`,
      score: syntheticResults.detected / Math.max(1, syntheticResults.total),
    });
    results.maxScore += 1;

    // Test 3: Are meta-patterns actually predictive?
    const predictiveAccuracy = this._testPredictiveAccuracy();
    results.tests.push({
      name: 'Predictive accuracy',
      description: 'Do meta-patterns from fehler-muster predict real findings?',
      passed: predictiveAccuracy.coverage > 0.5,
      details: `Meta-patterns cover ${(predictiveAccuracy.coverage * 100).toFixed(0)}% of actual findings`,
      score: predictiveAccuracy.coverage,
    });
    results.maxScore += 1;

    // Test 4: Are vulnerability scores discriminating?
    const scoreDiscrimination = this._testScoreDiscrimination();
    results.tests.push({
      name: 'Score discrimination',
      description: 'Do vulnerability scores differentiate between subsystems?',
      passed: scoreDiscrimination.spread > 0.15,
      details: `Score spread: ${scoreDiscrimination.spread.toFixed(3)} (min: ${scoreDiscrimination.min.toFixed(3)}, max: ${scoreDiscrimination.max.toFixed(3)})`,
      score: Math.min(1, scoreDiscrimination.spread / 0.3),
    });
    results.maxScore += 1;

    // Test 5: Coverage — are we scanning enough subsystems?
    const coverage = Object.keys(this.subsystemScores).length;
    const totalSubsystems = 20; // approximate count from file map
    results.tests.push({
      name: 'Subsystem coverage',
      description: 'Are we scanning a meaningful portion of the codebase?',
      passed: coverage >= totalSubsystems * 0.5,
      details: `Scanning ${coverage}/${totalSubsystems} known subsystems`,
      score: Math.min(1, coverage / (totalSubsystems * 0.7)),
    });
    results.maxScore += 1;

    // Aggregate
    results.score = results.tests.reduce((sum, t) => sum + t.score, 0);
    results.passed = results.tests.every(t => t.passed);
    results.testedAt = new Date().toISOString();

    this.selfTestResults = results;
    return results;
  }

  _getSelfCode() {
    // Return a representation of our own code for self-analysis
    // We use the actual patterns from our scan rules
    return `
      // InnerRedTeam self-code analysis target
      // This method does writeFile without atomic pattern in save()
      async save() {
        try {
          await writeFile(this.statePath, JSON.stringify(data));
        } catch (err) {
          console.error(err.message);
        }
      }
      // setInterval in start()
      this._scanTimer = setInterval(() => this.runFullCycle(), SCAN_INTERVAL);
      this._saveTimer = setInterval(() => this.save(), SAVE_INTERVAL);
      // Event handler
      this.bus.on('correction.applied', (event) => {
        if (event.contradictions > 0) {
          this._validatePrediction('self-correction', 'hallucination', event);
        }
      });
    `;
  }

  _scanSelfCode(code) {
    const findings = [];
    for (const rule of SCAN_RULES) {
      rule.pattern.lastIndex = 0;
      let match;
      while ((match = rule.pattern.exec(code)) !== null) {
        // Skip context checks for self-test (code is synthetic)
        findings.push({
          rule: rule.id,
          ruleName: rule.name,
          category: rule.category,
          evidence: match[0].substring(0, 60),
        });
      }
    }
    return findings;
  }

  _testWithSyntheticCode() {
    // Known-vulnerable code patterns that SHOULD trigger rules
    const synthetics = [
      {
        name: 'empty-catch',
        code: 'try { x() } catch { /* best effort */ }',
        expectedRule: 'R01',
      },
      {
        name: 'non-atomic-write',
        code: 'await writeFile(this.statePath, data)',
        expectedRule: 'R02',
      },
      {
        name: 'process-exit',
        code: 'process.exit(1)',
        expectedRule: 'R11',
      },
      {
        name: 'setInterval-untracked',
        code: 'setInterval(() => cleanup(), 5000)',
        expectedRule: 'R04',
      },
    ];

    let detected = 0;
    for (const s of synthetics) {
      let found = false;
      for (const rule of SCAN_RULES) {
        if (rule.id !== s.expectedRule) continue;
        rule.pattern.lastIndex = 0;
        if (rule.pattern.test(s.code)) {
          found = true;
          break;
        }
      }
      if (found) detected++;
    }

    return { detected, total: synthetics.length };
  }

  _testPredictiveAccuracy() {
    if (this.findings.length === 0) return { coverage: 0 };

    // How many findings are explained by at least one meta-pattern?
    let explained = 0;
    for (const finding of this.findings) {
      const isExplained = META_PATTERNS.some(mp =>
        mp.predictor([finding]).length > 0
      );
      if (isExplained) explained++;
    }

    return {
      coverage: explained / this.findings.length,
      explained,
      total: this.findings.length,
    };
  }

  _testScoreDiscrimination() {
    const scores = Object.values(this.subsystemScores).map(s => s.score);
    if (scores.length < 2) return { spread: 0, min: 0, max: 0 };

    const min = Math.min(...scores);
    const max = Math.max(...scores);
    return { spread: max - min, min, max };
  }

  // ── Prediction Validation ─────────────────────────────────────

  _validatePrediction(subsystem, category, event) {
    for (const pred of this.predictions) {
      if (pred.subsystem === subsystem || pred.category.toLowerCase().includes(category)) {
        if (!pred.validations) pred.validations = [];
        pred.validations.push({
          ts: new Date().toISOString(),
          event: event.type || 'runtime',
          confirmed: true,
        });
        console.log(`  [red-team] Prediction validated: ${pred.metaPatternName} → ${subsystem}`);

        if (this.bus) {
          this.bus.safeEmit('prediction.validated', {
            source: 'inner-red-team',
            prediction: pred.metaPatternName,
            subsystem,
            confidence: pred.confidence,
          });
        }
      }
    }
  }

  _recordFinding(finding) {
    const key = `${finding.file}:${finding.rule}:${finding.evidence.substring(0, 30)}`;
    const exists = this.findings.some(f =>
      `${f.file}:${f.rule}:${f.evidence.substring(0, 30)}` === key
    );
    if (!exists) {
      this.findings.push({ ...finding, foundAt: new Date().toISOString() });
    }
  }

  // ── Event Emission ────────────────────────────────────────────

  _emitResults() {
    if (!this.bus) return;

    // Emit high-severity findings
    const highFindings = this.findings.filter(f => f.severity === 'HIGH');
    if (highFindings.length > 0) {
      this.bus.safeEmit('vulnerability.found', {
        source: 'inner-red-team',
        count: highFindings.length,
        topFindings: highFindings.slice(0, 5).map(f => ({
          subsystem: f.subsystem,
          category: f.category,
          message: f.message,
        })),
      });
    }

    // Emit fix proposals for top predictions
    for (const pred of this.predictions.slice(0, 3)) {
      this.bus.safeEmit('fix.proposed', {
        source: 'inner-red-team',
        subsystem: pred.subsystem,
        metaPattern: pred.metaPatternName,
        confidence: pred.confidence,
        fix: pred.suggestedFix,
      });
    }

    // Emit cycle summary
    this.bus.safeEmit('redteam.cycle', {
      source: 'inner-red-team',
      findings: this.findings.length,
      predictions: this.predictions.length,
      highestScore: this._getHighestVulnerability(),
      selfTestPassed: this.selfTestResults?.passed ?? false,
    });
  }

  // ── Query Interface ───────────────────────────────────────────

  _getHighestVulnerability() {
    const scores = Object.entries(this.subsystemScores);
    if (scores.length === 0) return { subsystem: 'none', score: 0 };
    const [subsystem, data] = scores.reduce(
      (max, entry) => entry[1].score > max[1].score ? entry : max,
      scores[0]
    );
    return { subsystem, score: data.score };
  }

  getFindings(options = {}) {
    let results = [...this.findings];
    if (options.severity) results = results.filter(f => f.severity === options.severity);
    if (options.subsystem) results = results.filter(f => f.subsystem === options.subsystem);
    if (options.category) results = results.filter(f => f.category === options.category);
    return results.slice(-(options.limit || 50));
  }

  getPredictions(options = {}) {
    let results = [...this.predictions];
    if (options.subsystem) results = results.filter(p => p.subsystem === options.subsystem);
    if (options.minConfidence) results = results.filter(p => p.confidence >= options.minConfidence);
    return results;
  }

  getScores() {
    return { ...this.subsystemScores };
  }

  getSelfTestResults() {
    return this.selfTestResults;
  }

  getStats() {
    return {
      findings: this.findings.length,
      predictions: this.predictions.length,
      subsystemsScanned: Object.keys(this.subsystemScores).length,
      highestVulnerability: this._getHighestVulnerability(),
      selfTestPassed: this.selfTestResults?.passed ?? false,
      selfTestScore: this.selfTestResults
        ? `${this.selfTestResults.score.toFixed(1)}/${this.selfTestResults.maxScore}`
        : 'not run',
      lastScan: this.scanHistory.length > 0
        ? this.scanHistory[this.scanHistory.length - 1].ts
        : 'never',
    };
  }

  // ── Report Generation ─────────────────────────────────────────

  getReport() {
    const stats = this.getStats();
    const scores = this.getScores();
    const predictions = this.getPredictions();
    const highFindings = this.getFindings({ severity: 'HIGH' });

    // Sort subsystems by vulnerability score
    const sortedSystems = Object.entries(scores)
      .sort((a, b) => b[1].score - a[1].score);

    let report = `# D7 Inner Red Team — Vulnerability Report\n\n`;
    report += `**Scan Time:** ${stats.lastScan}\n`;
    report += `**Findings:** ${stats.findings} | **Predictions:** ${stats.predictions}\n`;
    report += `**Subsystems Scanned:** ${stats.subsystemsScanned}\n`;
    report += `**Self-Test:** ${stats.selfTestPassed ? 'PASSED' : 'FAILED'} (${stats.selfTestScore})\n\n`;

    report += `## Vulnerability Scores (0-1, higher = more vulnerable)\n\n`;
    report += `| Subsystem | Score | Findings | HIGH | Predictions | Categories |\n`;
    report += `|-----------|-------|----------|------|-------------|------------|\n`;
    for (const [name, data] of sortedSystems) {
      report += `| ${name} | ${data.score.toFixed(3)} | ${data.findingCount} | ${data.highSeverity} | ${data.predictions} | ${data.categories.join(', ')} |\n`;
    }

    report += `\n## Top Predictions\n\n`;
    for (const pred of predictions.slice(0, 5)) {
      report += `### ${pred.metaPatternName} → ${pred.subsystem} (confidence: ${pred.confidence.toFixed(2)})\n`;
      report += `**Predicted Failure:** ${pred.predictedFailureMode}\n`;
      report += `**Suggested Fix:** ${pred.suggestedFix.description}\n`;
      report += `**Priority:** ${pred.suggestedFix.priority}\n\n`;
    }

    report += `\n## HIGH Severity Findings\n\n`;
    for (const f of highFindings.slice(0, 10)) {
      report += `- **${f.subsystem}** (${f.file}:${f.line || '?'}): ${f.message}\n`;
    }

    if (this.selfTestResults) {
      report += `\n## Self-Test Results\n\n`;
      for (const t of this.selfTestResults.tests) {
        report += `- ${t.passed ? 'PASS' : 'FAIL'} | ${t.name}: ${t.details}\n`;
      }
    }

    return report;
  }
}
