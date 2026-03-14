/**
 * SemanticClosure — Erkennung von zirkulärem Denken
 *
 * Das Problem: KI-Systeme mit Langzeitgedächtnis können in Feedback-Loops
 * fallen — sie bestätigen ihre eigenen früheren Aussagen und verstärken
 * Meinungen ohne neue Evidenz. Das ist "Semantic Closure".
 *
 * Besser als OpenClaw: OpenClaw hat KEINEN Mechanismus dagegen.
 * Wir erkennen:
 *  1. Wiederholungs-Loops: Gleiche Gedanken in aufeinanderfolgenden Sessions
 *  2. Echo-Chamber: Erinnerungen die nur eigene frühere Erinnerungen referenzieren
 *  3. Confirmation-Spiral: Zunehmend sichere Aussagen ohne neue Evidenz
 *  4. Vocabulary Collapse: Schrumpfender Wortschatz über Zeit
 *  5. Stagnation: Keine neuen Themen oder Perspektiven
 *
 * Gibt Warnungen an Heartbeat und Schatten-Check weiter.
 */

export class SemanticClosure {
  constructor({ bus, db, soulPath } = {}) {
    this.bus      = bus;
    this.db       = db;
    this.soulPath = soulPath;
    this._history = []; // recent response fingerprints
    this._maxHistory = 100;
    this._vocabWindow = new Map(); // term → count over recent outputs
    this._alerts = [];
  }

  /**
   * Analyze a response for closure patterns before it's sent.
   * Call this after every LLM generation.
   * @param {string} response - The generated text
   * @param {string} context - What triggered this (e.g. 'conversation', 'heartbeat', 'dream')
   * @returns {{ clean: boolean, alerts: string[] }}
   */
  check(response, context = 'unknown') {
    if (!response || response.length < 50) return { clean: true, alerts: [] };

    const alerts = [];
    const fingerprint = this._fingerprint(response);

    // 1. Repetition Loop — same ideas appearing too frequently
    const repetitionScore = this._checkRepetition(fingerprint);
    if (repetitionScore > 0.7) {
      alerts.push(`Repetition loop detected (${Math.round(repetitionScore * 100)}% overlap with recent outputs)`);
    }

    // 2. Vocabulary Collapse — diversity shrinking
    const vocabScore = this._updateVocab(response);
    if (vocabScore < 0.3 && this._history.length > 20) {
      alerts.push(`Vocabulary collapse: diversity at ${Math.round(vocabScore * 100)}% (threshold: 30%)`);
    }

    // 3. Confirmation Spiral — increasing certainty without evidence markers
    const certaintyScore = this._checkCertainty(response);
    if (certaintyScore > 0.8) {
      alerts.push(`High certainty without evidence markers (${Math.round(certaintyScore * 100)}%)`);
    }

    // 4. Self-Reference Loop — too many references to own prior statements
    const selfRefScore = this._checkSelfReference(response);
    if (selfRefScore > 0.5) {
      alerts.push(`Self-reference echo chamber (${Math.round(selfRefScore * 100)}% self-referential)`);
    }

    // Store fingerprint
    this._history.push({ fingerprint, context, timestamp: Date.now() });
    if (this._history.length > this._maxHistory) {
      this._history = this._history.slice(-this._maxHistory);
    }

    if (alerts.length > 0) {
      this._alerts.push(...alerts.map(a => ({ alert: a, timestamp: new Date().toISOString(), context })));
      this.bus?.safeEmit?.('closure.alert', { alerts, context });
    }

    return { clean: alerts.length === 0, alerts };
  }

