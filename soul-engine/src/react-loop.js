/**
 * ReActLoop — Iterative Reason+Act agent loop.
 *
 * Inspired by OpenClaw's core agent loop:
 * The LLM thinks → calls a tool → gets the result → thinks again →
 * calls another tool → ... until the task is complete.
 *
 * This replaces single-shot LLM calls with an iterative loop that
 * can chain multiple tool calls, handle errors gracefully, and
 * adapt its approach based on intermediate results.
 */

const MAX_ITERATIONS = 10;
const DEFAULT_TIMEOUT = 120000; // 2 min total

export class ReActLoop {
  /**
   * @param {object} opts
   * @param {object} opts.llm - LLM adapter (Gemini/Anthropic/OpenAI)
   * @param {object} opts.mcp - MCP client manager (tools)
   * @param {object} opts.bus - Event bus
   * @param {object} opts.hooks - LifecycleHooks instance (optional)
   * @param {object} opts.gate - ApprovalGate instance (optional)
   */
  constructor({ llm, mcp, bus, hooks, gate } = {}) {
    this.llm = llm;
    this.mcp = mcp;
    this.bus = bus || null;
    this.hooks = hooks || null;
    this.gate = gate || null;
    this.stats = { runs: 0, iterations: 0, toolCalls: 0, errors: 0, gateBlocks: 0 };
  }

