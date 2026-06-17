/**
 * ReActLoop — Iterative Reason+Act agent loop.
 *
 * Inspired by OpenClaw's core agent loop:
 * The LLM thinks → calls a tool → gets the result → thinks again →
 * calls another tool → ... until the task is complete.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * v2 (Stufe 1 — Live-Self-Pfad-Härtung):
 *
 * Die alte Implementierung hatte zwei kritische Fehler:
 *
 *  1. ROLLEN-/INJECTION-GRENZE GEBROCHEN: Tool-Ergebnisse wurden als
 *     GEFÄLSCHTE Text-Turns in die History konkateniert
 *     ({role:'assistant', content:"I'll use X..."} + {role:'user',
 *     content:"Tool result from X:\n..."}). Das vermischt Tool-Output mit
 *     echtem User-Text (Prompt-Injection-Oberfläche) und zerstört das
 *     Prompt-Caching, weil jede Runde die History textuell umbaut.
 *
 *  2. TOTER PFAD: Der Loop übergab `returnRaw:true` + `onToolCall:undefined`
 *     an llm.generate(). KEIN Adapter (anthropic/gemini/openai/ollama)
 *     kennt `returnRaw` — alle geben einen String zurück. _parseResponse()
 *     eines Strings ergibt IMMER {type:'text'}, also wurde nie ein Tool-Call
 *     erkannt: der Loop endete faktisch nach Runde 1.
 *
 * Korrektur: Die Tool-Iteration wird an die Adapter delegiert. JEDER Adapter
 * implementiert bereits NATIVE Tool-Messages über den Callback
 * `onToolCall(name, args) -> result`:
 *   - anthropic.js: {role:'assistant', content:[...tool_use]} +
 *     {role:'user', content:[{type:'tool_result', tool_use_id, content}]}
 *     (native Messages-API-Form, Prompt-Caching bleibt intakt)
 *   - gemini.js: native functionCall / functionResponse parts
 *   - openai.js / ollama.js: native function/tool_calls
 *
 * Diese ReActLoop baut den onToolCall-Handler (Hooks → ApprovalGate →
 * Step-Cap → MCP-Ausführung) und übergibt ihn an den Adapter. Damit bleibt
 * die Rollen-Grenze sauber UND der ApprovalGate sitzt verbindlich im Pfad.
 *
 * GRENZE (ehrlich dokumentiert): Weil die Adapter ihren eigenen internen
 * Tool-Loop fahren (bis zu 10 Runden pro generate()), kontrolliert diese
 * Klasse die Runden über einen geteilten Step-Counter (this._stepCap) im
 * onToolCall-Handler statt über einen äußeren Schleifenzähler. Erreicht der
 * Counter maxSteps, liefert der Handler eine Stop-Notiz statt das Tool
 * auszuführen — der Adapter beendet daraufhin mit Text. `iterations` im
 * Rückgabewert spiegelt deshalb die ANZAHL DER TOOL-SCHRITTE, nicht
 * LLM-Runden (die Adapter-Runden sind von außen nicht sichtbar).
 * ─────────────────────────────────────────────────────────────────────────
 */

const MAX_STEPS = 8;          // Default tool-step cap (loop protection)
const DEFAULT_TIMEOUT = 120000; // 2 min total