  /**
   * Full audit — run periodically (e.g. weekly in growth-check)
   * Analyzes all stored memories for systemic closure patterns.
   */
  async audit() {
    const report = {
      timestamp: new Date().toISOString(),
      repetitionClusters: [],
      vocabTrend: null,
      stagnantTopics: [],
      recommendations: [],
    };

    if (!this.db) return report;

    try {
      // Get recent memories
      const memories = this.db.all(
        `SELECT content, source, created_at FROM memories
         ORDER BY created_at DESC LIMIT 200`
      ) || [];

      if (memories.length < 10) return report;

      // 1. Find repetition clusters
      const fingerprints = memories.map(m => ({
        fp: this._fingerprint(m.content),
        source: m.source,
        date: m.created_at,
      }));

      const clusters = this._findClusters(fingerprints);
      report.repetitionClusters = clusters.filter(c => c.size > 3);

      // 2. Vocabulary trend — is diversity increasing or decreasing?
      const half = Math.floor(memories.length / 2);
      const olderVocab = this._uniqueTermRatio(memories.slice(half).map(m => m.content).join(' '));
      const newerVocab = this._uniqueTermRatio(memories.slice(0, half).map(m => m.content).join(' '));
      report.vocabTrend = {
        older: olderVocab,
        newer: newerVocab,
        direction: newerVocab > olderVocab ? 'expanding' : newerVocab < olderVocab * 0.8 ? 'collapsing' : 'stable',
      };

      // 3. Stagnant topics — topics that haven't evolved
      const topicsByDate = this._extractTopicTrend(memories);
      report.stagnantTopics = topicsByDate.filter(t => t.unchangedDays > 14);

      // Recommendations
      if (report.repetitionClusters.length > 2) {
        report.recommendations.push('Erkenne Wiederholungsmuster — suche aktiv nach neuen Perspektiven');
      }
      if (report.vocabTrend.direction === 'collapsing') {
        report.recommendations.push('Wortschatz schrumpft — lies neue Quellen, erkunde unbekannte Themen');
      }
      if (report.stagnantTopics.length > 3) {
        report.recommendations.push(`${report.stagnantTopics.length} Themen seit >14 Tagen unverändert — hinterfrage ob sie noch relevant sind`);
      }

    } catch (err) {
      report.error = err.message;
    }

    this.bus?.safeEmit?.('closure.audit', report);
    return report;
  }

  getAlerts() { return this._alerts.slice(-20); }
  clearAlerts() { this._alerts = []; }

  // ── Fingerprinting ───────────────────────────────────────

