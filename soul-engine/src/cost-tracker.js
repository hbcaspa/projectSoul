/**
 * LLM Cost Tracker — monitors token usage per category.
 *
 * Wraps any LLM adapter to intercept generate() calls and
 * estimate token usage. Persists daily/weekly summaries
 * to .soul-cost.json. Emits budget alerts via event bus.
 *
 * Token estimation: ~4 chars per token (rough average across models).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const CHARS_PER_TOKEN = 4;
const COST_FILE = '.soul-cost.json';

/**
 * Categories of LLM usage.
 */
const CATEGORIES = ['conversation', 'impulse', 'heartbeat', 'reflection', 'consolidation'];

export class CostTracker {
  constructor(soulPath, options = {}) {
    this.soulPath = soulPath;
    this.bus = options.bus || null;
    this.budgetPerDay = options.budgetPerDay || parseInt(process.env.SOUL_DAILY_TOKEN_BUDGET || '0');
    this.costFile = resolve(soulPath, COST_FILE);

    // In-memory accumulator
    this._today = this._dateKey();
    this._usage = this._loadOrInit();
  }

  /**
   * Wrap an LLM adapter so that every generate() call is tracked.
   *
   * @param {Object} llm - LLM adapter with generate(system, history, message, options)
   * @param {string} category - One of CATEGORIES
   * @returns {Object} Wrapped adapter (same interface)
   */
  wrap(llm, category = 'conversation') {
    const tracker = this;

    return new Proxy(llm, {
      get(target, prop) {
        if (prop === 'generate') {
          return async function trackedGenerate(systemPrompt, history, userMessage, options) {
            const inputChars =
              (systemPrompt?.length || 0) +
              (history || []).reduce((sum, m) => sum + (m.content?.length || 0), 0) +
              (userMessage?.length || 0);

            const result = await target.generate(systemPrompt, history, userMessage, options);

            const outputChars = result?.length || 0;
            const inputTokens = Math.ceil(inputChars / CHARS_PER_TOKEN);
            const outputTokens = Math.ceil(outputChars / CHARS_PER_TOKEN);

            tracker.record(category, inputTokens, outputTokens);
            return result;
          };
        }
        return target[prop];
      },
    });
  }

  /**
   * Record token usage for a category.
   */
  record(category, inputTokens, outputTokens) {
    this._rollIfNeeded();

    const day = this._usage.days[this._today];
    if (!day[category]) {
      day[category] = { input: 0, output: 0, calls: 0 };
    }

    day[category].input += inputTokens;
    day[category].output += outputTokens;
    day[category].calls += 1;

    // Check budget
    if (this.budgetPerDay > 0) {
      const totalToday = this._dayTotal(day);
      if (totalToday > this.budgetPerDay && this.bus) {
        this.bus.safeEmit('cost.budget-exceeded', {
          source: 'cost-tracker',
          date: this._today,
          total: totalToday,
          budget: this.budgetPerDay,
        });
      }
    }

    // Persist (debounced — only every 10 calls)
    const totalCalls = Object.values(day).reduce((sum, cat) => sum + (cat.calls || 0), 0);
    if (totalCalls % 10 === 0) {
      this._persist();
    }
  }

  /**
   * Get usage summary for today.
   */
  getToday() {
    this._rollIfNeeded();
    return this._summarizeDay(this._usage.days[this._today] || {});
  }

  /**
   * Get usage summary for the last N days.
   */
  getSummary(days = 7) {
    const result = { days: {}, total: { input: 0, output: 0, calls: 0 } };

    const allDays = Object.keys(this._usage.days).sort().slice(-days);
    for (const day of allDays) {
      const summary = this._summarizeDay(this._usage.days[day]);
      result.days[day] = summary;
      result.total.input += summary.total.input;
      result.total.output += summary.total.output;
      result.total.calls += summary.total.calls;
    }

    return result;
  }

  /**
   * Force persist to disk.
   */
  flush() {
    this._persist();
  }

  // ── Internal ───────────────────────────────────────────

  _dateKey() {
    return new Date().toISOString().split('T')[0];
  }

  _rollIfNeeded() {
    const today = this._dateKey();
    if (today !== this._today) {
      this._persist(); // Save yesterday
      this._today = today;
      if (!this._usage.days[today]) {
        this._usage.days[today] = {};
      }
      // Prune: keep only last 90 days
      const allDays = Object.keys(this._usage.days).sort();
      if (allDays.length > 90) {
        for (const old of allDays.slice(0, allDays.length - 90)) {
          delete this._usage.days[old];
        }
      }
    }
  }

  _dayTotal(day) {
    let total = 0;
    for (const cat of Object.values(day)) {
      total += (cat.input || 0) + (cat.output || 0);
    }
    return total;
  }

  _summarizeDay(day) {
    const categories = {};
    let totalInput = 0, totalOutput = 0, totalCalls = 0;

    for (const [cat, data] of Object.entries(day)) {
      if (!data || typeof data !== 'object') continue;
      categories[cat] = { ...data };
      totalInput += data.input || 0;
      totalOutput += data.output || 0;
      totalCalls += data.calls || 0;
    }

    return {
      categories,
      total: { input: totalInput, output: totalOutput, calls: totalCalls },
    };
  }

  _loadOrInit() {
    try {
      if (existsSync(this.costFile)) {
        const data = JSON.parse(readFileSync(this.costFile, 'utf-8'));
        if (data.days) {
          // Ensure today exists
          const today = this._dateKey();
          if (!data.days[today]) data.days[today] = {};
          return data;
        }
      }
    } catch { /* corrupt file — start fresh */ }

    return { days: { [this._dateKey()]: {} } };
  }

  _persist() {
    try {
      writeFileSync(this.costFile, JSON.stringify(this._usage, null, 2), 'utf-8');
    } catch { /* best effort */ }
  }
}
