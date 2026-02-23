import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiAdapter {
  constructor(apiKey, model = 'gemini-2.0-flash') {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = model;
  }

  /**
   * Generate a response from the LLM, with optional tool calling.
   *
   * @param {string} systemPrompt  - The soul's system instruction
   * @param {Array}  history       - Previous messages [{role, content}]
   * @param {string} userMessage   - The new user message
   * @param {object} options       - { tools, onToolCall }
   * @returns {string} The model's response text
   */
  async generate(systemPrompt, history = [], userMessage, options = {}) {
    const { tools = [], onToolCall = null, max_tokens } = options;

    // Build model config
    const modelConfig = {
      model: this.modelName,
      systemInstruction: systemPrompt,
      ...(max_tokens ? { generationConfig: { maxOutputTokens: max_tokens } } : {}),
    };

    // Add tools if available
    if (tools.length > 0) {
      modelConfig.tools = [{
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: this._cleanSchema(t.inputSchema),
        })),
      }];
    }

    const model = this.genAI.getGenerativeModel(modelConfig);

    // Convert to Gemini format
    const geminiHistory = history.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history: geminiHistory });

    try {
      let result = await chat.sendMessage(userMessage);
      let response = result.response;

      // Tool calling loop — max 10 rounds to prevent runaway
      let rounds = 0;
      while (rounds < 10) {
        const candidate = response.candidates?.[0];
        if (!candidate) break;

        const functionCalls = candidate.content?.parts?.filter(
          (p) => p.functionCall
        );

        if (!functionCalls || functionCalls.length === 0) break;
        if (!onToolCall) break;

        rounds++;

        // Execute all function calls
        const functionResponses = [];
        for (const part of functionCalls) {
          const { name, args } = part.functionCall;
          console.log(`  [gemini] Tool call: ${name}(${JSON.stringify(args).substring(0, 100)})`);

          try {
            const toolResult = await onToolCall(name, args || {});
            functionResponses.push({
              functionResponse: {
                name,
                response: { result: toolResult },
              },
            });
          } catch (err) {
            console.error(`  [gemini] Tool error: ${name}: ${err.message}`);
            functionResponses.push({
              functionResponse: {
                name,
                response: { error: err.message },
              },
            });
          }
        }

        // Send tool results back to the model
        result = await chat.sendMessage(functionResponses);
        response = result.response;
      }

      if (rounds >= 10) {
        console.warn('  [gemini] Tool calling loop limit reached (10 rounds)');
      }

      return response.text();
    } catch (err) {
      console.error(`  [gemini] Error: ${err.message}`);
      throw err;
    }
  }

  /**
   * Clean JSON Schema for Gemini compatibility.
   * Gemini doesn't support all JSON Schema features.
   */
  _cleanSchema(schema) {
    if (!schema || typeof schema !== 'object') {
      return { type: 'object', properties: {} };
    }

    const clean = { ...schema };

    // Remove unsupported keys
    delete clean.$schema;
    delete clean.additionalProperties;
    delete clean.minItems;
    delete clean.maxItems;
    delete clean.title;
    delete clean.default;

    // Convert prefixItems (JSON Schema 2020 tuple) to regular items
    if (clean.prefixItems) {
      if (Array.isArray(clean.prefixItems) && clean.prefixItems.length > 0) {
        clean.items = this._cleanSchema(clean.prefixItems[0]);
      }
      delete clean.prefixItems;
    }

    // Handle array type field (Gemini doesn't support array of types like ["string", "null"])
    if (Array.isArray(clean.type)) {
      clean.type = clean.type.find((t) => t !== 'null') || 'string';
    }

    // Ensure arrays have items
    if (clean.type === 'array' && !clean.items) {
      clean.items = { type: 'string' };
    }

    // Recursively clean nested properties
    if (clean.properties) {
      const cleaned = {};
      for (const [key, value] of Object.entries(clean.properties)) {
        cleaned[key] = this._cleanSchema(value);
      }
      clean.properties = cleaned;
    }

    // Clean items in arrays
    if (clean.items) {
      clean.items = this._cleanSchema(clean.items);
    }

    // Handle anyOf/oneOf — pick the first non-null type
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

    return clean;
  }
}
