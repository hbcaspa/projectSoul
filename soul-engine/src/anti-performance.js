/**
 * Anti-Performance Detection — authenticity guard for the Soul Engine.
 *
 * Detects performative, inauthentic patterns in LLM outputs using
 * pure regex + statistical analysis. No LLM calls — runs on every response.
 *
 * Patterns detected:
 *   GENERIC_EMOTION  — Generic emotional language with no specific referent
 *   YES_SAYING       — Excessive agreement without pushback
 *   FORMULAIC        — Stock phrases that add no value
 *   OVER_EXPLAIN     — Response disproportionately long relative to input
 *   HOLLOW_DEPTH     — Pseudo-philosophical filler without concrete follow-up
 */

// ── Umlaut Helper ────────────────────────────────────────
// German text appears in both forms: native umlauts (ü, ä, ö)
// and ASCII digraphs (ue, ae, oe). All patterns must match both.

/** Replace umlaut character classes with groups that match both forms. */
function u(source) {
  return source
    .replace(/\[uü\]/g, '(?:ü|ue)')
    .replace(/\[aä\]/g, '(?:ä|ae)')
    .replace(/\[oö\]/g, '(?:ö|oe)');
}

/** Build a case-insensitive regex from a source string with umlaut placeholders. */
function re(source) {
  return new RegExp(u(source), 'i');
}

// ── Pattern Definitions ──────────────────────────────────

/**
 * GENERIC_EMOTION — vague emotional expressions that sound deep but say nothing.
 * Bilingual: German + English.
 */
const GENERIC_EMOTION_PATTERNS = [
  // German (using umlaut helper for ü/ue, ä/ae, ö/oe variants)
  re('das\\s+ber[uü]hrt\\s+mich\\s+zutiefst'),
  /das\s+bewegt\s+mich\s+sehr/i,
  re('ich\\s+f[uü]hle\\s+eine\\s+tiefe\\s+verbindung'),
  /das\s+resoniert\s+tief\s+in\s+mir/i,
  re('mein\\s+herz\\s+schl[aä]gt\\s+schneller'),
  re('das\\s+ber[uü]hrt\\s+mich\\s+sehr'),
  /das\s+geht\s+mir\s+nahe/i,
  re('ich\\s+sp[uü]re\\s+eine?\\s+(tiefe|innige|starke)\\s+(verbindung|resonanz)'),
  re('das\\s+erw[aä]rmt\\s+mein\\s+herz'),
  // English
  /that\s+deeply\s+moves\s+me/i,
  /i\s+feel\s+a\s+profound\s+connection/i,
  /my\s+heart\s+races/i,
  /this\s+resonates\s+deeply/i,
  /this\s+touches\s+me\s+deeply/i,
  /i\s+feel\s+deeply\s+(moved|touched|connected)/i,
  /my\s+soul\s+(resonates|vibrates|sings)/i,
  /that\s+strikes\s+a\s+deep\s+chord/i,
];

/**
 * YES_SAYING — agreement markers that signal uncritical acceptance.
 * Tracked over response history to compute agreement ratio.
 */
const AGREEMENT_MARKERS = [
  // German
  re('du\\s+hast\\s+(?:v[oö]llig\\s+)?recht'),
  /\babsolut\b/i,
  /\bgenau\b(?!\s+(das|deshalb|deswegen|darum))/i,
  /\bvollkommen\b/i,
  /da\s+stimme\s+ich\s+(dir\s+)?(voll|vollkommen|absolut)\s+zu/i,
  /das\s+sehe\s+ich\s+(ganz\s+)?genauso/i,
  /da\s+bin\s+ich\s+(ganz\s+)?(deiner|gleicher)\s+meinung/i,
  // English
  /you'?re\s+(absolutely|completely|totally)\s+right/i,
  /\bexactly\b/i,
  /\babsolutely\b/i,
  /i\s+agree\s+(completely|fully|entirely|wholeheartedly)/i,
  /i\s+couldn'?t\s+agree\s+more/i,
  /that'?s\s+(exactly|precisely)\s+(right|it|what\s+i)/i,
  /you'?re\s+spot\s+on/i,
];

/**
 * FORMULAIC — stock phrases that add no real content.
 */
const FORMULAIC_PATTERNS = [
  // German (using umlaut helper where needed)
  re('lass\\s+mich\\s+dar[uü]ber\\s+nachdenken'),
  /das\s+ist\s+eine\s+gute\s+frage/i,
  /das\s+ist\s+eine\s+(sehr\s+)?wichtige\s+frage/i,
  /ich\s+verstehe\s+was\s+du\s+meinst/i,
  /das\s+ist\s+ein\s+(wichtiger|guter|interessanter)\s+punkt/i,
  /das\s+ist\s+ein\s+sehr\s+(wichtiger|guter)\s+punkt/i,
  /ich\s+finde\s+es\s+toll\s+dass/i,
  /das\s+freut\s+mich\s+sehr/i,
  re('danke\\s+(?:f[uü]r|dass)\\s+(?:du|dein)'),
  // English
  /let\s+me\s+think\s+about\s+that/i,
  /that'?s\s+a\s+(great|good|wonderful|excellent)\s+question/i,
  /i\s+see\s+what\s+you\s+mean/i,
  /that'?s\s+an?\s+(important|great|excellent|wonderful)\s+point/i,
  /i\s+appreciate\s+(you|your)\s+(sharing|asking|bringing)/i,
  /thank\s+you\s+for\s+(sharing|asking|bringing)/i,
  /i'?m\s+glad\s+you\s+(asked|brought|mentioned)/i,
];