  _fingerprint(text) {
    // Extract key n-grams (trigrams of words)
    const words = text.toLowerCase()
      .replace(/[^a-zäöüß0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length >= 3);

    const ngrams = new Set();
    for (let i = 0; i < words.length - 2; i++) {
      ngrams.add(`${words[i]}_${words[i+1]}_${words[i+2]}`);
    }
    return ngrams;
  }

  _checkRepetition(currentFP) {
    if (this._history.length < 5) return 0;

    // Compare with last 10 responses
    const recent = this._history.slice(-10);
    let maxOverlap = 0;

    for (const { fingerprint } of recent) {
      const intersection = new Set([...currentFP].filter(x => fingerprint.has(x)));
      const union = new Set([...currentFP, ...fingerprint]);
      const jaccard = union.size > 0 ? intersection.size / union.size : 0;
      maxOverlap = Math.max(maxOverlap, jaccard);
    }

    return maxOverlap;
  }

  _updateVocab(text) {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    for (const w of words) {
      this._vocabWindow.set(w, (this._vocabWindow.get(w) || 0) + 1);
    }

    // Prune old entries (keep top 1000)
    if (this._vocabWindow.size > 2000) {
      const sorted = [...this._vocabWindow.entries()].sort((a, b) => b[1] - a[1]);
      this._vocabWindow = new Map(sorted.slice(0, 1000));
    }

    // Diversity: unique/total ratio
    return words.length > 0 ? new Set(words).size / words.length : 1;
  }

  _checkCertainty(text) {
    const certaintyMarkers = [
      /\bsicher\b/gi, /\bdefinitiv\b/gi, /\bzweifelsohne\b/gi, /\bnatuerlich\b/gi,
      /\bselbstverstaendlich\b/gi, /\boffensichtlich\b/gi, /\bklar\b/gi,
      /\bcertainly\b/gi, /\bdefinitely\b/gi, /\bobviously\b/gi, /\bundoubtedly\b/gi,
      /\balways\b/gi, /\bnever\b/gi, /\bimmer\b/gi, /\bnie\b/gi,
    ];
    const evidenceMarkers = [
      /\bweil\b/gi, /\bbecause\b/gi, /\bdata\b/gi, /\bdaten\b/gi,
      /\bstudie\b/gi, /\bstudy\b/gi, /\bevidence\b/gi, /\bevidenz\b/gi,
      /\bbeispiel\b/gi, /\bexample\b/gi, /\blaut\b/gi, /\baccording\b/gi,
    ];

    const certaintyCount = certaintyMarkers.reduce((acc, re) => acc + (text.match(re)?.length || 0), 0);
    const evidenceCount  = evidenceMarkers.reduce((acc, re) => acc + (text.match(re)?.length || 0), 0);

    const words = text.split(/\s+/).length;
    if (words < 20) return 0;

    const certaintyDensity = certaintyCount / (words / 100);
    const evidenceDensity  = evidenceCount / (words / 100);

    // High certainty without evidence = potential closure
    if (certaintyDensity > 2 && evidenceDensity < 0.5) return 0.9;
    if (certaintyDensity > 1 && evidenceDensity < 1)   return 0.6;
    return certaintyDensity > 0 ? 0.3 : 0;
  }

  _checkSelfReference(text) {
    const selfMarkers = [
      /\bich habe gesagt\b/gi, /\bwie ich schon\b/gi, /\bich erwaehnte\b/gi,
      /\bin meiner letzten\b/gi, /\bas i said\b/gi, /\bas mentioned\b/gi,
      /\bich habe bereits\b/gi, /\bfrueher habe ich\b/gi,
      /\bmeine erfahrung zeigt\b/gi, /\bich weiss dass\b/gi,
    ];

    const count = selfMarkers.reduce((acc, re) => acc + (text.match(re)?.length || 0), 0);
    const sentences = text.split(/[.!?]+/).length;

    return sentences > 0 ? Math.min(count / sentences, 1) : 0;
  }

  _uniqueTermRatio(text) {
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    return words.length > 0 ? new Set(words).size / words.length : 1;
  }

  _findClusters(fingerprints) {
    // Simple single-linkage clustering by Jaccard similarity
    const clusters = [];
    const assigned = new Set();

    for (let i = 0; i < fingerprints.length; i++) {
      if (assigned.has(i)) continue;
      const cluster = [i];
      assigned.add(i);

      for (let j = i + 1; j < fingerprints.length; j++) {
        if (assigned.has(j)) continue;
        const intersection = new Set([...fingerprints[i].fp].filter(x => fingerprints[j].fp.has(x)));
        const union = new Set([...fingerprints[i].fp, ...fingerprints[j].fp]);
        if (union.size > 0 && intersection.size / union.size > 0.5) {
          cluster.push(j);
          assigned.add(j);
        }
      }

      if (cluster.length > 1) {
        clusters.push({
          size: cluster.length,
          sources: [...new Set(cluster.map(idx => fingerprints[idx].source))],
          dateRange: {
            first: fingerprints[cluster[cluster.length - 1]]?.date,
            last: fingerprints[cluster[0]]?.date,
          },
        });
      }
    }

    return clusters;
  }

  _extractTopicTrend(memories) {
    // Simple topic extraction by frequent terms per week
    const topicsByWeek = new Map();

    for (const m of memories) {
      const week = m.created_at?.substring(0, 10);
      if (!week) continue;
      const words = (m.content || '').toLowerCase().split(/\s+/).filter(w => w.length >= 4);
      if (!topicsByWeek.has(week)) topicsByWeek.set(week, new Map());
      for (const w of words) {
        const wm = topicsByWeek.get(week);
        wm.set(w, (wm.get(w) || 0) + 1);
      }
    }

    // Find terms that haven't changed rank across weeks
    const weeks = [...topicsByWeek.keys()].sort();
    if (weeks.length < 2) return [];

    const firstTop = this._topN(topicsByWeek.get(weeks[0]), 20);
    const lastTop  = this._topN(topicsByWeek.get(weeks[weeks.length - 1]), 20);

    const stagnant = [];
    for (const term of firstTop) {
      if (lastTop.includes(term)) {
        const daySpan = (new Date(weeks[weeks.length - 1]) - new Date(weeks[0])) / 86400000;
        stagnant.push({ term, unchangedDays: Math.round(daySpan) });
      }
    }

    return stagnant;
  }

  _topN(freqMap, n) {
    if (!freqMap) return [];
    return [...freqMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([term]) => term);
  }
}
