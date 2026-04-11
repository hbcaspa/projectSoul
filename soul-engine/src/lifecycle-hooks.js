/**
 * LifecycleHooks — Interceptors at agent lifecycle points.
 *
 * Inspired by OpenClaw's Hook System (Design Pattern Part 4, Ch.18):
 * Hooks intercept at lifecycle points, enabling validation, augmentation,
 * logging, and transformation without modifying core logic.
 *
 * Hook points:
 * - before_tool_call / after_tool_call — intercept tool execution
 * - before_response / after_response — intercept LLM responses
 * - before_message / after_message — intercept incoming messages
 * - on_error — handle errors
 * - on_approval_needed — human-in-the-loop gate
 */

export class LifecycleHooks {
  constructor({ bus } = {}) {
    this.bus = bus || null;
    this.hooks = new Map();
    this.stats = { runs: 0, blocked: 0, transformed: 0, errors: 0 };
  }

  /**
   * Register a hook at a lifecycle point.
   *
   * @param {string} point - Lifecycle point (e.g., 'before_tool_call')
   * @param {string} id - Unique hook identifier
   * @param {object} hook
   * @param {Function} hook.handler - (context) => { blocked?, reason?, modifiedResult? }
   * @param {number} hook.priority - Higher runs first (default 0)
   * @param {boolean} hook.once - Run only once then auto-remove
   * @param {Function} hook.condition - (context) => boolean — optional filter
   */
  register(point, id, hook) {
    if (!this.hooks.has(point)) {
      this.hooks.set(point, []);
    }

    const existing = this.hooks.get(point);
    // Replace if same ID exists
    const idx = existing.findIndex(h => h.id === id);
    if (idx >= 0) existing.splice(idx, 1);

    existing.push({
      id,
      handler: hook.handler,
      priority: hook.priority || 0,
      once: hook.once || false,
      condition: hook.condition || null,
    });

    // Sort by priority (higher first)
    existing.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Remove a hook.
   */
  unregister(point, id) {
    const hooks = this.hooks.get(point);
    if (!hooks) return;
    const idx = hooks.findIndex(h => h.id === id);
    if (idx >= 0) hooks.splice(idx, 1);
  }

  /**
   * Run all hooks at a lifecycle point.
   * Returns aggregated result: { blocked, reason, modifiedResult }
   *
   * @param {string} point - Lifecycle point
   * @param {object} context - Hook context (tool, args, result, etc.)
   * @returns {Promise<{ blocked?: boolean, reason?: string, modifiedResult?: any }>}
   */
  async run(point, context = {}) {
    const hooks = this.hooks.get(point);
    if (!hooks || hooks.length === 0) return {};

    this.stats.runs++;
    let result = {};
    const toRemove = [];

    for (const hook of hooks) {
      // Check condition
      if (hook.condition) {
        try {
          if (!hook.condition(context)) continue;
        } catch { continue; }
      }

      try {
        const hookResult = await hook.handler(context);

        if (hookResult?.blocked) {
          this.stats.blocked++;
          result.blocked = true;
          result.reason = hookResult.reason || `Blocked by hook ${hook.id}`;

          if (this.bus) {
            this.bus.safeEmit('hook.blocked', {
              source: 'lifecycle-hooks',
              point,
              hookId: hook.id,
              reason: result.reason,
            });
          }

          break; // First block wins
        }

        if (hookResult?.modifiedResult !== undefined) {
          this.stats.transformed++;
          result.modifiedResult = hookResult.modifiedResult;
          context.result = hookResult.modifiedResult; // Chain transforms
        }
      } catch (err) {
        this.stats.errors++;
        console.error(`  [hooks] Error in ${hook.id} at ${point}: ${err.message}`);
      }

      if (hook.once) toRemove.push(hook.id);
    }

    // Remove one-time hooks
    for (const id of toRemove) {
      this.unregister(point, id);
    }

    return result;
  }

  /**
   * List all registered hooks.
   */
  list() {
    const result = {};
    for (const [point, hooks] of this.hooks) {
      result[point] = hooks.map(h => ({ id: h.id, priority: h.priority, once: h.once }));
    }
    return result;
  }

  getStats() {
    return { ...this.stats, hookCount: this._totalHooks() };
  }

  _totalHooks() {
    let count = 0;
    for (const hooks of this.hooks.values()) count += hooks.length;
    return count;
  }
}
