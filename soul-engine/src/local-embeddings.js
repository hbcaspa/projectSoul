/**
 * LocalEmbeddings — Lokale Vektor-Embeddings via Ollama
 *
 * Das Problem: Aktuell nutzen wir Gemini für Embeddings → API-Kosten,
 * Vendor Lock-in, Latenz, Datenschutz (Daten gehen an Google).
 *
 * Lösung: Ollama + nomic-embed-text als lokale Alternative.
 *
 * Features:
 *  - Nutzt Ollama REST API (localhost:11434)
 *  - nomic-embed-text: 768-dim Vektoren, MTEB top-tier, 8192 Token Kontext
 *  - Fallback auf Gemini wenn Ollama nicht verfügbar
 *  - Batch-Embedding für Effizienz (bis zu 50 Texte gleichzeitig)
 *  - Caching: LRU-Cache für häufig abgefragte Texte
 *  - Auto-Pull: Lädt Modell automatisch wenn nicht vorhanden
 *
 * Konfiguration:
 *   EMBEDDING_PROVIDER=ollama         (ollama|gemini|auto)
 *   OLLAMA_URL=http://localhost:11434
 *   OLLAMA_EMBED_MODEL=nomic-embed-text
 */

const DEFAULT_MODEL = 'nomic-embed-text';
const CACHE_SIZE = 500;
const BATCH_SIZE = 50;

export class LocalEmbeddings {
  constructor({ ollamaUrl, model, bus } = {}) {
    this.ollamaUrl = ollamaUrl || process.env.OLLAMA_URL || 'http://localhost:11434';
    this.model     = model || process.env.OLLAMA_EMBED_MODEL || DEFAULT_MODEL;
    this.bus       = bus;
    this._cache    = new Map(); // text hash → vector
    this._available = null; // null = unchecked, true/false
    this._pullInProgress = false;
  }

  /**
   * Check if Ollama is available with the embedding model.
   */
  async isAvailable() {
    if (this._available !== null) return this._available;

    try {
      const resp = await fetch(`${this.ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) { this._available = false; return false; }

      const data = await resp.json();
      const models = (data.models || []).map(m => m.name);
      this._available = models.some(m => m.startsWith(this.model));

      if (!this._available && !this._pullInProgress) {
        // Auto-pull the model in background
        this._pullModel().catch(() => {});
      }

      return this._available;
    } catch {
      this._available = false;
      return false;
    }
  }

  /**
   * Generate embedding for a single text.
   * @param {string} text - Input text (up to 8192 tokens)
   * @returns {number[]|null} - Embedding vector (768 dimensions for nomic) or null
   */
  async embed(text) {
    if (!text?.trim()) return null;

    // Check cache
    const hash = this._hash(text);
    if (this._cache.has(hash)) return this._cache.get(hash);

    const available = await this.isAvailable();
    if (!available) return null;

    try {
      const resp = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: text.substring(0, 8000), // Stay within model's context
          keep_alive: process.env.OLLAMA_KEEP_ALIVE || '30m', // Modell geladen halten → kein Cold-Start
        }),
        // Cold-Start von nomic-embed-text dauert ~11s; 10s war zu knapp (erster Embed
        // nach Idle lief in Timeout → semantische Suche fiel still aus). 30s deckt das ab.
        signal: AbortSignal.timeout(parseInt(process.env.OLLAMA_EMBED_TIMEOUT_MS || '30000', 10)),
      });

      if (!resp.ok) return null;

      const data = await resp.json();
      const embedding = data.embedding;

      if (embedding && Array.isArray(embedding)) {
        this._cacheSet(hash, embedding);
        return embedding;
      }
      return null;

    } catch (err) {
      console.error(`  [local-embed] Error: ${err.message}`);
      return null;
    }
  }

  /**
   * Batch-embed multiple texts efficiently.
   * @param {string[]} texts - Array of input texts
   * @returns {(number[]|null)[]} - Array of embeddings
   */
  async embedBatch(texts) {
    if (!texts?.length) return [];

    const results = new Array(texts.length).fill(null);
    const toEmbed = [];

    // Check cache first
    for (let i = 0; i < texts.length; i++) {
      const hash = this._hash(texts[i]);
      if (this._cache.has(hash)) {
        results[i] = this._cache.get(hash);
      } else {
        toEmbed.push({ index: i, text: texts[i] });
      }
    }

    // Embed uncached in batches
    for (let b = 0; b < toEmbed.length; b += BATCH_SIZE) {
      const batch = toEmbed.slice(b, b + BATCH_SIZE);
      const embeddings = await Promise.all(
        batch.map(({ text }) => this.embed(text))
      );

      for (let j = 0; j < batch.length; j++) {
        results[batch[j].index] = embeddings[j];
      }
    }

    return results;
  }

  /**
   * Get embedding dimensions for this model.
   */
  getDimensions() {
    const dims = {
      'nomic-embed-text': 768,
      'mxbai-embed-large': 1024,
      'all-minilm': 384,
      'snowflake-arctic-embed': 1024,
    };
    return dims[this.model] || 768;
  }

  get mode() {
    return this._available ? `ollama:${this.model}` : 'ollama:unavailable';
  }

  // ── Auto-Pull ──────────────────────────────────────────────

  async _pullModel() {
    if (this._pullInProgress) return;
    this._pullInProgress = true;

    console.log(`  [local-embed] Pulling ${this.model}...`);

    try {
      const resp = await fetch(`${this.ollamaUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.model, stream: false }),
        signal: AbortSignal.timeout(300000), // 5 min for model download
      });

      if (resp.ok) {
        console.log(`  [local-embed] Model ${this.model} pulled successfully`);
        this._available = true;
        this.bus?.safeEmit?.('embeddings.model_ready', { model: this.model });
      }
    } catch (err) {
      console.error(`  [local-embed] Pull failed: ${err.message}`);
    } finally {
      this._pullInProgress = false;
    }
  }

  // ── Cache ──────────────────────────────────────────────────

  _hash(text) {
    // Simple hash for cache key
    let hash = 0;
    const str = text.substring(0, 500); // Only hash first 500 chars
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return hash;
  }

  _cacheSet(hash, value) {
    if (this._cache.size >= CACHE_SIZE) {
      // Evict oldest (first inserted)
      const firstKey = this._cache.keys().next().value;
      this._cache.delete(firstKey);
    }
    this._cache.set(hash, value);
  }
}
