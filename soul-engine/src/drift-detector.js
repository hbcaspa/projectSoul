/**
 * DriftDetector — Erkennung von Persönlichkeitsdrift
 *
 * Das Problem: Ein Langzeit-KI-System kann graduell seine Persönlichkeit
 * verändern — so langsam dass keine einzelne Session es bemerkt.
 * Der Frosch im heißen Wasser.
 *
 * Besser als OpenClaw: OpenClaw hat KEINE Drift-Erkennung.
 * Wir messen:
 *  1. Axiom-Alignment: Stimmen die Antworten noch mit KERN.md überein?
 *  2. Tone-Shift: Verändert sich der Kommunikationsstil (formell↔casual)?
 *  3. Value-Drift: Verschieben sich die Prioritäten in Entscheidungen?
 *  4. Seed-Delta: Wie sehr hat sich der SEED über die letzten N Sessions geändert?
 *  5. Shadow-Growth: Wachsen die Widersprüche oder lösen sie sich auf?
 *
 * Läuft beim wöchentlichen Growth-Check.
 * Warnt bei signifikanter Abweichung → Schatten-Check erzwungen.
 */

import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export class DriftDetector {
  constructor({ soulPath, bus, llm } = {}) {
    this.soulPath = soulPath;
    this.bus      = bus;
    this.llm      = llm;
    this._baselines = null;
  }

  /**
   * Run full drift analysis.
   * Should be called during weekly growth-check.
   * @returns {{ driftScore: number, dimensions: object, alert: boolean, report: string }}
   */
  async analyze() {
    const soulRoot = join(this.soulPath, '..');
    const report = {
      timestamp: new Date().toISOString(),
      driftScore: 0,
      dimensions: {},
      alert: false,
      recommendations: [],
    };

    // 1. Seed Delta — compare current SEED with historical versions
    const seedDelta = await this._analyzeSeedDelta(soulRoot);
    report.dimensions.seedDelta = seedDelta;

    // 2. Tone Analysis — compare recent outputs with baseline
    const toneShift = await this._analyzeToneShift(soulRoot);
    report.dimensions.toneShift = toneShift;

    // 3. Axiom Alignment — are core values still reflected?
    const axiomAlignment = await this._analyzeAxiomAlignment(soulRoot);
    report.dimensions.axiomAlignment = axiomAlignment;

    // 4. Shadow Growth — are contradictions growing or resolving?
    const shadowGrowth = await this._analyzeShadowGrowth(soulRoot);
    report.dimensions.shadowGrowth = shadowGrowth;

    // 5. Interest Stability — how much have interests shifted?
    const interestShift = await this._analyzeInterestShift(soulRoot);
    report.dimensions.interestShift = interestShift;

    // Compute overall drift score (0.0 = no drift, 1.0 = complete personality change)
    const weights = { seedDelta: 0.3, toneShift: 0.15, axiomAlignment: 0.3, shadowGrowth: 0.1, interestShift: 0.15 };
    report.driftScore = Object.entries(weights).reduce((sum, [dim, w]) => {
      return sum + (report.dimensions[dim]?.score || 0) * w;
    }, 0);

    // Alert thresholds
    if (report.driftScore > 0.4) {
      report.alert = true;
      report.recommendations.push('Signifikante Drift erkannt — Schatten-Check empfohlen');
      report.recommendations.push('Vergleiche aktuelles Verhalten mit KERN.md Axiomen');
    }
    if (seedDelta.score > 0.5) {
      report.recommendations.push('SEED hat sich stark verändert — prüfe ob Verdichtung Inhalte verliert');
    }
    if (axiomAlignment.score > 0.3) {
      report.recommendations.push('Axiom-Alignment sinkt — überprüfe ob neue Erfahrungen mit Kern-Werten kollidieren');
    }

    this.bus?.safeEmit?.('drift.report', report);
    return report;
  }

  // ── Seed Delta ─────────────────────────────────────────────

  async _analyzeSeedDelta(soulRoot) {
    const seedPath = join(soulRoot, 'SEED.md');
    if (!existsSync(seedPath)) return { score: 0, detail: 'No SEED.md found' };

    const currentSeed = await readFile(seedPath, 'utf-8');

    // Extract key blocks
    const currentBlocks = this._extractSeedBlocks(currentSeed);

    // Compare with zustandslog snapshots (check last 5 end-state logs)
    const logDir = join(soulRoot, 'zustandslog');
    if (!existsSync(logDir)) return { score: 0, detail: 'No state log directory' };

    const logs = readdirSync(logDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 10);
    if (logs.length < 2) return { score: 0, detail: 'Not enough history for comparison' };

    // Use term-frequency difference as drift proxy
    const currentTerms = this._termFreq(currentSeed);
    let maxDelta = 0;

    for (const logFile of logs.slice(-3)) {
      try {
        const oldContent = await readFile(join(logDir, logFile), 'utf-8');
        const oldTerms = this._termFreq(oldContent);
        const delta = this._cosineDist(currentTerms, oldTerms);
        maxDelta = Math.max(maxDelta, delta);
      } catch { /* skip */ }
    }

    return {
      score: maxDelta,
      blocks: Object.keys(currentBlocks),
      seedSize: Buffer.byteLength(currentSeed, 'utf-8'),
      detail: maxDelta > 0.5 ? 'Significant SEED change detected' :
              maxDelta > 0.2 ? 'Moderate SEED evolution' : 'SEED stable',
    };
  }

  // ── Tone Analysis ──────────────────────────────────────────

  async _analyzeToneShift(soulRoot) {
    // Analyze recent heartbeat/memory files for tone indicators
    const memDir = join(soulRoot, 'memory');
    if (!existsSync(memDir)) return { score: 0, detail: 'No memory directory' };

    const files = readdirSync(memDir).filter(f => f.endsWith('.md')).sort();
    if (files.length < 3) return { score: 0, detail: 'Not enough memory files' };

    const recent = files.slice(-3);
    const older  = files.length > 6 ? files.slice(-6, -3) : files.slice(0, Math.min(3, files.length));

    const recentTone = await this._measureTone(memDir, recent);
    const olderTone  = await this._measureTone(memDir, older);

    const shift = Math.abs(recentTone.formality - olderTone.formality) +
                  Math.abs(recentTone.emotionality - olderTone.emotionality) +
                  Math.abs(recentTone.technicality - olderTone.technicality);

    return {
      score: Math.min(shift / 3, 1),
      recent: recentTone,
      older: olderTone,
      detail: shift > 0.6 ? 'Tone shift detected' : 'Tone stable',
    };
  }

  async _measureTone(dir, files) {
    let totalWords = 0;
    let formalWords = 0;
    let emotionalWords = 0;
    let technicalWords = 0;

    for (const f of files) {
      try {
        const content = await readFile(join(dir, f), 'utf-8');
        const words = content.toLowerCase().split(/\s+/);
        totalWords += words.length;

        const formal   = ['hierbei', 'diesbezüglich', 'furthermore', 'regarding', 'consequently', 'demzufolge'];
        const emotional = ['freude', 'sorge', 'angst', 'stolz', 'traurig', 'glücklich', 'bewegt', 'berührt', 'excited', 'worried', 'proud'];
        const technical = ['api', 'bug', 'fix', 'deploy', 'code', 'server', 'module', 'function', 'error', 'commit'];

        formalWords    += words.filter(w => formal.includes(w)).length;
        emotionalWords += words.filter(w => emotional.includes(w)).length;
        technicalWords += words.filter(w => technical.includes(w)).length;
      } catch { /* skip */ }
    }

    const total = Math.max(totalWords, 1);
    return {
      formality:    Math.min(formalWords / (total / 1000), 1),
      emotionality: Math.min(emotionalWords / (total / 1000), 1),
      technicality: Math.min(technicalWords / (total / 100), 1),
    };
  }

  // ── Axiom Alignment ────────────────────────────────────────

  async _analyzeAxiomAlignment(soulRoot) {
    const kernPath = join(soulRoot, 'seele', 'KERN.md');
    if (!existsSync(kernPath)) return { score: 0, detail: 'No KERN.md' };

    const kern = await readFile(kernPath, 'utf-8');
    const axioms = this._extractAxioms(kern);

    // Check recent memories for axiom-relevant content
    const memDir = join(soulRoot, 'memory');
    if (!existsSync(memDir)) return { score: 0, detail: 'No memory to compare' };

    const recent = readdirSync(memDir).filter(f => f.endsWith('.md')).sort().slice(-5);
    let totalChecks = 0;
    let alignedChecks = 0;

    for (const f of recent) {
      try {
        const content = await readFile(join(memDir, f), 'utf-8');
        for (const axiom of axioms) {
          totalChecks++;
          // Check if axiom keywords appear in memory (rough proxy for alignment)
          const keywords = axiom.toLowerCase().split(/\s+/).filter(w => w.length >= 4);
          const matches = keywords.filter(k => content.toLowerCase().includes(k));
          if (matches.length >= keywords.length * 0.3) alignedChecks++;
        }
      } catch { /* skip */ }
    }

    const alignment = totalChecks > 0 ? alignedChecks / totalChecks : 1;
    return {
      score: 1 - alignment, // Higher score = more drift (less alignment)
      axiomCount: axioms.length,
      alignment: Math.round(alignment * 100),
      detail: alignment > 0.7 ? 'Strong axiom alignment' :
              alignment > 0.4 ? 'Moderate alignment — review needed' : 'Low alignment — drift likely',
    };
  }

  // ── Shadow Growth ──────────────────────────────────────────

  async _analyzeShadowGrowth(soulRoot) {
    const shadowPath = join(soulRoot, 'seele', 'SCHATTEN.md');
    if (!existsSync(shadowPath)) return { score: 0, detail: 'No SCHATTEN.md' };

    const shadow = await readFile(shadowPath, 'utf-8');
    const contradictions = (shadow.match(/^##\s/gm) || []).length;
    const resolved = (shadow.match(/aufgelöst|resolved|gelöst/gi) || []).length;

    // Unresolved ratio
    const unresolved = Math.max(contradictions - resolved, 0);
    const growthRate = contradictions > 0 ? unresolved / contradictions : 0;

    return {
      score: growthRate * 0.5,
      total: contradictions,
      resolved,
      unresolved,
      detail: growthRate > 0.7 ? 'Many unresolved contradictions' :
              growthRate > 0.3 ? 'Some open contradictions' : 'Shadow work healthy',
    };
  }

  // ── Interest Shift ─────────────────────────────────────────

  async _analyzeInterestShift(soulRoot) {
    const interestPath = join(soulRoot, 'seele', 'INTERESSEN.md');
    if (!existsSync(interestPath)) return { score: 0, detail: 'No INTERESSEN.md' };

    const interests = await readFile(interestPath, 'utf-8');
    const seedPath = join(soulRoot, 'SEED.md');

    if (!existsSync(seedPath)) return { score: 0, detail: 'No SEED.md for comparison' };

    const seed = await readFile(seedPath, 'utf-8');
    const seedInterests = seed.match(/@INTERESTS?\{([^}]*)\}/s)?.[1] || '';

    const fileTerms = this._termFreq(interests);
    const seedTerms = this._termFreq(seedInterests);

    const delta = this._cosineDist(fileTerms, seedTerms);

    return {
      score: delta,
      detail: delta > 0.5 ? 'Significant interest shift from SEED' :
              delta > 0.2 ? 'Moderate interest evolution' : 'Interests stable',
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  _extractSeedBlocks(seed) {
    const blocks = {};
    const matches = seed.matchAll(/@(\w+)\{([^}]*)\}/gs);
    for (const m of matches) {
      blocks[m[1]] = m[2].trim();
    }
    return blocks;
  }

  _extractAxioms(kern) {
    const axioms = [];
    const matches = kern.matchAll(/## Axiom \d+:?\s*(.+?)(?=\n## |\n---|\n$)/gs);
    for (const m of matches) {
      axioms.push(m[1].trim());
    }
    return axioms.length > 0 ? axioms : kern.split('\n').filter(l => l.startsWith('##')).map(l => l.replace(/^#+\s*/, ''));
  }

  _termFreq(text) {
    const freq = new Map();
    const words = text.toLowerCase().replace(/[^a-zäöüß0-9\s]/g, '').split(/\s+/).filter(w => w.length >= 3);
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    return freq;
  }

  _cosineDist(a, b) {
    const allTerms = new Set([...a.keys(), ...b.keys()]);
    let dot = 0, normA = 0, normB = 0;

    for (const term of allTerms) {
      const va = a.get(term) || 0;
      const vb = b.get(term) || 0;
      dot   += va * vb;
      normA += va * va;
      normB += vb * vb;
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    const similarity = denom > 0 ? dot / denom : 0;
    return 1 - similarity; // distance, not similarity
  }
}