  /**
   * Run the ReAct loop: iterative reasoning + acting until done.
   *
   * @param {string} systemPrompt - System prompt for the LLM
   * @param {Array} history - Conversation history
   * @param {string} userMessage - The user's input
   * @param {object} options
   * @param {number} options.maxIterations - Max tool-call rounds (default 10)
   * @param {number} options.maxTokens - Token budget per LLM call
   * @param {number} options.timeout - Total timeout in ms
   * @param {Function} options.onIteration - Callback per iteration (for streaming)
   * @param {Function} options.onToolCall - Callback per tool call
   * @returns {{ response: string, iterations: number, toolCalls: object[], totalTokens: number }}
   */
  async run(systemPrompt, history, userMessage, options = {}) {
    const maxIter = options.maxIterations || MAX_ITERATIONS;
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const startTime = Date.now();

    this.stats.runs++;

    // Build tool definitions from MCP
    const tools = this.mcp?.hasTools() ? this.mcp.getTools() : [];
    const toolCalls = [];
    let iterations = 0;
    let totalTokens = 0;

    // Working history: starts with user message, grows with tool results
    const workingHistory = [...history, { role: 'user', content: userMessage }];

    if (this.bus) {
      this.bus.safeEmit('react.started', {
        source: 'react-loop',
        toolCount: tools.length,
        maxIterations: maxIter,
      });
    }

    for (let i = 0; i < maxIter; i++) {
      iterations++;
      this.stats.iterations++;

      // Timeout check
      if (Date.now() - startTime > timeout) {
        console.error('  [react] Timeout after', iterations, 'iterations');
        break;
      }

      // Call LLM with tools
      let response;
      try {
        response = await this.llm.generate(systemPrompt, workingHistory.slice(0, -1), workingHistory[workingHistory.length - 1].content, {
          maxTokens: options.maxTokens || 4096,
          tools: tools.length > 0 ? tools : undefined,
          onToolCall: undefined, // We handle tool calls ourselves in the loop
          returnRaw: true,       // Get structured response with tool_calls
        });
      } catch (err) {
        this.stats.errors++;
        // On LLM error, try to recover with a simpler prompt
        console.error(`  [react] LLM error at iteration ${i}: ${err.message}`);
        if (i === 0) throw err; // First call fails = real error
        break; // Subsequent fails = return what we have
      }

      // Parse response: is it a final text answer or a tool call?
      const parsed = this._parseResponse(response);

      if (parsed.type === 'text') {
        // Final answer — loop complete
        if (options.onIteration) options.onIteration({ iteration: i, type: 'final', text: parsed.text });

        if (this.bus) {
          this.bus.safeEmit('react.completed', {
            source: 'react-loop',
            iterations,
            toolCalls: toolCalls.length,
          });
        }

        return {
          response: parsed.text,
          iterations,
          toolCalls,
          totalTokens,
        };
      }

      if (parsed.type === 'tool_calls') {
        // Execute each tool call
        for (const call of parsed.calls) {
          this.stats.toolCalls++;

          // Lifecycle hook: before_tool_call
          if (this.hooks) {
            const hookResult = await this.hooks.run('before_tool_call', {
              tool: call.name,
              args: call.args,
              iteration: i,
            });
            if (hookResult?.blocked) {
              workingHistory.push({
                role: 'tool',
                content: `Tool ${call.name} was blocked by hook: ${hookResult.reason}`,
                name: call.name,
              });
              continue;
            }
          }

          // Approval gate: check if this tool needs human approval
          if (this.gate && this.gate.requiresApproval(call.name)) {
            const approved = await this.gate.requestApproval(call.name, call.args);
            if (!approved) {
              this.stats.gateBlocks++;
              workingHistory.push({
                role: 'tool',
                content: `Tool ${call.name} was blocked: human approval denied or timed out.`,
                name: call.name,
              });
              if (options.onToolCall) options.onToolCall({ tool: call.name, blocked: true });
              continue;
            }
          }

          // Execute the tool
          let result;
          try {
            if (options.onToolCall) options.onToolCall({ tool: call.name, args: call.args });

            console.log(`  [react] Tool: ${call.name} (iteration ${i})`);
            result = await this.mcp.callTool(call.name, call.args);

            // Truncate long results
            if (typeof result === 'string' && result.length > 10000) {
              result = result.substring(0, 10000) + '\n\n[... truncated at 10000 chars]';
            }
          } catch (err) {
            this.stats.errors++;
            result = `Error executing ${call.name}: ${err.message}`;
            console.error(`  [react] Tool error: ${call.name} → ${err.message}`);
          }

          // Lifecycle hook: after_tool_call
          if (this.hooks) {
            const hookResult = await this.hooks.run('after_tool_call', {
              tool: call.name,
              args: call.args,
              result,
              iteration: i,
            });
            if (hookResult?.modifiedResult) result = hookResult.modifiedResult;
          }

          toolCalls.push({
            name: call.name,
            args: call.args,
            result: typeof result === 'string' ? result.substring(0, 500) : String(result).substring(0, 500),
            iteration: i,
          });

          // Feed result back into the working history
          workingHistory.push({
            role: 'assistant',
            content: `I'll use ${call.name} to help with this.`,
          });
          workingHistory.push({
            role: 'user',
            content: `Tool result from ${call.name}:\n${result}`,
          });
        }

        if (options.onIteration) {
          options.onIteration({
            iteration: i,
            type: 'tool_round',
            tools: parsed.calls.map(c => c.name),
          });
        }

        continue; // Next iteration — LLM processes tool results
      }

      // Unknown response type — treat as final
      break;
    }

    // Max iterations reached — extract whatever text we have
    const lastResponse = workingHistory.filter(m => m.role === 'assistant').pop();

    if (this.bus) {
      this.bus.safeEmit('react.completed', {
        source: 'react-loop',
        iterations,
        toolCalls: toolCalls.length,
        maxIterationsReached: true,
      });
    }

    return {
      response: lastResponse?.content || 'Ich konnte die Aufgabe nicht in den verfuegbaren Schritten abschliessen.',
      iterations,
      toolCalls,
      totalTokens,
    };
  }

  /**
   * Parse LLM response into text or tool calls.
   * Handles both structured (function calling) and text-based tool calls.
   */
  _parseResponse(response) {
    // If response is a string, check for inline tool calls
    if (typeof response === 'string') {
      return { type: 'text', text: response };
    }

    // Structured response from LLM adapter
    if (response && response.toolCalls && response.toolCalls.length > 0) {
      return {
        type: 'tool_calls',
        calls: response.toolCalls.map(tc => ({
          name: tc.name || tc.function?.name,
          args: tc.args || tc.function?.arguments || {},
        })),
      };
    }

    // Response with text content
    if (response && (response.text || response.content)) {
      return { type: 'text', text: response.text || response.content };
    }

    // Fallback
    return { type: 'text', text: String(response) };
  }

  getStats() {
    return { ...this.stats };
  }
}
