/**
 * SubagentManager — Spawn isolated sub-agents for parallel tasks.
 *
 * Each subagent gets a role, a goal, and optionally context.
 * They run as isolated LLM conversations via Promise.all.
 * Results are collected and returned to the parent.
 *
 * Events emitted on the bus:
 *   subagent.started   — when a subagent begins execution
 *   subagent.completed  — when a subagent finishes (success or failure)
 *   subagent.batch.started   — when a batch spawn begins
 *   subagent.batch.completed — when all subagents in a batch finish
 */

import { randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 60_000; // 60 seconds per subagent
const DEFAULT_MAX_TOKENS = 2048;

export class SubagentManager {
  constructor({ llm, bus, soulPath }) {
    this.llm = llm;
    this.bus = bus;
    this.soulPath = soulPath;
    this.active = new Map(); // id → { role, goal, startedAt }
    this.history = [];       // last N completed results
    this.maxHistory = 50;
  }

  /**
   * Spawn multiple subagents in parallel.
   *
   * @param {Array<{ role: string, goal: string, context?: string, maxTokens?: number }>} agents
   * @returns {Promise<Array<{ id: string, role: string, status: string, result?: string, error?: string, durationMs: number }>>}
   */
  async spawn(agents) {
    if (!Array.isArray(agents) || agents.length === 0) {
      throw new Error('agents must be a non-empty array');
    }

    const batchId = randomUUID().slice(0, 8);

    this.bus.safeEmit('subagent.batch.started', {
      source: 'subagent',
      batchId,
      count: agents.length,
      roles: agents.map(a => a.role),
    });

    const promises = agents.map(agent => this.spawnOne({
      role: agent.role,
      goal: agent.goal,
      context: agent.context || '',
      maxTokens: agent.maxTokens || DEFAULT_MAX_TOKENS,
      batchId,
    }));

    const results = await Promise.all(promises);

    this.bus.safeEmit('subagent.batch.completed', {
      source: 'subagent',
      batchId,
      count: results.length,
      succeeded: results.filter(r => r.status === 'completed').length,
      failed: results.filter(r => r.status === 'error').length,
      timedOut: results.filter(r => r.status === 'timeout').length,
    });

    return results;
  }

  /**
   * Spawn a single subagent as an isolated LLM call with timeout protection.
   *
   * @param {{ role: string, goal: string, context?: string, maxTokens?: number, batchId?: string }} params
   * @returns {Promise<{ id: string, role: string, status: string, result?: string, error?: string, durationMs: number }>}
   */
  async spawnOne({ role, goal, context = '', maxTokens = DEFAULT_MAX_TOKENS, batchId = null }) {
    const id = randomUUID().slice(0, 8);
    const startedAt = Date.now();

    // Track active subagent
    this.active.set(id, { role, goal, startedAt, batchId });

    this.bus.safeEmit('subagent.started', {
      source: 'subagent',
      agentId: id,
      batchId,
      role,
      goal: goal.substring(0, 200),
    });

    try {
      // Build the system prompt from the role
      const systemPrompt = [
        `You are a focused sub-agent with the role: ${role}.`,
        `Complete the following goal precisely and concisely.`,
        context ? `\nContext:\n${context}` : '',
      ].filter(Boolean).join('\n');

      // LLM call with timeout protection
      const result = await this._withTimeout(
        this.llm.generate(systemPrompt, [], goal, { max_tokens: maxTokens }),
        DEFAULT_TIMEOUT_MS
      );

      const durationMs = Date.now() - startedAt;
      const entry = { id, role, status: 'completed', result, durationMs, batchId };

      this._recordHistory(entry);
      this.active.delete(id);

      this.bus.safeEmit('subagent.completed', {
        source: 'subagent',
        agentId: id,
        batchId,
        role,
        status: 'completed',
        durationMs,
        resultLength: result?.length || 0,
      });

      return entry;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const isTimeout = err.message === 'Subagent timeout';
      const status = isTimeout ? 'timeout' : 'error';
      const entry = { id, role, status, error: err.message, durationMs, batchId };

      this._recordHistory(entry);
      this.active.delete(id);

      this.bus.safeEmit('subagent.completed', {
        source: 'subagent',
        agentId: id,
        batchId,
        role,
        status,
        durationMs,
        error: err.message,
      });

      return entry;
    }
  }

  /**
   * Wrap a promise with a timeout.
   * @param {Promise} promise
   * @param {number} ms
   * @returns {Promise}
   */
  _withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Subagent timeout')), ms);
      promise
        .then(val => { clearTimeout(timer); resolve(val); })
        .catch(err => { clearTimeout(timer); reject(err); });
    });
  }

  /**
   * Record a completed subagent in the rolling history.
   */
  _recordHistory(entry) {
    this.history.push({ ...entry, completedAt: Date.now() });
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  /**
   * Get count and details of currently active subagents.
   */
  getStatus() {
    return {
      activeCount: this.active.size,
      active: Array.from(this.active.entries()).map(([id, info]) => ({
        id,
        role: info.role,
        goal: info.goal.substring(0, 100),
        runningMs: Date.now() - info.startedAt,
        batchId: info.batchId,
      })),
      historyCount: this.history.length,
      recentHistory: this.history.slice(-10).map(h => ({
        id: h.id,
        role: h.role,
        status: h.status,
        durationMs: h.durationMs,
        batchId: h.batchId,
      })),
    };
  }
}
