export class OpenAIAdapter {
  constructor(apiKey, model = 'gpt-4o-mini') {
    this.apiKey = apiKey;
    this.modelName = model;
    this.baseUrl = 'https://api.openai.com/v1/chat/completions';
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
    const { tools = [], onToolCall = null } = options;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((msg) => ({
        role: msg.role === 'model' ? 'assistant' : msg.role,
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    // Build request body
    const body = {
      model: this.modelName,
      messages,
    };

    // Add tools if available
    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema || { type: 'object', properties: {} },
        },
      }));
    }

    try {
      let rounds = 0;

      while (rounds < 10) {
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
        const choice = data.choices[0];
        const message = choice.message;

        // Add assistant message to conversation
        messages.push(message);

        // Check if the model wants to call tools
        if (choice.finish_reason === 'tool_calls' && message.tool_calls && onToolCall) {
          rounds++;

          for (const toolCall of message.tool_calls) {
            const name = toolCall.function.name;
            let args = {};
            try {
              args = JSON.parse(toolCall.function.arguments || '{}');
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

            // Add tool result to conversation
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: String(result),
            });
          }

          // Update body with new messages for next round
          body.messages = messages;
          continue;
        }

        // No more tool calls — return the final text
        return message.content || '';
      }

      console.warn('  [openai] Tool calling loop limit reached (10 rounds)');
      // Return whatever we have
      const last = messages[messages.length - 1];
      return last.content || '';
    } catch (err) {
      console.error(`  [openai] Error: ${err.message}`);
      throw err;
    }
  }
}
