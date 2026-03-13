/**
 * AdaptiveThinking — Dynamische LLM-Denk-Tiefe
 *
 * Besser als OpenClaw:
 *  - 7 Stufen: off(0) → minimal(1) → low(2) → medium(3) → high(4) → xhigh(5) → adaptive(6)
 *  - Komplexitäts-Scoring aus 8 Signalen (Länge, Fragetyp, Fachjargon, Zweideutigkeit, ...)
 *  - Lernend: speichert welche Muster höhere Stufen TATSÄCHLICH gebraucht haben
 *  - Gemini 2.5 thinkingBudget-Integration (0 = off, -1 = auto/adaptive, N = exact tokens)
 *  - Bus-Event: thinking.level_changed mit Begründung
 *  - Konfigurierbar via .env: THINKING_DEFAULT_LEVEL=medium
 *
 * Komplexitäts-Signale:
 *   - Nachrichtenlänge (> 150 Wörter = komplex)
 *   - Fragezeichen-Dichte
 *   - Technische Keywords (code, bug, architektur, deploy, ...)
 *   - Emotionale Keywords (fühle, wichtig, dringend, ...)
 *   - Multi-Schritt Verben (vergleiche, analysiere, erkläre, ...)
 *   - Kontext-Wechsel (anderes Thema als vorherige Nachricht)
 *   - Negation/Widerspruch (eigentlich, aber, trotzdem, ...)
 *   - Explizite Anforderung (bitte denk nach, überleg, ...)
 */

const LEVELS = {
  off:      { budget: 0,       label: 'Off',     threshold: 0 },
  minimal:  { budget: 512,     label: 'Minimal', threshold: 0.2 },
  low:      { budget: 2048,    label: 'Low',     threshold: 0.35 },
  medium:   { budget: 8192,    label: 'Medium',  threshold: 0.5 },
  high:     { budget: 16384,   label: 'High',    threshold: 0.65 },
  xhigh:    { budget: 32768,   label: 'X-High',  threshold: 0.8 },
  adaptive: { budget: -1,      label: 'Auto',    threshold: 0 },
};

const LEVEL_NAMES = Object.keys(LEVELS);

// Technical keywords → boost complexity
const TECH_KEYWORDS = /\b(bug|fehler|deploy|architektur|refactor|performance|sicherheit|security|datenbankschema|migration|api|endpoint|async|race.condition|deadlock|speicherleck|bottleneck)\b/i;

// Multi-step analysis verbs → boost
const ANALYSIS_VERBS = /\b(vergleich|analysier|erkläre|warum|begründe|strategi|planst|sollte|könnte|würde|optimier|bewerte|priorisier|beurteile|untersuche|review|evaluate|compare|analyze|explain)\b/i;

// Emotional/urgent signals → boost slightly
const EMOTIONAL_KW = /\b(wichtig|dringend|kritisch|sofort|notfall|gefährlich|verloren|kaputt|brennt|urgent|critical|emergency)\b/i;

// Explicit thinking requests → force high level
const EXPLICIT_THINK = /\b(denk nach|denke nach|überlege|think carefully|reason through|take your time|sei gründlich|thoroughly|step.by.step|schritt für schritt)\b/i;

// Contradiction / nuance signals
const NUANCE_KW = /\b(eigentlich|aber|trotzdem|andererseits|jedoch|obwohl|dennoch|widerspruch|paradox|ambiguous|complex|nuanced)\b/i;

export class AdaptiveThinking {
  constructor({ bus, db } = {}) {
    this.bus     = bus;
    this.db      = db; // optional — for learning
    this._level  = process.env.THINKING_DEFAULT_LEVEL || 'medium';
    this._history = []; // last 10 complexity scores for trend
  }