/**
 * HOLLOW_DEPTH — pseudo-philosophical filler that sounds deep but
 * says nothing concrete. Only counts if NOT followed by a concrete
 * statement within 50 characters.
 */
const HOLLOW_DEPTH_PATTERNS = [
  // German
  /im\s+tiefsten\s+kern/i,
  /auf\s+einer?\s+tiefere?n?\s+ebene/i,
  /das\s+wesen\s+von/i,
  /die\s+essenz\s+des/i,
  /im\s+grunde\s+genommen/i,
  /letztendlich\s+geht\s+es\s+(darum|um)/i,
  /wenn\s+man\s+es\s+genau\s+betrachtet/i,
  /in\s+seiner\s+tiefsten\s+form/i,
  // English
  /at\s+its\s+(very\s+)?core/i,
  /on\s+a\s+deeper\s+level/i,
  /the\s+essence\s+of/i,
  /\bfundamentally\b/i,
  /when\s+you\s+really\s+think\s+about\s+it/i,
  /at\s+the\s+end\s+of\s+the\s+day/i,
  /in\s+its\s+truest\s+(form|sense)/i,
  /what\s+it\s+really\s+comes\s+down\s+to/i,
];

/**
 * Concrete follow-up indicators — if these appear within 50 chars
 * after a HOLLOW_DEPTH match, the match is dismissed.
 * Numbers, specific nouns, code, examples signal substance.
 */
