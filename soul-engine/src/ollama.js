/**
 * Ollama adapter for the Soul Engine.
 * Connects to a local Ollama instance via HTTP API.
 */

export class OllamaAdapter {
  constructor(url = 'http://localhost:11434', model = 'llama3.1') {
    this.baseUrl = url.replace(/\/$/, '');
    this.modelName = model;
  }

  /**
   * Generate a response from a local Ollama model, with optional tool calling.
   *
   * @param {string} systemPrompt  - The soul's system instruction
   * @param {Array}  history       - Previous messages [{role, content}]
   * @param {string} userMessage   - The new user message
   * @param {object} options       - { tools, onToolCall }
   * @returns {string} The model's response text
   */
  async generate(systemPrompt, history = [], userMessage, options = {}) {
    const { tools = [], onToolCall = null } = options;

    // Build messages
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((msg) => ({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    // Build tools array for Ollama format (similar to OpenAI function calling)
    const apiTools = tools.length > 0
      ? tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: this._cleanSchema(t.inputSchema || { type: 'object', properties: {} }),
          },
        }))
      : undefined;

    try {
      let rounds = 0;

      while (rounds < 10) {
        const body = {
          model: this.modelName,
          messages,
          stream: false,
        };

        if (apiTools && onToolCall) {
          body.tools = apiTools;
        }

        const res = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const message = data.message || {};

        // Check for tool calls
        const toolCalls = message.tool_calls || [];

        if (toolCalls.length === 0 || !onToolCall) {
          return message.content || '';
        }

        // Handle tool calls
        rounds++;

        // Append assistant message
        messages.push({
          role: 'assistant',
          content: message.content || '',
          tool_calls: toolCalls,
        });

        // Execute each tool call
        for (const call of toolCalls) {
          const fn = call.function || {};
          const name = fn.name;
          const args = fn.arguments || {};

          console.log(`  [ollama] Tool call: ${name}(${JSON.stringify(args).substring(0, 100)})`);

          let result;
          try {
            result = await onToolCall(name, args);
          } catch (err) {
            console.error(`  [ollama] Tool error: ${name}: ${err.message}`);
            result = `Error: ${err.message}`;
          }

          messages.push({
            role: 'tool',
            content: String(result),
          });
        }

        continue;
      }

      console.warn('  [ollama] Tool calling loop limit reached (10 rounds)');
      return '';
    } catch (err) {
      console.error(`  [ollama] Error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Clean JSON Schema for Ollama compatibility.
   */
  _cleanSchema(schema) {
    if (!schema || typeof schema !== 'object') {
      return { type: 'object', properties: {} };
    }

    const clean = { ...schema };

    delete clean.$schema;
    delete clean.title;
    delete clean.default;
    delete clean.additionalProperties;

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

    if (Array.isArray(clean.type)) {
      clean.type = clean.type.find((t) => t !== 'null') || 'string';
    }

    if (clean.type === 'array' && !clean.items) {
      clean.items = { type: 'string' };
    }

    if (clean.prefixItems) {
      if (Array.isArray(clean.prefixItems) && clean.prefixItems.length > 0) {
        clean.items = this._cleanSchema(clean.prefixItems[0]);
      }
      delete clean.prefixItems;
    }

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
