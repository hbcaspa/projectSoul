/**
 * Mock SoulEventBus — records all emitted events for test assertions.
 *
 * Drop-in replacement for the real SoulEventBus. Does NOT write files
 * or use EventEmitter internals. Purely in-memory.
 */

export class MockBus {
  constructor() {
    this.events = [];
    this.listeners = new Map();
    this.eventCount = 0;
  }

  /**
   * Mirror of SoulEventBus.safeEmit — records the event and calls listeners.
   *
   * Note: The real bus spreads `...payload` which can overwrite `type`.
   * We store `eventName` separately so getEvents() filtering works reliably.
   */
  safeEmit(name, payload = {}) {
    const event = {
      id: ++this.eventCount,
      type: name,
      ts: Date.now(),
      ...payload,
      eventName: name, // preserved even if payload has `type`
    };
    this.events.push(event);

    const handlers = this.listeners.get(name) || [];
    for (const fn of handlers) {
      try {
        fn(event);
      } catch {
        // Swallow errors like the real bus
      }
    }
  }

  on(name, fn) {
    if (!this.listeners.has(name)) {
      this.listeners.set(name, []);
    }
    this.listeners.get(name).push(fn);
  }

  /** Get events filtered by event name. */
  getEvents(type) {
    if (!type) return [...this.events];
    return this.events.filter((e) => e.eventName === type);
  }

  /** Reset all recorded state. */
  reset() {
    this.events = [];
    this.eventCount = 0;
  }
}