export class ReActLoop {
  /**
   * @param {object} opts
   * @param {object} opts.llm - LLM adapter / ModelFailover (generate w/ onToolCall)
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
    this.stats = { runs: 0, steps: 0, toolCalls: 0, errors: 0, gateBlocks: 0, capHits: 0 };
  }

  /**
   * Run the ReAct loop: iterative reasoning + acting until done.
   *
   * Signature (unchanged for existing callers — api.js, paperclip-adapter.js):
   *   run(systemPrompt, history, userMessage, options) -> Promise<{
   *     response, iterations, toolCalls, totalTokens
   *   }>
   *
   * @param {string} systemPrompt - System prompt for the LLM
   * @param {Array}  history      - Conversation history [{role, content}]
   * @param {string} userMessage  - The user's input
   * @param {object} options
   * @param {number}   options.maxSteps      - Max tool executions (default 8). Loop protection.
   * @param {number}   options.maxIterations - Back-compat alias for maxSteps.
   * @param {number}   options.maxTokens     - Token budget per LLM call.
   * @param {number}   options.timeout       - Total timeout in ms.
   * @param {Function} options.onToolCall    - OPTIONAL hook to route tool execution
   *                     through the engine's ApprovalGate. Signature:
   *                         onToolCall(name, args) -> Promise<result|string>
   *                     If omitted, tools are executed directly via mcp.callTool().
   *                     The engine sets this so risky tools go through enqueueApproval().
   * @param {Function} options.onIteration   - OPTIONAL notification per tool step
   *                     (kept for back-compat; receives {iteration, type, tools}).
   * @returns {{ response: string, iterations: number, toolCalls: object[], totalTokens: number }}
   */
  async run(systemPrompt, history, userMessage, options = {}) {
    // maxIterations kept as an alias so existing callers don't break.
    const maxSteps = options.maxSteps || options.maxIterations || MAX_STEPS;
    const timeout = options.timeout || DEFAULT_TIMEOUT;
    const startTime = Date.now();

    this.stats.runs++;

    const tools = this.mcp?.hasTools() ? this.mcp.getTools() : [];
    const toolCalls = [];
    let steps = 0;
    let capHit = false;

    if (this.bus) {
      this.bus.safeEmit('react.started', {
        source: 'react-loop',
        toolCount: tools.length,
        maxSteps,
      });
    }

    // ── Tool-execution handler passed to the adapter ──────────────────────
    // The adapter calls this for every native tool_use / functionCall it
    // emits. We enforce, IN ORDER: timeout → step-cap → before-hook →
    // ApprovalGate → execute → after-hook. Everything is FAIL-CLOSED:
    // any uncertainty returns a non-executing notice, never a silent pass.
    const executeTool = async (name, args = {}) => {
      // 1. Timeout guard — never start a tool after the budget is spent.
      if (Date.now() - startTime > timeout) {
        capHit = true;
        return `[react] Aborted: total timeout (${timeout}ms) reached before "${name}".`;
      }

      // 2. Step cap — loop protection. Once hit, refuse further tools so the
      //    model is forced to conclude with text.
      if (steps >= maxSteps) {
        capHit = true;
        this.stats.capHits++;
        return `[react] Step limit (${maxSteps}) reached. No more tools may be called — please conclude with a final answer based on what you have.`;
      }
      steps++;
      this.stats.steps++;
      this.stats.toolCalls++;
      const iteration = steps;

      // 3. Lifecycle hook: before_tool_call (may block).
      if (this.hooks) {
        const hookResult = await this.hooks.run('before_tool_call', { tool: name, args, iteration });
        if (hookResult?.blocked) {
          if (options.onIteration) options.onIteration({ iteration, type: 'tool_blocked', tools: [name] });
          return `Tool ${name} was blocked by hook: ${hookResult.reason || 'no reason given'}`;
        }
      }

      // 4. ApprovalGate routing.
      //    PREFERRED: the engine passes options.onToolCall — its handler runs
      //    requiresApproval()->enqueueApproval() and returns either a pending
      //    notice or the real result. We delegate wholesale so there is exactly
      //    ONE approval path (engine.js handleMessage), not a divergent copy.
      //    FALLBACK: if no external handler, we still honour a locally-attached
      //    gate by DENYING risky tools (fail-closed) — we never auto-run a
      //    risky tool just because no async-approval transport is wired here.
      if (options.onToolCall) {
        let result;
        try {
          result = await options.onToolCall(name, args);
        } catch (err) {
          this.stats.errors++;
          console.error(`  [react] onToolCall error: ${name} → ${err.message}`);
          result = `Error executing ${name}: ${err.message}`;
        }
        return this._afterTool(name, args, result, iteration, toolCalls, options);
      }

      if (this.gate && this.gate.requiresApproval(name)) {
        // No external approval transport available in this path. requestApproval()
        // is the synchronous variant; if it is absent we must DENY (fail-closed).
        if (typeof this.gate.requestApproval === 'function') {
          let approved = false;
          try {
            approved = await this.gate.requestApproval(name, args);
          } catch (err) {
            console.error(`  [react] gate.requestApproval threw for ${name}: ${err.message}`);
            approved = false;
          }
          if (!approved) {
            this.stats.gateBlocks++;
            if (options.onIteration) options.onIteration({ iteration, type: 'tool_blocked', tools: [name] });
            return `Tool ${name} was blocked: human approval denied or timed out.`;
          }
        } else {
          this.stats.gateBlocks++;
          if (options.onIteration) options.onIteration({ iteration, type: 'tool_blocked', tools: [name] });
          return `Tool ${name} requires approval but no approval transport is wired into this run() path. Denied (fail-closed).`;
        }
      }

      // 5. Direct execution (read-only / approved tools only past this point).
      let result;
      try {
        console.log(`  [react] Tool: ${name} (step ${iteration})`);
        result = await this.mcp.callTool(name, args);
        if (typeof result === 'string' && result.length > 10000) {
          result = result.substring(0, 10000) + '\n\n[... truncated at 10000 chars]';
        }
      } catch (err) {
        this.stats.errors++;
        console.error(`  [react] Tool error: ${name} → ${err.message}`);
        result = `Error executing ${name}: ${err.message}`;
      }
      return this._afterTool(name, args, result, iteration, toolCalls, options);
    };

    // ── Single adapter call. The adapter runs its OWN native tool loop and
    //    calls executeTool() for each tool, feeding results back as NATIVE
    //    tool-result messages (no fake text turns). ──────────────────────
    let response;
    try {
      response = await this.llm.generate(systemPrompt, history || [], userMessage, {
        maxTokens: options.maxTokens || 4096,
        // Some adapters read max_tokens (snake_case) instead of maxTokens.
        max_tokens: options.maxTokens || 4096,
        tools: tools.length > 0 ? tools : undefined,
        onToolCall: tools.length > 0 ? executeTool : undefined,
      });
    } catch (err) {
      this.stats.errors++;
      console.error(`  [react] LLM error: ${err.message}`);
      if (this.bus) {
        this.bus.safeEmit('react.completed', { source: 'react-loop', steps, toolCalls: toolCalls.length, error: true });
      }
      throw err;
    }

    // Adapters return a string; normalise defensively in case one returns an object.
    const text = this._extractText(response);

    if (this.bus) {
      this.bus.safeEmit('react.completed', {
        source: 'react-loop',
        steps,
        toolCalls: toolCalls.length,
        capHit,
      });
    }

    return {
      response: text || 'Ich konnte die Aufgabe nicht in den verfuegbaren Schritten abschliessen.',
      // `iterations` retained in the return shape for back-compat (paperclip
      // reads result.iterations). It reflects the number of TOOL STEPS taken;
      // see the file header for why LLM rounds are not separately observable.
      iterations: steps,
      toolCalls,
      totalTokens: 0,
    };
  }

