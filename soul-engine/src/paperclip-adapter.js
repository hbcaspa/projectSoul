/**
 * PaperclipAdapter — Connects Soul Engine to Paperclip AI orchestration.
 *
 * Paperclip manages teams of AI agents as an organization.
 * This adapter registers the Soul Engine as a Paperclip agent,
 * receives task assignments, executes them via ReAct loop,
 * and reports results back.
 *
 * Setup:
 * 1. Run: npx paperclipai onboard --yes (starts Paperclip locally or connect to remote)
 * 2. Set PAPERCLIP_URL and PAPERCLIP_AGENT_TOKEN in .env
 * 3. Engine auto-registers on startup
 *
 * Flow:
 * Paperclip assigns task → Adapter receives via heartbeat →
 * ReAct loop executes → Result reported back → Next task
 */

const DEFAULT_HEARTBEAT_INTERVAL = 30000; // 30s
const DEFAULT_URL = 'http://localhost:3100';

export class PaperclipAdapter {
  constructor({ bus, engine, reactLoop, url, token, heartbeatInterval } = {}) {
    this.bus = bus || null;
    this.engine = engine || null;
    this.reactLoop = reactLoop || null;
    this.url = url || process.env.PAPERCLIP_URL || DEFAULT_URL;
    this.token = token || process.env.PAPERCLIP_AGENT_TOKEN || null;
    this.heartbeatInterval = heartbeatInterval || parseInt(process.env.PAPERCLIP_HEARTBEAT_MS || DEFAULT_HEARTBEAT_INTERVAL);
    this._timer = null;
    this._processing = false;
    this.stats = {
      heartbeats: 0,
      tasksReceived: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      connected: false,
    };
  }

  /**
   * Start the adapter — begin heartbeat polling.
   */
  async start() {
    if (!this.token) {
      console.log('  Paperclip: disabled (no PAPERCLIP_AGENT_TOKEN)');
      return false;
    }

    // Test connection
    try {
      const res = await fetch(`${this.url}/api/status`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.stats.connected = true;
      console.log(`  Paperclip: connected (${this.url})`);
    } catch (err) {
      console.log(`  Paperclip: unreachable (${err.message}) — will retry`);
      this.stats.connected = false;
    }

    // Start heartbeat loop
    this._timer = setInterval(() => this._heartbeat(), this.heartbeatInterval);
    return true;
  }

  /**
   * Stop the adapter.
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Heartbeat: check in with Paperclip, receive tasks.
   */
  async _heartbeat() {
    if (this._processing) return; // Don't overlap
    this.stats.heartbeats++;

    try {
      const res = await fetch(`${this.url}/api/agent/heartbeat`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({
          status: this.engine?.hibernating ? 'idle' : 'ready',
          capabilities: this._getCapabilities(),
          metrics: {
            uptime: process.uptime(),
            mood: this.engine?.unifiedContext?.identity?.mood || 'unknown',
            reactStats: this.reactLoop?.getStats() || {},
          },
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        if (!this.stats.connected) return; // Silent retry
        console.error(`  [paperclip] Heartbeat failed: HTTP ${res.status}`);
        return;
      }

      this.stats.connected = true;
      const data = await res.json();

      // Process assigned tasks
      if (data.tasks && data.tasks.length > 0) {
        for (const task of data.tasks) {
          await this._executeTask(task);
        }
      }
    } catch (err) {
      if (this.stats.connected) {
        console.error(`  [paperclip] Heartbeat error: ${err.message}`);
      }
      this.stats.connected = false;
    }
  }

  /**
   * Execute a task from Paperclip using the ReAct loop.
   */
  async _executeTask(task) {
    this._processing = true;
    this.stats.tasksReceived++;

    const taskId = task.id || task.taskId;
    console.log(`  [paperclip] Task received: ${task.title || taskId}`);

    if (this.bus) {
      this.bus.safeEmit('paperclip.task_received', {
        source: 'paperclip-adapter',
        taskId,
        title: task.title,
      });
    }

    try {
      // Build prompt from task
      const message = this._buildTaskPrompt(task);

      let result;
      if (this.reactLoop) {
        // Use ReAct loop for iterative execution
        const { buildConversationPrompt } = await import('./prompt.js');
        await this.engine.context.load();
        const systemPrompt = buildConversationPrompt(this.engine.context);

        result = await this.reactLoop.run(systemPrompt, [], message, {
          maxIterations: task.maxIterations || 10,
          timeout: task.timeout || 120000,
        });
      } else if (this.engine?.llm) {
        // Fallback: single LLM call
        result = { response: await this.engine.llm.generate('', [], message) };
      } else {
        throw new Error('No LLM available');
      }

      // Report success
      await this._reportResult(taskId, 'completed', result);
      this.stats.tasksCompleted++;

      if (this.bus) {
        this.bus.safeEmit('paperclip.task_completed', {
          source: 'paperclip-adapter',
          taskId,
          iterations: result.iterations,
        });
      }
    } catch (err) {
      console.error(`  [paperclip] Task failed: ${err.message}`);
      await this._reportResult(taskId, 'failed', { error: err.message });
      this.stats.tasksFailed++;
    } finally {
      this._processing = false;
    }
  }

  /**
   * Report task result back to Paperclip.
   */
  async _reportResult(taskId, status, result) {
    try {
      await fetch(`${this.url}/api/agent/tasks/${taskId}/result`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({
          status,
          result: typeof result === 'string' ? result : result.response || JSON.stringify(result),
          iterations: result.iterations || 0,
          toolCalls: result.toolCalls?.length || 0,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (err) {
      console.error(`  [paperclip] Failed to report result for ${taskId}: ${err.message}`);
    }
  }

  /**
   * Build a task prompt from Paperclip task data.
   */
  _buildTaskPrompt(task) {
    let prompt = task.description || task.prompt || task.title || '';

    if (task.context) {
      prompt += `\n\nKontext:\n${task.context}`;
    }
    if (task.constraints) {
      prompt += `\n\nEinschraenkungen:\n${task.constraints}`;
    }
    if (task.expectedOutput) {
      prompt += `\n\nErwartetes Ergebnis:\n${task.expectedOutput}`;
    }

    return prompt;
  }

  /**
   * Get capabilities to report to Paperclip.
   */
  _getCapabilities() {
    const caps = ['chat', 'reasoning'];

    if (this.engine?.mcp?.hasTools()) caps.push('tool_use');
    if (this.engine?.research) caps.push('research');
    if (this.engine?.sandbox) caps.push('code_execution');
    if (this.engine?.whatsapp) caps.push('whatsapp');
    if (this.engine?.telegram) caps.push('telegram');
    if (this.reactLoop) caps.push('react_loop');

    return caps;
  }

  _headers() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.token}`,
    };
  }

  getStats() {
    return { ...this.stats, url: this.url };
  }
}
