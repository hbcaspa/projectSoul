/**
 * Recursively sanitize a JSON Schema for OpenAI strict mode.
 * - Adds missing 'items' to array types
 * - Resolves anyOf with null (optional) to the non-null type
 */
function sanitizeSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;

  const result = { ...schema };

  // Handle anyOf — common pattern: [{ type: 'array', ... }, { type: 'null' }]
  if (Array.isArray(result.anyOf)) {
    const nonNull = result.anyOf.filter(s => s.type !== 'null');
    if (nonNull.length === 1) {
      // Unwrap the single non-null type
      const resolved = sanitizeSchema(nonNull[0]);
      delete result.anyOf;
      Object.assign(result, resolved);
    } else {
      result.anyOf = result.anyOf.map(s => sanitizeSchema(s));
    }
  }

  // Fix array type without items
  if (result.type === 'array' && !result.items) {
    result.items = { type: 'string' };
  }

  // Recurse into properties
  if (result.properties) {
    result.properties = {};
    for (const [key, val] of Object.entries(schema.properties)) {
      result.properties[key] = sanitizeSchema(val);
    }
  }

  // Recurse into items
  if (result.items && typeof result.items === 'object') {
    result.items = sanitizeSchema(result.items);
  }

  return result;
}

export class OpenAIAdapter {
  constructor(apiKey, model = 'gpt-4.1-mini') {
    this.apiKey = apiKey;
    this.modelName = model;
    this.baseUrl = 'https://api.openai.com/v1/responses';
  }

  /**
   * Generate a response from the LLM, with optional tool calling.
   * Uses the Responses API with built-in web_search_preview.
   *
   * @param {string} systemPrompt  - The soul's system instruction
   * @param {Array}  history       - Previous messages [{role, content}]
   * @param {string} userMessage   - The new user message
   * @param {object} options       - { tools, onToolCall }
   * @returns {string} The model's response text
   */
  async generate(systemPrompt, history = [], userMessage, options = {}) {
    const { tools = [], onToolCall = null } = options;

    // Build input array from history + user message
    const input = [
      ...history.map((msg) => ({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    // Build tools array — always include web_search_preview
    const apiTools = [{ type: 'web_search_preview' }];

    // Add custom function tools (from MCP servers etc.)
    if (tools.length > 0) {
      for (const t of tools) {
        apiTools.push({
          type: 'function',
          name: t.name,
          description: t.description,
          parameters: sanitizeSchema(t.inputSchema || { type: 'object', properties: {} }),
        });
      }
    }

    try {
      let rounds = 0;

      while (rounds < 10) {
        const body = {
          model: this.modelName,
          instructions: systemPrompt,
          input,
          tools: apiTools,
        };

        const res = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error?.message || `HTTP ${res.status}`);
        }

        const data = await res.json();
        const output = data.output || [];

        // Extract function calls (custom tools only — web_search is handled server-side)
        const functionCalls = output.filter((item) => item.type === 'function_call');

        // If no custom function calls or no handler, extract text and return
        if (functionCalls.length === 0 || !onToolCall) {
          return this._extractText(output);
        }

        // Handle custom function calls
        rounds++;

        // Append all output items to input (preserves web_search_call, message, function_call)
        input.push(...output);

        // Execute each function call and append results
        for (const call of functionCalls) {
          const name = call.name;
          let args = {};
          try {
            args = JSON.parse(call.arguments || '{}');
          } catch {
            // malformed args
          }

          console.log(`  [openai] Tool call: ${name}(${JSON.stringify(args).substring(0, 100)})`);

          let result;
          try {
            result = await onToolCall(name, args);
          } catch (err) {
            console.error(`  [openai] Tool error: ${name}: ${err.message}`);
            result = `Error: ${err.message}`;
          }

          input.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: String(result),
          });
        }

        continue;
      }

      console.warn('  [openai] Tool calling loop limit reached (10 rounds)');
      return '';
    } catch (err) {
      console.error(`  [openai] Error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Extract text from Responses API output items.
   */
  /**
   * Sanitize a JSON Schema for OpenAI strict mode.
   * Fixes: anyOf with array types missing 'items', etc.
   */
  static sanitizeSchema(schema) {
    return sanitizeSchema(schema);
  }

  _extractText(output) {
    for (const item of output) {
      if (item.type === 'message' && item.content) {
        for (const part of item.content) {
          if (part.type === 'output_text' && part.text) {
            return part.text;
          }
        }
      }
    }
    return '';
  }
}
