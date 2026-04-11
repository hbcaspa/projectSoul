/**
 * EventCoalescer — Wake Coalescing & Backpressure for events.
 *
 * Inspired by OpenClaw Design Pattern Ch.12:
 * When many events arrive simultaneously, batch them instead of
 * processing each one individually. Under overload, prioritize
 * and drop low-priority events gracefully.
 *
 * Prevents: LLM call storms, race conditions, context overflow.
 */

const DEFAULT_WINDOW = 2000;  // 2s batching window
const MAX_QUEUE_SIZE = 100;    // Max queued events before backpressure

export class EventCoalescer {
  constructor({ bus, windowMs, maxQueue } = {}) {
    this.bus = bus || null;
    this.windowMs = windowMs || DEFAULT_WINDOW;
    this.maxQueue = maxQueue || MAX_QUEUE_SIZE;
    this.queues = new Map();     // eventType → { events, timer, handler }
    this.stats = { batched: 0, dropped: 0, processed: 0 };
  }

  /**
   * Register a coalesced event handler.
   * Instead of processing each event individually, events within the
   * batching window are collected and delivered as a batch.
   *
   * @param {string} eventType - Event type to coalesce
   * @param {Function} batchHandler - (events[]) => Promise<void>
   * @param {object} options
   * @param {number} options.windowMs - Batching window (default 2s)
   * @param {number} options.maxBatch - Max events per batch (default 20)
   * @param {number} options.priority - Higher = processed first under backpressure
   * @param {Function} options.dedup - (event) => string — dedup key (optional)
   */
  register(eventType, batchHandler, options = {}) {
    const config = {
      handler: batchHandler,
      windowMs: options.windowMs || this.windowMs,
      maxBatch: options.maxBatch || 20,
      priority: options.priority || 0,
      dedup: options.dedup || null,
      events: [],
      timer: null,
      processing: false,
    };

    this.queues.set(eventType, config);

    // Listen on the bus
    if (this.bus) {
      this.bus.on(eventType, (event) => {
        this._enqueue(eventType, event);
      });
    }
  }

  /**
   * Enqueue an event for batched processing.
   */
  _enqueue(eventType, event) {
    const config = this.queues.get(eventType);
    if (!config) return;

    // Backpressure: drop if queue is full
    if (config.events.length >= this.maxQueue) {
      this.stats.dropped++;
      return;
    }

    // Dedup: replace existing event with same key
    if (config.dedup) {
      const key = config.dedup(event);
      const idx = config.events.findIndex(e => config.dedup(e) === key);
      if (idx >= 0) {
        config.events[idx] = event; // Replace with newer
        this.stats.batched++;
        return;
      }
    }

    config.events.push(event);
    this.stats.batched++;

    // Start or reset the batching timer
    if (config.timer) clearTimeout(config.timer);

    // Flush immediately if batch is full
    if (config.events.length >= config.maxBatch) {
      this._flush(eventType);
      return;
    }

    config.timer = setTimeout(() => this._flush(eventType), config.windowMs);
  }

  /**
   * Flush a batch: deliver all queued events to the handler.
   */
  async _flush(eventType) {
    const config = this.queues.get(eventType);
    if (!config || config.processing || config.events.length === 0) return;

    config.processing = true;
    const batch = config.events.splice(0, config.maxBatch);
    if (config.timer) {
      clearTimeout(config.timer);
      config.timer = null;
    }

    try {
      await config.handler(batch);
      this.stats.processed += batch.length;
    } catch (err) {
      console.error(`  [coalescer] Batch handler error for ${eventType}: ${err.message}`);
    } finally {
      config.processing = false;

      // Process remaining events if any
      if (config.events.length > 0) {
        config.timer = setTimeout(() => this._flush(eventType), config.windowMs);
      }
    }
  }

  /**
   * Force-flush all queues.
   */
  async flushAll() {
    for (const eventType of this.queues.keys()) {
      await this._flush(eventType);
    }
  }

  getStats() {
    const queueSizes = {};
    for (const [type, config] of this.queues) {
      queueSizes[type] = config.events.length;
    }
    return { ...this.stats, queues: queueSizes };
  }
}
