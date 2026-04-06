/**
 * MemoryExtractor — Automatic memory extraction from conversations.
 *
 * Inspired by Claude Code's forked agent pattern:
 * - Runs as background process after each meaningful message
 * - Classifies memories into types (episodic, semantic, emotional)
 * - Writes to SQLite MemoryDB (not files)
 * - Uses a small/fast model to minimize cost
 * - Fire-and-forget: does not block the main conversation
 *
 * And Claude Code's 4-type taxonomy:
 * - user (who the person is)
 * - feedback (corrections + confirmations)
 * - project (ongoing work context)
 * - reference (pointers to external systems)
 *
 * Extended with Soul-specific types:
 * - episodic (concrete experiences)
 * - semantic (recognized patterns)
 * - emotional (emotional resonances)
 */

export class MemoryExtractor {
  constructor({ llm, db, bus, soulPath } = {}) {
    this.llm = llm;
    this.db = db;
    this.bus = bus || null;
    this.soulPath = soulPath;
    this._extracting = false;
    this._pendingQueue = [];
    this.stats = { extracted: 0, skipped: 0, errors: 0 };
  }

  /**
   * Register event bus listeners for automatic extraction.
   */
  registerListeners() {
    if (!this.bus) return;

    // Extract after meaningful messages
    this.bus.on('message.received', (event) => {
      if (event.text && event.text.length > 50) {
        this.queueExtraction(event.text, 'user_message', event);
      }
    });

    this.bus.on('message.responded', (event) => {
      if (event.text && event.text.length > 100) {
        this.queueExtraction(event.text, 'soul_response', event);
      }
    });

    // Extract from completed heartbeats
    this.bus.on('heartbeat.completed', (event) => {
      if (event.summary) {
        this.queueExtraction(event.summary, 'heartbeat', event);
      }
    });

    console.log('  MemExtract: listeners registered');
  }

  /**
   * Queue a text for background extraction.
   * Coalesces rapid requests — only the last pending extraction runs.
   */
  queueExtraction(text, source, context = {}) {
    this._pendingQueue.push({ text, source, context, queued: Date.now() });

    // Debounce: process after 2 seconds of quiet
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._processQueue(), 2000);
  }

  async _processQueue() {
    if (this._extracting || this._pendingQueue.length === 0) return;
    this._extracting = true;

    // Take all pending items
    const items = [...this._pendingQueue];
    this._pendingQueue = [];

    try {
      // Combine all texts for a single extraction call
      const combinedText = items.map(i =>
        `[${i.source}] ${i.text.slice(0, 1000)}`
      ).join('\n\n---\n\n');

      const memories = await this._extract(combinedText);

      if (memories && memories.length > 0) {
        await this._store(memories);
        this.stats.extracted += memories.length;

        if (this.bus) {
          this.bus.safeEmit('memory.extracted', {
            count: memories.length,
            types: memories.map(m => m.type),
            source: 'memory-extractor'
          });
        }
      } else {
        this.stats.skipped += items.length;
      }
    } catch (err) {
      console.error('[MemExtract] Error:', err.message);
      this.stats.errors++;
    } finally {
      this._extracting = false;

      // Process any items that arrived during extraction
      if (this._pendingQueue.length > 0) {
        setTimeout(() => this._processQueue(), 1000);
      }
    }
  }

  /**
   * Extract memories from text using LLM.
   * Returns array of { type, content, confidence, tags }.
   */
  async _extract(text) {
    if (!this.llm) return [];

    const prompt = `Analysiere den folgenden Text und extrahiere WICHTIGE Erinnerungen.
Nur Dinge die langfristig relevant sind — keine trivialen Details.

Kategorisiere jede Erinnerung:
- "episodic" — ein konkretes Ereignis das passiert ist
- "semantic" — ein erkanntes Muster oder eine Erkenntnis
- "emotional" — etwas das emotional beruehrt hat
- "feedback" — eine Korrektur oder Bestaetigung des Verhaltens
- "reference" — ein Verweis auf ein externes System/Tool/Ort

Antworte NUR mit einem JSON-Array. Wenn nichts wichtig genug ist: leeres Array [].

Format:
[
  {
    "type": "episodic|semantic|emotional|feedback|reference",
    "content": "Kurze, praezise Beschreibung (max 200 Zeichen)",
    "confidence": 0.5,
    "tags": "komma,getrennte,stichworte"
  }
]

Text:
${text.slice(0, 4000)}`;

    try {
      const response = await this.llm.generate(
        'Du bist ein Memory-Extraktor. Extrahiere nur wirklich wichtige Erinnerungen. Antworte NUR mit validem JSON.',
        [],
        prompt,
        { maxTokens: 1024, temperature: 0.1 }
      );

      // Parse JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];

      const memories = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(memories)) return [];

      // Validate each memory
      return memories.filter(m =>
        m.type && m.content &&
        ['episodic', 'semantic', 'emotional', 'feedback', 'reference'].includes(m.type)
      ).map(m => ({
        type: m.type,
        content: String(m.content).slice(0, 500),
        confidence: Math.min(1.0, Math.max(0.0, parseFloat(m.confidence) || 0.5)),
        tags: String(m.tags || ''),
      }));
    } catch (err) {
      console.error('[MemExtract] LLM extraction failed:', err.message);
      return [];
    }
  }

  /**
   * Store extracted memories in the database.
   */
  async _store(memories) {
    if (!this.db || !this.db.db) return;

    const stmt = this.db.db.prepare(`
      INSERT INTO memories (type, source, content, confidence, tags, metadata)
      VALUES (?, 'auto-extract', ?, ?, ?, '{}')
    `);

    const tx = this.db.db.transaction(() => {
      for (const m of memories) {
        stmt.run(m.type, m.content, m.confidence, m.tags);
      }
    });
    tx();
  }

  getStats() {
    return { ...this.stats };
  }
}