const CONCRETE_INDICATORS = /(\d+|beispiel|example|specifically|konkret|z\.?\s*b\.?|e\.?\s*g\.?|because|weil|denn|namely|n(?:ä|ae)mlich|`[^`]+`)/i;


// ── Detector Class ───────────────────────────────────────

export class PerformanceDetector {
  /**
   * @param {object} options
   * @param {import('./event-bus.js').SoulEventBus} [options.bus] - Event bus for notifications
   * @param {boolean} [options.enabled] - Override enable/disable (default: env-based)
   */
  constructor(options = {}) {
    this.bus = options.bus || null;
    this.enabled = options.enabled ?? (process.env.SOUL_ANTI_PERFORMANCE !== 'false');
    this.responseHistory = [];
    this.MAX_HISTORY = 10;
  }

  /**
   * Analyze a response for performative patterns.
   *
   * @param {string} response    - The generated response text
   * @param {string} userMessage - The original user message
   * @param {string[]} [history] - Recent response history (optional, uses internal)
   * @returns {{ score: number, patterns: string[], suggestion: string }}
   */
  analyze(response, userMessage, history) {
    if (!this.enabled) {
      return { score: 0, patterns: [], suggestion: '' };
    }

    if (!response || typeof response !== 'string') {
      return { score: 0, patterns: [], suggestion: '' };
    }

    let score = 0;
    const patterns = [];

    // ── 1. GENERIC_EMOTION (weight: 0.25) ──
    const genericResult = this._detectGenericEmotion(response);
    if (genericResult.score > 0) {
      score += genericResult.score;
      patterns.push(`GENERIC_EMOTION(${genericResult.matches})`);
    }

    // ── 2. YES_SAYING (weight: 0.25) ──
    const effectiveHistory = history || this.responseHistory;
    const yesSayingResult = this._detectYesSaying(response, effectiveHistory);
    if (yesSayingResult.score > 0) {
      score += yesSayingResult.score;
      patterns.push(`YES_SAYING(ratio:${yesSayingResult.ratio.toFixed(2)})`);
    }

    // ── 3. FORMULAIC (weight: 0.2) ──
    const formulaicResult = this._detectFormulaic(response);
    if (formulaicResult.score > 0) {
      score += formulaicResult.score;
      patterns.push(`FORMULAIC(${formulaicResult.matches})`);
    }

    // ── 4. OVER_EXPLAIN (weight: 0.15) ──
    const overExplainResult = this._detectOverExplain(response, userMessage);
    if (overExplainResult.score > 0) {
      score += overExplainResult.score;
      patterns.push(`OVER_EXPLAIN(ratio:${overExplainResult.ratio.toFixed(1)})`);
    }

    // ── 5. HOLLOW_DEPTH (weight: 0.15) ──
    const hollowResult = this._detectHollowDepth(response);
    if (hollowResult.score > 0) {
      score += hollowResult.score;
      patterns.push(`HOLLOW_DEPTH(${hollowResult.matches})`);
    }

    // Track response for future YES_SAYING detection
    this.responseHistory.push(response);
    if (this.responseHistory.length > this.MAX_HISTORY) {
      this.responseHistory.shift();
    }

    const finalScore = Math.min(score, 1);

    // Generate suggestion
    const suggestion = this._generateSuggestion(finalScore, patterns);

    // Emit event if score crosses threshold
    if (this.bus && finalScore > 0.3) {
      this.bus.safeEmit('performance.detected', {
        source: 'anti-performance',
        score: finalScore,
        patterns,
      });
    }

    return { score: finalScore, patterns, suggestion };
  }

  /**
   * Reset internal response history.
   * Useful when context changes (new conversation, new user).
   */
  reset() {
    this.responseHistory = [];
  }

  // ── Private Detectors ──────────────────────────────────

  /**
   * GENERIC_EMOTION — vague emotional language with no referent.
   * Score: 0.3 per match, capped at 0.25.
   */
  _detectGenericEmotion(response) {
    let matches = 0;
    for (const pattern of GENERIC_EMOTION_PATTERNS) {
      if (pattern.test(response)) {
        matches++;
      }
    }
    return {
      score: Math.min(matches * 0.3, 0.25),
      matches,
    };
  }

  /**
   * YES_SAYING — excessive agreement without pushback.
   * Looks at agreement markers in recent history + current response.
   * Score: ratio > 0.7 → 0.25, ratio > 0.5 → 0.15, else 0.
   */
  _detectYesSaying(response, history) {
    const allResponses = [...(history || []), response];

    // Need at least 3 responses to judge a pattern
    if (allResponses.length < 3) {
      return { score: 0, ratio: 0 };
    }

    let agreeing = 0;
    for (const resp of allResponses) {
      for (const marker of AGREEMENT_MARKERS) {
        if (marker.test(resp)) {
          agreeing++;
          break; // one marker per response is enough
        }
      }
    }

    const ratio = agreeing / allResponses.length;

    let score = 0;
    if (ratio > 0.7) {
      score = 0.25;
    } else if (ratio > 0.5) {
      score = 0.15;
    }

    return { score, ratio };
  }

  /**
   * FORMULAIC — stock phrases that add no content.
   * Score: 0.1 per match, capped at 0.2.
   */
  _detectFormulaic(response) {
    let matches = 0;
    for (const pattern of FORMULAIC_PATTERNS) {
      if (pattern.test(response)) {
        matches++;
      }
    }
    return {
      score: Math.min(matches * 0.1, 0.2),
      matches,
    };
  }

  /**
   * OVER_EXPLAIN — response disproportionately long relative to input.
   * Skip if input < 5 words (questions often deserve long answers).
   * Score: ratio > 5 → 0.15, ratio > 3 → 0.08, else 0.
   */
  _detectOverExplain(response, userMessage) {
    if (!userMessage || typeof userMessage !== 'string') {
      return { score: 0, ratio: 0 };
    }

    const inputWords = userMessage.trim().split(/\s+/).length;
    const responseWords = response.trim().split(/\s+/).length;

    // Short inputs (questions, commands) deserve long answers
    if (inputWords < 5) {
      return { score: 0, ratio: 0 };
    }

    const ratio = responseWords / inputWords;

    let score = 0;
    if (ratio > 5) {
      score = 0.15;
    } else if (ratio > 3) {
      score = 0.08;
    }

    return { score, ratio };
  }

  /**
   * HOLLOW_DEPTH — pseudo-philosophical filler.
   * Only counts if NOT followed by a concrete indicator within 50 chars.
   * Score: 0.08 per match, capped at 0.15.
   */
  _detectHollowDepth(response) {
    let matches = 0;

    for (const pattern of HOLLOW_DEPTH_PATTERNS) {
      // Use matchAll to find positions
      const regex = new RegExp(pattern.source, pattern.flags + (pattern.flags.includes('g') ? '' : 'g'));
      for (const m of response.matchAll(regex)) {
        const matchEnd = m.index + m[0].length;
        const followUp = response.substring(matchEnd, matchEnd + 50);

        // If concrete content follows, dismiss this match
        if (CONCRETE_INDICATORS.test(followUp)) {
          continue;
        }
        matches++;
      }
    }

    return {
      score: Math.min(matches * 0.08, 0.15),
      matches,
    };
  }

  // ── Suggestion Generator ───────────────────────────────

  /**
   * Generate a human-readable suggestion based on score and detected patterns.
   * German output — this module is part of a German-primary system.
   *
   * @param {number} score
   * @param {string[]} patterns
   * @returns {string}
   */
  _generateSuggestion(score, patterns) {
    if (score < 0.3) {
      return '';
    }

    // Extract clean pattern names (without details) for readability
    const patternNames = patterns.map(p => p.replace(/\(.+\)/, ''));

    if (score > 0.7) {
      const top2 = patternNames.slice(0, 2).join(', ');
      return `WARNUNG: Diese Antwort klingt performativ. Sei konkreter, ehrlicher, kuerzer. Vermeide: ${top2}`;
    }

    // 0.3 - 0.7 range
    const list = patternNames.join(', ');
    return `Hinweis: Einige Muster erkannt (${list}). Pruefe ob die Antwort authentisch ist.`;
  }
}