  /**
   * after_tool_call hook + bookkeeping. Returns the (possibly modified) result
   * string that gets fed back to the model as a native tool result.
   */
  async _afterTool(name, args, result, iteration, toolCalls, options) {
    if (this.hooks) {
      const hookResult = await this.hooks.run('after_tool_call', { tool: name, args, result, iteration });
      if (hookResult?.modifiedResult) result = hookResult.modifiedResult;
    }

    const resultStr = typeof result === 'string' ? result : String(result);
    toolCalls.push({
      name,
      args,
      result: resultStr.substring(0, 500),
      iteration,
    });

    if (options.onIteration) {
      options.onIteration({ iteration, type: 'tool_step', tools: [name] });
    }

    // Always hand back a string — adapters wrap it in their native tool-result
    // message type (Anthropic tool_result.content, Gemini functionResponse, …).
    return resultStr;
  }

  /**
   * Normalise an adapter response to text. Adapters return a string; this
   * stays defensive for any adapter that returns {text}/{content}.
   */
  _extractText(response) {
    if (response == null) return '';
    if (typeof response === 'string') return response;
    if (typeof response.text === 'string') return response.text;
    if (typeof response.content === 'string') return response.content;
    return String(response);
  }

  getStats() {
    return { ...this.stats };
  }
}
