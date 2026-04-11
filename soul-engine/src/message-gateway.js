/**
 * MessageGateway — Central message router for all channels.
 *
 * Inspired by OpenClaw's Gateway pattern:
 * One central router that collects messages from ALL platforms
 * (Telegram, WhatsApp, API, Claude Code) and routes them to
 * the right handler. Normalizes message format across channels.
 *
 * Replaces separate handling in telegram.js, whatsapp.js, api.js
 * with a unified pipeline:
 * Channel → Gateway → Normalize → Route → Agent → Response → Channel
 */

export class MessageGateway {
  constructor({ bus, engine } = {}) {
    this.bus = bus || null;
    this.engine = engine || null;
    this.channels = new Map();
    this.middleware = [];
    this.stats = { received: 0, routed: 0, errors: 0, byChannel: {} };
  }

  /**
   * Register a channel (message source/sink).
   *
   * @param {string} id - Channel identifier ('telegram', 'whatsapp', 'api', 'claude-code')
   * @param {object} channel
   * @param {Function} channel.send - (text, options) => Promise — send response back
   * @param {string} channel.type - 'interactive' | 'notification' | 'bridge'
   * @param {boolean} channel.active - Is channel connected?
   */
  registerChannel(id, channel) {
    this.channels.set(id, {
      id,
      send: channel.send,
      type: channel.type || 'interactive',
      active: channel.active !== false,
      registeredAt: Date.now(),
    });
    this.stats.byChannel[id] = 0;
  }

  /**
   * Add middleware to the message pipeline.
   * Middleware runs in order for every incoming message.
   *
   * @param {string} id - Middleware identifier
   * @param {Function} handler - (message, next) => Promise
   */
  use(id, handler) {
    this.middleware.push({ id, handler });
  }

  /**
   * Process an incoming message through the pipeline.
   *
   * @param {object} message — Normalized message
   * @param {string} message.channel - Source channel id
   * @param {string} message.text - Message text
   * @param {string} message.sender - Sender identifier
   * @param {string} message.chatId - Chat/conversation id
   * @param {string} message.type - 'text' | 'voice' | 'image' | 'command'
   * @param {object} message.raw - Original platform-specific payload
   * @returns {Promise<{ response: string, channel: string }>}
   */
  async process(message) {
    this.stats.received++;
    this.stats.byChannel[message.channel] = (this.stats.byChannel[message.channel] || 0) + 1;

    // Normalize
    const normalized = this._normalize(message);

    if (this.bus) {
      this.bus.safeEmit('gateway.message_received', {
        source: 'message-gateway',
        channel: normalized.channel,
        sender: normalized.sender,
        type: normalized.type,
      });
    }

    // Run middleware pipeline
    let current = normalized;
    for (const mw of this.middleware) {
      try {
        let nextCalled = false;
        const next = () => { nextCalled = true; };
        const result = await mw.handler(current, next);
        if (result === false) {
          // Middleware blocked the message
          return { response: null, channel: normalized.channel, blocked: true, blockedBy: mw.id };
        }
        if (result && typeof result === 'object' && result.text) {
          current = { ...current, ...result };
        }
        if (!nextCalled && result === undefined) continue; // Auto-continue
      } catch (err) {
        console.error(`  [gateway] Middleware ${mw.id} error: ${err.message}`);
      }
    }

    // Route to handler
    try {
      const response = await this._route(current);
      this.stats.routed++;

      // Send response back through the source channel
      const channel = this.channels.get(normalized.channel);
      if (channel && channel.send && response) {
        try {
          await channel.send(response, { chatId: normalized.chatId });
        } catch (err) {
          console.error(`  [gateway] Failed to send response via ${normalized.channel}: ${err.message}`);
        }
      }

      return { response, channel: normalized.channel };
    } catch (err) {
      this.stats.errors++;
      console.error(`  [gateway] Routing error: ${err.message}`);
      return { response: null, channel: normalized.channel, error: err.message };
    }
  }

  /**
   * Normalize a message to internal format.
   */
  _normalize(message) {
    return {
      channel: message.channel || 'unknown',
      text: (message.text || '').trim(),
      sender: message.sender || message.userName || 'anonymous',
      chatId: message.chatId || message.chat_jid || 'default',
      type: message.type || 'text',
      timestamp: message.timestamp || Date.now(),
      raw: message.raw || message,
    };
  }

  /**
   * Route a normalized message to the appropriate handler.
   */
  async _route(message) {
    if (!this.engine) return null;

    // Commands (starting with / or !)
    if (message.text.startsWith('/') && this.engine.capabilityRegistry) {
      const result = await this.engine.capabilityRegistry.execute(message.text, this.engine.unifiedContext);
      if (result) return typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
    }

    // Default: route through main message handler
    return this.engine.handleMessage({
      text: message.text,
      chatId: message.chatId,
      userName: message.sender,
    });
  }

  /**
   * Broadcast a message to all active channels of a given type.
   */
  async broadcast(text, options = {}) {
    const type = options.channelType || 'interactive';
    const results = [];

    for (const [id, channel] of this.channels) {
      if (!channel.active) continue;
      if (type !== 'all' && channel.type !== type) continue;

      try {
        await channel.send(text, options);
        results.push({ channel: id, sent: true });
      } catch (err) {
        results.push({ channel: id, sent: false, error: err.message });
      }
    }

    return results;
  }

  /**
   * Get gateway status.
   */
  getStatus() {
    const channels = {};
    for (const [id, ch] of this.channels) {
      channels[id] = { type: ch.type, active: ch.active };
    }
    return {
      channels,
      middleware: this.middleware.map(m => m.id),
      stats: this.stats,
    };
  }
}
