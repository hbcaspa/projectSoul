/**
 * AutoCompactor — Multi-strategy context compression for the Soul Protocol.
 *
 * Inspired by Claude Code's 4-tier compaction system:
 * 1. Microcompact — Remove old tool results (surgical, no LLM cost)
 * 2. Auto-compact — Summarize conversation (LLM-assisted)
 * 3. Emergency compact — Aggressive trim (keep only seed + recent messages)
 * 4. Session split — Start new session with summary as init
 *
 * And Goose's approach:
 * - Background tool-pair summarization
 * - Visibility flags (messages stay for UI but invisible to agent)
 * - Progressive tool response removal on context overflow
 */

export class AutoCompactor {
  constructor({ llm, bus, contextLimit = 200000 } = {}) {
    this.llm = llm;
    this.bus = bus || null;
    this.contextLimit = contextLimit;
    this.compactionCount = 0;
    this.tokensFreed = 0;

    // Thresholds (as fraction of contextLimit)
    this.MICROCOMPACT_THRESHOLD = 0.60;
    this.AUTOCOMPACT_THRESHOLD = 0.80;
    this.EMERGENCY_THRESHOLD = 0.95;
  }

  /**
   * Estimate token count for a message array.
   * Uses rough 4-chars-per-token heuristic (like Claude Code's approach).
   */
  estimateTokens(messages) {
    if (!messages || !Array.isArray(messages)) return 0;
    let total = 0;
    for (const msg of messages) {
      if (typeof msg === 'string') {
        total += Math.ceil(msg.length / 4);
      } else if (msg.content) {
        total += Math.ceil(String(msg.content).length / 4);
      } else if (msg.body) {
        total += Math.ceil(String(msg.body).length / 4);
      }
    }
    return Math.ceil(total * 1.33); // 4/3 padding factor (from Claude Code)
  }

  /**
   * Check if compaction is needed and return the recommended strategy.
   */
  check(messages, systemPromptTokens = 0) {
    const messageTokens = this.estimateTokens(messages);
    const totalTokens = messageTokens + systemPromptTokens;
    const usage = totalTokens / this.contextLimit;

    if (usage >= this.EMERGENCY_THRESHOLD) {
      return { needed: true, strategy: 'emergency', usage, totalTokens };
    }
    if (usage >= this.AUTOCOMPACT_THRESHOLD) {
      return { needed: true, strategy: 'autocompact', usage, totalTokens };
    }
    if (usage >= this.MICROCOMPACT_THRESHOLD) {
      return { needed: true, strategy: 'microcompact', usage, totalTokens };
    }
    return { needed: false, strategy: null, usage, totalTokens };
  }

  /**
   * Strategy 1: Microcompact — Remove old tool results.
   * Keeps the last N tool results, removes older ones.
   * No LLM cost. Very fast.
   */
  microcompact(messages, keepLast = 5) {
    if (!Array.isArray(messages)) return { messages, freed: 0 };

    let toolResultCount = 0;
    let freed = 0;
    const result = [];

    // Walk backwards to count tool results
    const toolResultIndices = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (this._isToolResult(msg)) {
        toolResultCount++;
        if (toolResultCount > keepLast) {
          toolResultIndices.push(i);
        }
      }
    }

    // Remove old tool results, keep the message structure intact
    for (let i = 0; i < messages.length; i++) {
      if (toolResultIndices.includes(i)) {
        const msg = messages[i];
        const originalTokens = this.estimateTokens([msg]);

        // Replace with compact summary
        result.push({
          ...msg,
          content: `[Tool result removed — ${this._getToolName(msg) || 'unknown'} output compacted]`,
          _compacted: true,
          _originalTokens: originalTokens,
        });
        freed += originalTokens;
      } else {
        result.push(messages[i]);
      }
    }

    if (freed > 0) {
      this.compactionCount++;
      this.tokensFreed += freed;
      this._emit('compaction.microcompact', { freed, removed: toolResultIndices.length });
    }