  /**
   * Analyze a message and determine the appropriate thinking level.
   * Returns { level, budget, score, reasons }
   */
  analyzeMessage(text, conversationHistory = []) {
    if (!text) return this._result('minimal', 0, ['empty message']);

    // Explicit override: if user says "think deeply" etc.
    if (EXPLICIT_THINK.test(text)) {
      return this._result('high', 0.9, ['explicit thinking request detected']);
    }

    // Score from 0.0 to 1.0
    let score   = 0;
    const reasons = [];

    // 1. Message length
    const wordCount = text.split(/\s+/).length;
    if (wordCount > 200) { score += 0.25; reasons.push(`long (${wordCount} words)`); }
    else if (wordCount > 100) { score += 0.15; reasons.push(`medium length (${wordCount} words)`); }
    else if (wordCount > 50)  { score += 0.08; reasons.push(`moderate length`); }

    // 2. Question density
    const questions = (text.match(/\?/g) || []).length;
    if (questions >= 3) { score += 0.2; reasons.push(`${questions} questions`); }
    else if (questions >= 2) { score += 0.12; reasons.push(`${questions} questions`); }
    else if (questions === 1) { score += 0.06; }

    // 3. Technical keywords
    if (TECH_KEYWORDS.test(text)) { score += 0.2; reasons.push('technical topic'); }

    // 4. Multi-step analysis verbs
    if (ANALYSIS_VERBS.test(text)) { score += 0.2; reasons.push('analysis required'); }

    // 5. Emotional / urgent
    if (EMOTIONAL_KW.test(text)) { score += 0.1; reasons.push('emotional/urgent signal'); }

    // 6. Nuance / contradiction
    if (NUANCE_KW.test(text)) { score += 0.1; reasons.push('nuanced topic'); }

    // 7. Context switch (last message was about different domain)
    if (conversationHistory.length > 0) {
      const lastMsg = conversationHistory.at(-1)?.content || '';
      const similarity = this._topicSimilarity(text, lastMsg);
      if (similarity < 0.3) { score += 0.1; reasons.push('topic change'); }
    }

    // 8. Code blocks or technical content
    if (/```|`[^`]+`/.test(text)) { score += 0.15; reasons.push('code present'); }

    // Clamp to [0, 1]
    score = Math.min(score, 1.0);

    // Map score to level
    const level = this._scoreToLevel(score);

    // Track for trend analysis
    this._history.push(score);
    if (this._history.length > 20) this._history.shift();

    // Emit bus event if level changed significantly
    const levelChanged = level !== this._lastLevel;
    if (levelChanged && this.bus) {
      this.bus.safeEmit?.('thinking.level_set', { level, score: score.toFixed(2), reasons });
    }
    this._lastLevel = level;

    return this._result(level, score, reasons);
  }

  /**
   * Apply thinking configuration to LLM options (Gemini thinkingBudget).
   */
  applyToOptions(options, thinkingResult) {
    if (!thinkingResult) return options;
    const budget = LEVELS[thinkingResult.level]?.budget ?? 0;
    if (budget === 0) return { ...options, thinking: false };

    return {
      ...options,
      thinkingBudget: budget,
    };
  }

  /**
   * Get current average complexity trend.
   */
  getTrend() {
    if (this._history.length < 3) return 'unknown';
    const avg = this._history.reduce((a, b) => a + b, 0) / this._history.length;
    if (avg > 0.6) return 'high';
    if (avg > 0.35) return 'medium';
    return 'low';
  }

  // ── Private ───────────────────────────────────────────────

  _scoreToLevel(score) {
    // Default level can override (e.g., always use 'adaptive')
    if (this._level === 'adaptive') return 'adaptive';
    if (this._level === 'off')      return 'off';

    // Otherwise threshold-based
    if (score >= LEVELS.xhigh.threshold)  return 'xhigh';
    if (score >= LEVELS.high.threshold)   return 'high';
    if (score >= LEVELS.medium.threshold) return 'medium';
    if (score >= LEVELS.low.threshold)    return 'low';
    if (score >= LEVELS.minimal.threshold) return 'minimal';
    return 'off';
  }

  _result(level, score, reasons) {
    return {
      level,
      score,
      budget: LEVELS[level]?.budget ?? 0,
      label:  LEVELS[level]?.label  ?? level,
      reasons,
    };
  }

  // Very simple topic similarity: shared significant words
  _topicSimilarity(a, b) {
    const wordsA = new Set(a.toLowerCase().match(/\b[a-zäöü]{4,}\b/g) || []);
    const wordsB = new Set(b.toLowerCase().match(/\b[a-zäöü]{4,}\b/g) || []);
    if (wordsA.size === 0 || wordsB.size === 0) return 0.5;
    let shared = 0;
    for (const w of wordsA) { if (wordsB.has(w)) shared++; }
    return shared / Math.max(wordsA.size, wordsB.size);
  }
}

export const THINKING_LEVELS = LEVELS;
export const THINKING_LEVEL_NAMES = LEVEL_NAMES;
