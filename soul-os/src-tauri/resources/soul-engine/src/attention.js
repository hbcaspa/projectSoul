/**
 * Attention Model — RAG (Retrieval Augmented Generation) for soul memories.
 *
 * Builds relevant context from the Hybrid Memory Layer for each conversation.
 * Weighted scoring: 0.5 * semantic + 0.3 * recency + 0.2 * confidence
 *
 * Token budget: max ~2000 tokens of context injected per message.
 */

import { cosineSimilarity } from './memory-db.js';

const MAX_CONTEXT_CHARS = 6000; // ~2000 tokens
const DEFAULT_TOP_K = 8;

export class AttentionModel {
  constructor({ db, embeddings, context, bus }) {
    this.db = db;
    this.embeddings = embeddings || null;
    this.context = context || null;
    this.bus = bus || null;
  }

  /**
   * Build relevant context for a user message.
   * Combines semantic search with structured search and ranks by composite score.
   */
  async buildContext(userMessage, channel = 'unknown', userName = 'unknown') {
    if (!this.db) return '';

    const candidates = [];
    const now = Date.now();

    // Strategy 1: Semantic search (if embeddings available)
    if (this.embeddings) {
      try {
        const queryEmb = await this.embeddings.embed(userMessage);
        if (queryEmb) {
          const semanticResults = this.db.searchSemantic(queryEmb, { limit: 20, minSimilarity: 0.2 });
          for (const mem of semanticResults) {
            candidates.push({
              ...mem,
              semanticScore: mem.similarity || 0,
              source: 'semantic',
            });
          }
        }
      } catch (err) {
        console.error(`  [attention] Semantic search failed: ${err.message}`);
      }
    }

    // Strategy 2: Structured search — recent memories
    try {
      const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
      const recentMemories = this.db.searchStructured({ since: sevenDaysAgo, limit: 20 });

      for (const mem of recentMemories) {
        if (!candidates.some(c => c.id === mem.id)) {
          candidates.push({ ...mem, semanticScore: 0, source: 'structured' });
        }
      }
    } catch (err) {
      console.error(`  [attention] Structured search failed: ${err.message}`);
    }

    // Strategy 3: User-specific interactions
    try {
      const interactions = this.db.getInteractionHistory({ user: userName, limit: 5 });
      for (const interaction of interactions) {
        candidates.push({
          id: `interaction-${interaction.id}`,
          content: `[${interaction.user}] ${interaction.message}`,
          created_at: interaction.timestamp,
          confidence: 0.6,
          semanticScore: 0.1,
          source: 'interaction',
          type: 'interaction',
        });
      }
    } catch {
      // Interactions table might not have data yet
    }

    if (candidates.length === 0) return '';

    // Score and rank
    const scored = candidates.map(mem => ({
      ...mem,
      compositeScore: this.scoreRelevance(mem, now),
    }));

    scored.sort((a, b) => b.compositeScore - a.compositeScore);

    // Take top-K within token budget
    const topK = scored.slice(0, DEFAULT_TOP_K);
    let contextStr = '';
    let charCount = 0;

    for (const mem of topK) {
      const entry = this._formatMemory(mem);
      if (charCount + entry.length > MAX_CONTEXT_CHARS) break;
      contextStr += entry + '\n';
      charCount += entry.length;
    }

    if (this.bus && contextStr) {
      this.bus.safeEmit('attention.context_built', {
        source: 'attention',
        memoryCount: topK.length,
        totalChars: charCount,
        channel,
        userName,
      });
    }

    return contextStr.trim();
  }

  /**
   * Compute composite relevance score for a memory.
   * 0.5 * semantic + 0.3 * recency + 0.2 * confidence
   */
  scoreRelevance(memory, now = Date.now()) {
    const semantic = memory.semanticScore || 0;
    const confidence = memory.confidence || 0.5;

    // Recency: exponential decay, half-life of 7 days
    const createdAt = memory.created_at ? new Date(memory.created_at).getTime() : now;
    const ageMs = now - createdAt;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    const recency = Math.exp(-0.693 * ageDays / 7);

    return 0.5 * semantic + 0.3 * recency + 0.2 * confidence;
  }

  _formatMemory(memory) {
    const date = memory.created_at ? memory.created_at.split('T')[0] : '?';
    const type = memory.type || 'memory';
    const score = memory.compositeScore ? ` (rel:${memory.compositeScore.toFixed(2)})` : '';
    const content = (memory.content || '').substring(0, 300);
    return `- [${type}/${date}]${score}: ${content}`;
  }
}
