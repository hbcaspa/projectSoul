/**
 * Anthropic Claude adapter for the Soul Engine.
 * Uses the Messages API (api.anthropic.com/v1/messages).
 */

export class AnthropicAdapter {
  constructor(apiKey, model = 'claude-sonnet-4-6') {
    this.apiKey = apiKey;
    this.modelName = model;
    this.baseUrl = 'https://api.anthropic.com/v1/messages';
  }

  /**
   * Generate a response from Claude, with optional tool calling.
   *
   * @param {string} systemPrompt  - The soul's system instruction
   * @param {Array}  history       - Previous messages [{role, content}]
   * @param {string} userMessage   - The new user message
   * @param {object} options       - { tools, onToolCall }
   * @returns {string} The model's response text
   */
  async generate(systemPrompt, history = [], userMessage, options = {}) {
    const { tools = [], onToolCall = null, max_tokens } = options;

    // Build messages from history + user message
    const messages = [
      ...history.map((msg) => ({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    // Build tools array for Anthropic format
    const apiTools = tools.length > 0
      ? tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: this._cleanSchema(t.inputSchema || { type: 'object', properties: {} }),
        }))
      : undefined;

    // Prompt caching: split system prompt into static (cached) and dynamic parts.
    // The static part (seed identity + behavior rules) rarely changes and benefits
    // from caching. The dynamic part (daily notes, RAG context, contact info) changes
    // per message. Separator: "---\n\nHeutige" or "---\n\nRelevante" or end of seed block.
    const systemContent = this._buildSystemWithCache(systemPrompt);

    try {
      let rounds = 0;

      while (rounds < 10) {
        const body = {
          model: this.modelName,
          max_tokens: max_tokens || 8192,
          system: systemContent,
          messages,
        };

        if (apiTools) {
          body.tools = apiTools;
        }

        const res = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'prompt-caching-2024-07-31',
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `HTTP ${res.status}`);
        }

        const data = await res.json();

        // Extract text blocks
        const textParts = (data.content || []).filter((b) => b.type === 'text');
        const toolUseParts = (data.content || []).filter((b) => b.type === 'tool_use');

        // If no tool calls or no handler, return text
        if (toolUseParts.length === 0 || !onToolCall) {
          return textParts.map((b) => b.text).join('');
        }

        // Handle tool calls
        rounds++;

        // Append assistant message with full content (text + tool_use)
        messages.push({ role: 'assistant', content: data.content });

        // Execute each tool call and build tool results
        const toolResults = [];
        for (const toolUse of toolUseParts) {
          const { name, input, id } = toolUse;
          console.log(`  [anthropic] Tool call: ${name}(${JSON.stringify(input).substring(0, 100)})`);

          let result;
          try {
            result = await onToolCall(name, input || {});
          } catch (err) {
            console.error(`  [anthropic] Tool error: ${name}: ${err.message}`);
            result = `Error: ${err.message}`;
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: id,
            content: String(result),
          });
        }

        // Send tool results back as a user message
        messages.push({ role: 'user', content: toolResults });

        // Check if we should stop (end_turn means model is done)
        if (data.stop_reason === 'end_turn' && toolUseParts.length === 0) {
          return textParts.map((b) => b.text).join('');
        }

        continue;
      }

      console.warn('  [anthropic] Tool calling loop limit reached (10 rounds)');
      return '';
    } catch (err) {
      console.error(`  [anthropic] Error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Split system prompt into cacheable (static) and dynamic parts.
   * Returns array format for Anthropic system parameter with cache_control.
   *
   * Static part: seed identity + behavior rules (rarely changes)
   * Dynamic part: daily notes, RAG context, contact info (changes per message)
   */
  _buildSystemWithCache(systemPrompt) {
    // Find the boundary between static and dynamic content.
    // Dynamic sections start with "\n\nHeutige Notizen" or "\n\nRelevante Erinnerungen"
    // or "\n\nWhatsApp-Kontakt" (these are appended in engine.js handleMessage)
    const dynamicMarkers = [
      '\n\nHeutige Notizen',
      '\n\nRelevante Erinnerungen',
      '\n\nWhatsApp-Kontakt',
      '\n\n[AUTHENTICITY HINT:',
    ];

    let splitIdx = systemPrompt.length;
    for (const marker of dynamicMarkers) {
      const idx = systemPrompt.indexOf(marker);
      if (idx !== -1 && idx < splitIdx) splitIdx = idx;
    }

    if (splitIdx === systemPrompt.length) {
      // No dynamic content — cache the whole thing
      return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }];
    }

    const staticPart = systemPrompt.substring(0, splitIdx);
    const dynamicPart = systemPrompt.substring(splitIdx);

    return [
      { type: 'text', text: staticPart, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: dynamicPart },
    ];
  }

  /**
   * Clean JSON Schema for Anthropic compatibility.
   */
  _cleanSchema(schema) {
    if (!schema || typeof schema !== 'object') {
      return { type: 'object', properties: {} };
    }

    const clean = { ...schema };

    // Remove unsupported keys
    delete clean.$schema;
    delete clean.title;
    delete clean.default;

    // Handle anyOf — resolve nullable types
    if (clean.anyOf) {
      const nonNull = clean.anyOf.find((s) => s.type !== 'null');
      if (nonNull) {
        Object.assign(clean, this._cleanSchema(nonNull));
      }
      delete clean.anyOf;
    }

    if (clean.oneOf) {
      const nonNull = clean.oneOf.find((s) => s.type !== 'null');
      if (nonNull) {
        Object.assign(clean, this._cleanSchema(nonNull));
      }
      delete clean.oneOf;
    }

    // Handle array type
    if (Array.isArray(clean.type)) {
      clean.type = clean.type.find((t) => t !== 'null') || 'string';
    }

    // Ensure arrays have items
    if (clean.type === 'array' && !clean.items) {
      clean.items = { type: 'string' };
    }

    // Convert prefixItems to items
    if (clean.prefixItems) {
      if (Array.isArray(clean.prefixItems) && clean.prefixItems.length > 0) {
        clean.items = this._cleanSchema(clean.prefixItems[0]);
      }
      delete clean.prefixItems;
    }

    // Recursively clean properties
    if (clean.properties) {
      const cleaned = {};
      for (const [key, value] of Object.entries(clean.properties)) {
        cleaned[key] = this._cleanSchema(value);
      }
      clean.properties = cleaned;
    }

    if (clean.items && typeof clean.items === 'object') {
      clean.items = this._cleanSchema(clean.items);
    }

    return clean;
  }
}