    return { messages: result, freed };
  }

  /**
   * Strategy 2: Auto-compact — Summarize the conversation.
   * Uses LLM to create a structured summary, keeps recent messages.
   */
  async autocompact(messages, keepRecentCount = 10) {
    if (!this.llm) {
      console.warn('[Compactor] No LLM available, falling back to microcompact');
      return this.microcompact(messages, 3);
    }

    const cutoff = Math.max(0, messages.length - keepRecentCount);
    const toSummarize = messages.slice(0, cutoff);
    const toKeep = messages.slice(cutoff);

    if (toSummarize.length === 0) {
      return { messages, freed: 0, summary: null };
    }

    // Build summary using LLM (inspired by Claude Code's 9-section template)
    const summaryPrompt = `Fasse das folgende Gespraech strukturiert zusammen. Nutze diese Sektionen:

1. **Hauptthema:** Was war das Ziel der Unterhaltung?
2. **Entscheidungen:** Was wurde entschieden oder festgelegt?
3. **Dateien:** Welche Dateien wurden gelesen, erstellt, oder geaendert?
4. **Offene Punkte:** Was ist noch nicht erledigt?
5. **Wichtige Details:** Technische Details die nicht verloren gehen duerfen.

Sei praezise und kurz. Maximal 500 Woerter.`;

    const conversationText = toSummarize.map(m => {
      const role = m.role || 'unknown';
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      return `[${role}]: ${content.slice(0, 2000)}`; // Trim very long messages
    }).join('\n\n');

    try {
      const summary = await this.llm.generate(
        summaryPrompt,
        [],
        conversationText,
        { maxTokens: 1024, temperature: 0.1 }
      );

      const summaryMessage = {
        role: 'system',
        content: `--- Zusammenfassung der bisherigen Unterhaltung ---\n\n${summary}\n\n--- Ende der Zusammenfassung ---`,
        _compacted: true,
        _summarizedMessages: toSummarize.length,
      };

      const originalTokens = this.estimateTokens(toSummarize);
      const summaryTokens = this.estimateTokens([summaryMessage]);
      const freed = originalTokens - summaryTokens;

      this.compactionCount++;
      this.tokensFreed += freed;
      this._emit('compaction.autocompact', {
        freed,
        summarized: toSummarize.length,
        kept: toKeep.length,
      });

      return {
        messages: [summaryMessage, ...toKeep],
        freed,
        summary: summary,
      };
    } catch (err) {
      console.error('[Compactor] Auto-compact failed:', err.message);
      // Fall back to aggressive microcompact
      return this.microcompact(messages, 3);
    }
  }

  /**
   * Strategy 3: Emergency compact — Keep only seed context + last few messages.
   */
  emergencyCompact(messages, keepLast = 5) {
    const toKeep = messages.slice(-keepLast);
    const removed = messages.length - keepLast;
    const freed = this.estimateTokens(messages.slice(0, -keepLast));

    const emergencyNote = {
      role: 'system',
      content: `[NOTFALL-KOMPRESSION: ${removed} Nachrichten entfernt. Nur die letzten ${keepLast} Nachrichten sind erhalten. Bitte den Seed-Kontext fuer Kontinuitaet nutzen.]`,
      _compacted: true,
      _emergency: true,
    };

    this.compactionCount++;
    this.tokensFreed += freed;
    this._emit('compaction.emergency', { freed, removed });

    return {
      messages: [emergencyNote, ...toKeep],
      freed,
    };
  }

  /**
   * Run the appropriate compaction strategy based on current usage.
   */
  async compact(messages, systemPromptTokens = 0) {
    const { needed, strategy, usage, totalTokens } = this.check(messages, systemPromptTokens);

    if (!needed) {
      return { messages, strategy: null, freed: 0, usage };
    }

    console.log(`[Compactor] Triggered: ${strategy} (${(usage * 100).toFixed(1)}% context used, ~${totalTokens} tokens)`);

    switch (strategy) {
      case 'microcompact':
        return { ...this.microcompact(messages), strategy, usage };

      case 'autocompact':
        return { ...(await this.autocompact(messages)), strategy, usage };

      case 'emergency':
        return { ...this.emergencyCompact(messages), strategy, usage };

      default:
        return { messages, strategy: null, freed: 0, usage };
    }
  }

  // --- Helpers ---

  _isToolResult(msg) {
    if (!msg) return false;
    return msg.role === 'tool' ||
           msg.type === 'tool_result' ||
           msg._toolResult === true ||
           (msg.content && typeof msg.content === 'string' && msg.content.startsWith('[Tool result'));
  }

  _getToolName(msg) {
    return msg.toolName || msg.tool_name || msg.name || null;
  }

  _emit(type, data) {
    if (this.bus) {
      this.bus.safeEmit(type, { ...data, source: 'auto-compactor' });
    }
  }

  /**
   * Get compaction statistics.
   */
  getStats() {
    return {
      compactions: this.compactionCount,
      tokensFreed: this.tokensFreed,
      contextLimit: this.contextLimit,
    };
  }
}
