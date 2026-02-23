/**
 * Embedding Generator — vector representations for semantic search.
 *
 * Strategies (in priority order):
 *   1. OpenAI text-embedding-3-small (if OPENAI_API_KEY available)
 *   2. Gemini embedding-001 (if GEMINI_API_KEY available)
 *   3. TF-IDF bag-of-words (offline fallback, lower quality)
 */

const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const OPENAI_DIMS = 1536;
const GEMINI_EMBEDDING_MODEL = 'text-embedding-004';

export class EmbeddingGenerator {
  constructor({ openaiKey, geminiKey } = {}) {
    this.openaiKey = openaiKey || process.env.OPENAI_API_KEY;
    this.geminiKey = geminiKey || process.env.GEMINI_API_KEY;
    this.mode = this.openaiKey ? 'openai' : this.geminiKey ? 'gemini' : 'tfidf';
    this._vocab = null; // lazy-built for TF-IDF
  }

  get dimensions() {
    if (this.mode === 'openai') return OPENAI_DIMS;
    if (this.mode === 'gemini') return 768;
    return 256; // TF-IDF fallback
  }

  async embed(text) {
    if (!text || text.trim().length === 0) return null;

    if (this.mode === 'openai') return this._embedOpenAI(text);
    if (this.mode === 'gemini') return this._embedGemini(text);
    return this._embedTFIDF(text);
  }

  async embedBatch(texts) {
    if (this.mode === 'openai') return this._embedBatchOpenAI(texts);
    // Gemini and TF-IDF: sequential
    const results = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  // ── OpenAI ─────────────────────────────────────────────

  async _embedOpenAI(text) {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: text }),
    });

    if (!res.ok) {
      console.error(`  [embeddings] OpenAI error: ${res.status}`);
      return this._embedTFIDF(text); // fallback
    }

    const data = await res.json();
    return new Float32Array(data.data[0].embedding);
  }

  async _embedBatchOpenAI(texts) {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: texts }),
    });

    if (!res.ok) {
      return texts.map(t => this._embedTFIDF(t));
    }

    const data = await res.json();
    return data.data
      .sort((a, b) => a.index - b.index)
      .map(d => new Float32Array(d.embedding));
  }

  // ── Gemini ─────────────────────────────────────────────

  async _embedGemini(text) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${this.geminiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    });

    if (!res.ok) {
      console.error(`  [embeddings] Gemini error: ${res.status}`);
      return this._embedTFIDF(text);
    }

    const data = await res.json();
    return new Float32Array(data.embedding.values);
  }

  // ── TF-IDF Fallback ────────────────────────────────────

  _embedTFIDF(text) {
    // Simple bag-of-words with hash-based dimensionality reduction
    const DIM = 256;
    const vec = new Float32Array(DIM);
    const words = text.toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1);

    if (words.length === 0) return vec;

    for (const word of words) {
      const hash = this._hashStr(word);
      const idx = Math.abs(hash) % DIM;
      const sign = hash > 0 ? 1 : -1;
      vec[idx] += sign;
    }

    // L2 normalize
    let mag = 0;
    for (let i = 0; i < DIM; i++) mag += vec[i] * vec[i];
    mag = Math.sqrt(mag);
    if (mag > 0) for (let i = 0; i < DIM; i++) vec[i] /= mag;

    return vec;
  }

  _hashStr(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash = hash & hash; // Convert to 32bit int
    }
    return hash;
  }
}
