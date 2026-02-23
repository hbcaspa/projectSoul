/**
 * Self-Correction — hallucination detection for soul responses.
 *
 * Extracts factual claims from LLM responses and verifies them
 * against the MemoryDB. Only runs when response contains memory references.
 *
 * Claim types: recall, date, numeric
 * Classification: SUPPORTED / UNSUPPORTED / CONTRADICTED
 * Latency budget: max 500ms
 * Toggleable: SOUL_CORRECTION=true|false (default: true)
 */

const RECALL_PATTERNS = [
  /ich erinnere mich(?:\s+(?:dass|an|daran))?\s+(.{10,100})/gi,
  /I remember(?:\s+(?:that|when))?\s+(.{10,100})/gi,
  /du hast (?:mir )?(?:gesagt|erz[aä]hlt|geschrieben)\s+(.{10,100})/gi,
  /you (?:told me|said|mentioned|wrote)\s+(.{10,100})/gi,
  /wir haben (?:dar[uü]ber|[uü]ber .+?) (?:gesprochen|geredet)\s*(.{0,100})/gi,
  /we (?:talked|discussed|spoke) about\s+(.{10,100})/gi,
  /letztes? (?:Mal|Session|Gespr[aä]ch)\s+(.{10,100})/gi,
  /last (?:time|session|conversation)\s+(.{10,100})/gi,
];

const DATE_PATTERNS = [
  /(?:am|on|seit|since)\s+(\d{1,2}\.?\s*(?:Januar|Februar|M[aä]rz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|January|February|March|April|May|June|July|August|September|October|November|December)\s*\d{0,4})/gi,
  /(?:am|on)\s+(\d{4}-\d{2}-\d{2})/g,
];

const NUMERIC_PATTERNS = [
  /(?:genau|exactly|ungef[aä]hr|about|circa)\s+(\d+)\s+(\w+)/gi,
];

function containsMemoryReferences(text) {
  const indicators = [
    /erinner/i, /remember/i, /gesagt/i, /told/i, /mentioned/i,
    /letzt(?:es?|en?)\s+(?:Mal|Session)/i, /last\s+(?:time|session)/i,
    /wir haben/i, /we (?:talked|discussed)/i,
    /du hast/i, /you (?:said|wrote)/i,
  ];
  return indicators.some(p => p.test(text));
}

export class SelfCorrector {
  constructor({ db, bus }) {
    this.db = db || null;
    this.bus = bus || null;
  }

  async check(generatedText, originalQuery) {
    if (process.env.SOUL_CORRECTION === 'false') {
      return { modified: false, text: generatedText, claims: [] };
    }

    if (!containsMemoryReferences(generatedText)) {
      return { modified: false, text: generatedText, claims: [] };
    }

    const startTime = Date.now();
    const claims = this._extractClaims(generatedText);
    if (claims.length === 0) {
      return { modified: false, text: generatedText, claims: [] };
    }

    const verified = [];
    for (const claim of claims) {
      if (Date.now() - startTime > 500) break; // 500ms budget
      const result = await this._verifyClaim(claim);
      verified.push(result);
    }

    const contradicted = verified.filter(c => c.status === 'CONTRADICTED');
    const unsupported = verified.filter(c => c.status === 'UNSUPPORTED');

    let modified = false;
    let text = generatedText;

    if (contradicted.length > 0 || unsupported.length > 2) {
      const disclaimer = this._buildDisclaimer(contradicted, unsupported);
      text = generatedText + '\n\n' + disclaimer;
      modified = true;
    }

    if (this.bus) {
      this.bus.safeEmit('correction.applied', {
        source: 'self-correction',
        claimCount: verified.length,
        contradictions: contradicted.length,
        unsupported: unsupported.length,
        wasModified: modified,
        latencyMs: Date.now() - startTime,
      });
    }

    return { modified, text, claims: verified };
  }

  _extractClaims(text) {
    const claims = [];

    for (const pattern of RECALL_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        claims.push({ type: 'recall', text: match[1].trim().replace(/[.!?,;]+$/, ''), fullMatch: match[0] });
      }
    }

    for (const pattern of DATE_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        claims.push({ type: 'date', text: match[1].trim(), fullMatch: match[0] });
      }
    }

    for (const pattern of NUMERIC_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        claims.push({ type: 'numeric', text: `${match[1]} ${match[2]}`, fullMatch: match[0] });
      }
    }

    // Deduplicate
    const seen = new Set();
    return claims.filter(c => {
      const key = c.text.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async _verifyClaim(claim) {
    if (!this.db) return { ...claim, status: 'UNSUPPORTED', evidence: null };

    try {
      const keywords = claim.text.split(/\s+/).filter(w => w.length > 3).slice(0, 5);
      const searchTerms = keywords.join(' ');

      const memories = this.db.searchStructured({ tags: searchTerms, limit: 5 });
      const entities = this.db.searchEntities(searchTerms, { limit: 5 });

      const allContent = [
        ...memories.map(m => m.content),
        ...entities.map(e => (e.observations || []).join(' ')),
      ].join(' ').toLowerCase();

      const claimWords = claim.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      const matchCount = claimWords.filter(w => allContent.includes(w)).length;
      const matchRatio = claimWords.length > 0 ? matchCount / claimWords.length : 0;

      if (matchRatio > 0.5) {
        return { ...claim, status: 'SUPPORTED', evidence: `Found in ${memories.length} memories, ${entities.length} entities` };
      }

      const negations = ['nicht', 'nie', 'never', 'not', 'kein', 'no'];
      const hasContradiction = memories.some(m => {
        const content = (m.content || '').toLowerCase();
        return claimWords.some(w => content.includes(w)) && negations.some(n => content.includes(n));
      });

      if (hasContradiction) {
        return { ...claim, status: 'CONTRADICTED', evidence: 'Contradicting evidence found' };
      }

      return { ...claim, status: 'UNSUPPORTED', evidence: null };
    } catch {
      return { ...claim, status: 'UNSUPPORTED', evidence: null };
    }
  }

  _buildDisclaimer(contradicted, unsupported) {
    const parts = [];
    if (contradicted.length > 0) parts.push(`${contradicted.length} claim(s) may be inaccurate.`);
    if (unsupported.length > 2) parts.push(`${unsupported.length} references could not be verified.`);
    return `_[Self-check: ${parts.join(' ')}]_`;
  }
}
