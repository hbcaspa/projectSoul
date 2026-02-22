/**
 * Soul Event Bus — reactive nervous system for the Soul Engine.
 *
 * Extends EventEmitter with:
 * - Error-isolated handlers (one crash doesn't kill the engine)
 * - Rolling in-memory event log (for debugging and API)
 * - Async-safe: catches both sync throws and rejected promises
 * - Cross-process bridge: writes events to .soul-events/current.jsonl
 */

import { EventEmitter } from 'events';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

const MAX_LOG = 200;
const MAX_ERRORS = 50;
const MAX_JSONL_LINES = 100;

// Events that are too frequent for cross-process (skip JSONL write)
const SKIP_CROSS_PROCESS = new Set(['pulse.written', 'impulse.tick']);

export class SoulEventBus extends EventEmitter {
  constructor(options = {}) {
    super();
    this.debug = options.debug ?? (process.env.SOUL_BUS_DEBUG === 'true');
    this.soulPath = options.soulPath;
    this.eventLog = [];
    this.handlerErrors = [];
    this.eventCount = 0;
    this._jsonlQueue = [];
    this._jsonlWriting = false;
  }

  /**
   * Emit an event with error isolation per handler.
   * Each listener runs independently — one crash does not affect others.
   *
   * @param {string} eventName - The event type (e.g. 'message.received')
   * @param {object} payload   - Event-specific data (must include `source`)
   */
  safeEmit(eventName, payload = {}) {
    const event = {
      id: ++this.eventCount,
      type: eventName,
      ts: Date.now(),
      ...payload,
    };

    // Rolling in-memory log
    this.eventLog.push(event);
    if (this.eventLog.length > MAX_LOG) {
      this.eventLog = this.eventLog.slice(-MAX_LOG);
    }

    if (this.debug) {
      console.log(`  [bus] ${eventName}${payload.source ? ` (${payload.source})` : ''}`);
    }

    // Cross-process bridge: write to .soul-events/current.jsonl
    if (this.soulPath && !SKIP_CROSS_PROCESS.has(eventName)) {
      this._writeCrossProcess(event);
    }

    // Write .soul-mood on mood changes
    if (this.soulPath && eventName === 'mood.changed') {
      this._writeMoodFile(payload);
    }

    // Call each listener with error isolation
    const listeners = this.rawListeners(eventName);
    for (const listener of listeners) {
      try {
        const result = listener(event);
        // Catch async handler rejections
        if (result && typeof result.catch === 'function') {
          result.catch((err) => this._handleError(eventName, err));
        }
      } catch (err) {
        this._handleError(eventName, err);
      }
    }
  }

  _handleError(eventName, err) {
    const entry = {
      event: eventName,
      error: err.message,
      stack: err.stack?.split('\n')[1]?.trim(),
      time: new Date().toISOString(),
    };
    this.handlerErrors.push(entry);
    if (this.handlerErrors.length > MAX_ERRORS) {
      this.handlerErrors.shift();
    }
    console.error(`  [bus] Handler error on '${eventName}': ${err.message}`);
  }

  // ── Cross-Process Bridge ─────────────────────────────

  /**
   * Queue an event for JSONL write. Coalesces rapid events.
   */
  _writeCrossProcess(event) {
    // Compact event for JSONL (strip large payloads)
    const compact = { id: event.id, type: event.type, ts: event.ts, source: event.source };
    if (event.channel) compact.channel = event.channel;
    if (event.userName) compact.user = event.userName;
    if (event.mood) compact.mood = event.mood;
    if (event.trigger) compact.trigger = event.trigger;

    this._jsonlQueue.push(JSON.stringify(compact));
    this._flushJsonl();
  }

  async _flushJsonl() {
    if (this._jsonlWriting || this._jsonlQueue.length === 0) return;
    this._jsonlWriting = true;

    try {
      const eventsDir = resolve(this.soulPath, '.soul-events');
      if (!existsSync(eventsDir)) {
        await mkdir(eventsDir, { recursive: true });
      }

      const filePath = resolve(eventsDir, 'current.jsonl');

      // Read existing lines
      let lines = [];
      if (existsSync(filePath)) {
        const content = await readFile(filePath, 'utf-8');
        lines = content.trim().split('\n').filter(Boolean);
      }

      // Append queued events
      lines.push(...this._jsonlQueue);
      this._jsonlQueue = [];

      // Cap at MAX_JSONL_LINES
      if (lines.length > MAX_JSONL_LINES) {
        lines = lines.slice(-MAX_JSONL_LINES);
      }

      await writeFile(filePath, lines.join('\n') + '\n');
    } catch {
      // Cross-process write is best-effort
    } finally {
      this._jsonlWriting = false;
      // If more events queued during write, flush again
      if (this._jsonlQueue.length > 0) {
        this._flushJsonl();
      }
    }
  }

  /**
   * Write .soul-mood file on mood changes.
   */
  async _writeMoodFile(payload) {
    try {
      const data = {
        valence: payload.mood?.valence,
        energy: payload.mood?.energy,
        label: payload.mood?.label,
        trigger: payload.trigger,
        since: new Date().toISOString(),
      };
      await writeFile(resolve(this.soulPath, '.soul-mood'), JSON.stringify(data));
    } catch {
      // best-effort
    }
  }

  /** Get the last N events (for debugging/API). */
  getRecentEvents(n = 20) {
    return this.eventLog.slice(-n);
  }

  /** Get accumulated handler errors. */
  getErrors() {
    return [...this.handlerErrors];
  }

  /** Total events emitted since start. */
  get totalEvents() {
    return this.eventCount;
  }
}
