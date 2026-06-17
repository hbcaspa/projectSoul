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
  constructor({ llm, db, bus, soulPath, embeddings } = {}) {
    this.llm = llm;
    this.db = db;
    this.bus = bus || null;
    this.soulPath = soulPath;
    // M2: embedder for storing memory vectors. Wired by the engine (Ollama
    // nomic-embed-text 768d when available). Null → memories stored without vector.
    this.embeddings = embeddings || null;
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

WICHTIG: Variiere confidence nach Sicherheit der Erinnerung!
- 0.9 = eindeutiges Faktum, klare Aussage des Nutzers, mehrfach bestaetigt
- 0.7 = klare Beobachtung, ein einzelnes klares Indiz
- 0.5 = plausibel aber nicht eindeutig (Default — nur wenn unsicher)
- 0.3 = Vermutung, leicht widerlegbar
- 0.1 = Spekulation
Nicht alle Memories sollen 0.5 sein. Die Decay-Logik nutzt diesen Wert.

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
   * Store extracted memories — Mem0-Style ADD/UPDATE/DELETE/NONE.
   * Statt blindem INSERT: für jede neue Memory wird via FTS5 nach
   * ähnlichen bestehenden gesucht, und das LLM entscheidet:
   *   ADD → neue Memory anlegen
   *   UPDATE id=X → bestehende mit reicherer Version ersetzen
   *   DELETE id=X → widersprochene Memory entfernen
   *   NONE → ignorieren (Duplikat / irrelevant)
   * Fallback: wenn LLM/FTS nicht verfügbar, klassischer INSERT.
   */
  async _store(memories) {
    if (!this.db || !this.db.db) return;
    if (!memories || memories.length === 0) return;

    const hasFTS = typeof this.db.searchFTS === 'function';
    const hasInsert = typeof this.db.insertMemory === 'function';
    const canDecide = !!this.llm && hasFTS;

    for (const m of memories) {
      // M2: embed content so the vector gets stored (was missing entirely →
      // searchSemantic found nothing). Null-safe: no embedder / Ollama down → null.
      const memEmbedding = await this._embedForStore(m.content);
      if (!canDecide) {
        if (hasInsert) {
          this.db.insertMemory({
            type: m.type,
            source: 'auto-extract',
            content: m.content,
            embedding: memEmbedding,
            confidence: m.confidence,
            tags: m.tags,
          });
        } else {
          this.db.db.prepare(`
            INSERT INTO memories (type, source, content, confidence, tags, metadata)
            VALUES (?, 'auto-extract', ?, ?, ?, '{}')
          `).run(m.type, m.content, m.confidence, m.tags);
        }
        continue;
      }

      // Top-5 ähnliche bestehende Memories suchen
      const candidates = this.db.searchFTS(m.content, { limit: 5, type: m.type }) || [];
      if (candidates.length === 0) {
        // Nichts ähnliches → einfacher ADD
        this.db.insertMemory({
          type: m.type, source: 'auto-extract',
          content: m.content, embedding: memEmbedding, confidence: m.confidence, tags: m.tags,
        });
        continue;
      }

      const decision = await this._decide(m, candidates);
      try {
        if (decision.action === 'ADD') {
          this.db.insertMemory({
            type: m.type, source: 'auto-extract',
            content: m.content, embedding: memEmbedding, confidence: m.confidence, tags: m.tags,
          });
        } else if (decision.action === 'UPDATE' && decision.id) {
          // updateMemory existiert nicht direkt — wir nutzen DELETE+INSERT als atomare Replace
          this.db.deleteMemory(decision.id);
          const updContent = decision.content || m.content;
          this.db.insertMemory({
            type: m.type, source: 'auto-extract',
            content: updContent,
            embedding: updContent === m.content ? memEmbedding : await this._embedForStore(updContent),
            confidence: Math.max(m.confidence, decision.confidence || m.confidence),
            tags: m.tags,
          });
          if (this.bus) {
            this.bus.safeEmit('memory.updated', { source: 'memory-extractor', replacedId: decision.id });
          }
        } else if (decision.action === 'DELETE' && decision.id) {
          this.db.deleteMemory(decision.id);
          if (this.bus) {
            this.bus.safeEmit('memory.deleted', { source: 'memory-extractor', id: decision.id });
          }
        }
        // NONE → nichts tun (Duplikat)
      } catch (err) {
        console.error('[MemExtract] decision-apply failed:', err.message);
        // Fallback: einfach inserten, damit nichts verloren geht
        try {
          this.db.insertMemory({
            type: m.type, source: 'auto-extract',
            content: m.content, embedding: memEmbedding, confidence: m.confidence, tags: m.tags,
          });
        } catch {}
      }
    }
  }

  /**
   * Embed content for storage as a Float32 BLOB (M2). Uses the wired embedder
   * (Ollama nomic-embed-text 768d when available). Null-safe: returns null when
   * no embedder is attached or embedding fails → memory is stored without a vector
   * (FTS5 keyword search still works). Query side (attention.js) uses the SAME
   * embedder instance, so stored and query vectors share dimensionality.
   */
  async _embedForStore(content) {
    if (!this.embeddings || !content) return null;
    try {
      const vec = await this.embeddings.embed(content);
      // Accept both number[] (Ollama LocalEmbeddings) and Float32Array (API
      // EmbeddingGenerator) so the store path works with either embedder.
      if (vec && (Array.isArray(vec) || ArrayBuffer.isView(vec)) && vec.length) {
        return Buffer.from(Float32Array.from(vec).buffer);
      }
    } catch (err) {
      console.error('[MemExtract] embed failed:', err.message);
    }
    return null;
  }

  /**
   * Mem0-Style update decision. Prompt-Wortlaut angelehnt an Mem0's
   * DEFAULT_UPDATE_MEMORY_PROMPT (Apache-2.0, mem0ai/mem0).
   */
  async _decide(newMem, candidates) {
    const cList = candidates.map(c =>
      `  id=${c.id} confidence=${c.confidence?.toFixed?.(2) || '?'}: ${c.content}`
    ).join('\n');

    const prompt = `Du verwaltest eine Memory-Datenbank. Eine neue Memory wurde extrahiert.
Entscheide pro neuer Memory die richtige Aktion gegenueber den AEHNLICHEN bestehenden.

NEUE MEMORY:
  type=${newMem.type} confidence=${newMem.confidence}: ${newMem.content}

AEHNLICHE BESTEHENDE (max 5):
${cList}

REGELN:
- ADD: Neue Information ergaenzt die Datenbank, kein Konflikt mit bestehenden
- UPDATE id=X: Neue Info hat dieselbe Bedeutung wie bestehende X, ist aber reicher/genauer
- DELETE id=X: Neue Info widerspricht klar X (z.B. "mag X" vs. "mag X nicht mehr")
- NONE: Reines Duplikat einer bestehenden Memory, nichts zu tun

Antworte NUR mit JSON. Kein Markdown. Format:
{"action":"ADD"} ODER
{"action":"UPDATE","id":<rowid>,"content":"<merged better version>","confidence":<0-1>} ODER
{"action":"DELETE","id":<rowid>} ODER
{"action":"NONE"}`;

    try {
      const response = await this.llm.generate(
        'Du entscheidest Memory-Aktionen. NUR JSON antworten.',
        [], prompt, { maxTokens: 200, temperature: 0.1 }
      );
      const j = response.match(/\{[\s\S]*\}/);
      if (!j) return { action: 'ADD' };
      const d = JSON.parse(j[0]);
      if (!['ADD','UPDATE','DELETE','NONE'].includes(d.action)) return { action: 'ADD' };
      return d;
    } catch (err) {
      console.error('[MemExtract] decide failed:', err.message);
      return { action: 'ADD' };
    }
  }

  getStats() {
    return { ...this.stats };
  }
}
