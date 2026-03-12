/**
 * D5 — Soul Primitives Composer (Compositional Program Synthesis)
 *
 * The Soul Engine has ~50 modules that all follow the same patterns:
 *   - Event → Process → Event
 *   - File → Parse → Transform → Write
 *   - Timer → Scan → Action
 *   - Accumulate → Threshold → Batch
 *
 * This module extracts those patterns into composable primitives and
 * lets you build new behaviors by describing pipelines in JSON — no
 * new module code needed.
 *
 * Architecture:
 *   PrimitiveRegistry  — catalog of atomic operations
 *   Pipeline           — ordered sequence of steps with data flow
 *   Composer           — executes pipelines, manages triggers
 *   PipelineBuilder    — fluent API for building pipelines in code
 *
 * Integration: Constructor pattern, Event Bus, same lifecycle as
 * other Soul Engine modules.
 */

import { readFile, writeFile, appendFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

// ── Primitive Registry ────────────────────────────────────

/**
 * A primitive is an atomic operation with:
 *   - name: unique identifier
 *   - category: grouping (io, event, transform, control, query)
 *   - inputs: array of parameter names
 *   - execute: async function(ctx, args) → result
 */
class PrimitiveRegistry {
  constructor() {
    this.primitives = new Map();
    this._registerBuiltins();
  }

  register(name, definition) {
    if (this.primitives.has(name)) {
      throw new Error(`Primitive '${name}' already registered`);
    }
    this.primitives.set(name, {
      name,
      category: definition.category || 'custom',
      inputs: definition.inputs || [],
      description: definition.description || '',
      execute: definition.execute,
    });
  }

  get(name) {
    const p = this.primitives.get(name);
    if (!p) throw new Error(`Unknown primitive: '${name}'`);
    return p;
  }

  has(name) {
    return this.primitives.has(name);
  }

  list(category) {
    const all = [...this.primitives.values()];
    return category ? all.filter(p => p.category === category) : all;
  }

  // ── Built-in Primitives ─────────────────────────────────

  _registerBuiltins() {
    // === I/O Primitives ===

    this.register('read_file', {
      category: 'io',
      inputs: ['path'],
      description: 'Read a file and return its content as string',
      execute: async (ctx, { path }) => {
        const resolved = path.startsWith('/') ? path : resolve(ctx.soulPath, path);
        if (!existsSync(resolved)) return null;
        return readFile(resolved, 'utf-8');
      },
    });

    this.register('write_file', {
      category: 'io',
      inputs: ['path', 'content'],
      description: 'Write content to a file (overwrites)',
      execute: async (ctx, { path, content }) => {
        const resolved = path.startsWith('/') ? path : resolve(ctx.soulPath, path);
        const dir = resolve(resolved, '..');
        if (!existsSync(dir)) await mkdir(dir, { recursive: true });
        await writeFile(resolved, content);
        return resolved;
      },
    });

    this.register('append_file', {
      category: 'io',
      inputs: ['path', 'content'],
      description: 'Append content to a file',
      execute: async (ctx, { path, content }) => {
        const resolved = path.startsWith('/') ? path : resolve(ctx.soulPath, path);
        await appendFile(resolved, content);
        return resolved;
      },
    });

    // === Event Primitives ===

    this.register('emit', {
      category: 'event',
      inputs: ['event', 'payload'],
      description: 'Emit an event on the bus',
      execute: async (ctx, { event, payload }) => {
        if (!ctx.bus) return false;
        ctx.bus.safeEmit(event, { source: 'composer', ...payload });
        return true;
      },
    });

    this.register('wait_event', {
      category: 'event',
      inputs: ['event', 'timeout'],
      description: 'Wait for a single event (with timeout)',
      execute: (ctx, { event, timeout = 30000 }) => {
        if (!ctx.bus) return Promise.resolve(null);
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            ctx.bus.removeListener(event, handler);
            resolve(null);
          }, timeout);
          const handler = (data) => {
            clearTimeout(timer);
            ctx.bus.removeListener(event, handler);
            resolve(data);
          };
          ctx.bus.on(event, handler);
        });
      },
    });

    // === Transform Primitives ===

    this.register('parse_markdown_table', {
      category: 'transform',
      inputs: ['content'],
      description: 'Parse a markdown table into array of objects',
      execute: async (_ctx, { content }) => {
        if (!content) return [];
        const lines = content.split('\n').filter(l => l.trim().startsWith('|'));
        if (lines.length < 2) return [];

        const headers = lines[0].split('|').map(c => c.trim()).filter(Boolean);
        const rows = [];

        for (let i = 2; i < lines.length; i++) {
          const cells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
          if (cells.length === 0 || cells[0].startsWith('-')) continue;
          const row = {};
          for (let j = 0; j < headers.length; j++) {
            row[headers[j]] = cells[j] || '';
          }
          rows.push(row);
        }
        return rows;
      },
    });

    this.register('parse_sections', {
      category: 'transform',
      inputs: ['content', 'level'],
      description: 'Parse markdown into sections by heading level',
      execute: async (_ctx, { content, level = 2 }) => {
        if (!content) return [];
        const prefix = '#'.repeat(level) + ' ';
        const sections = [];
        let current = null;

        for (const line of content.split('\n')) {
          if (line.startsWith(prefix)) {
            if (current) sections.push(current);
            current = { title: line.slice(prefix.length).trim(), body: '' };
          } else if (current) {
            current.body += line + '\n';
          }
        }
        if (current) sections.push(current);
        return sections;
      },
    });

    this.register('map', {
      category: 'transform',
      inputs: ['data', 'fn'],
      description: 'Map over an array with a transform expression',
      execute: async (_ctx, { data, fn }) => {
        if (!Array.isArray(data)) return [];
        // fn is a string expression evaluated per item
        // Available vars: item, index
        const mapper = new Function('item', 'index', `return (${fn})`);
        return data.map((item, index) => mapper(item, index));
      },
    });

    this.register('filter', {
      category: 'transform',
      inputs: ['data', 'predicate'],
      description: 'Filter an array with a predicate expression',
      execute: async (_ctx, { data, predicate }) => {
        if (!Array.isArray(data)) return [];
        const pred = new Function('item', 'index', `return (${predicate})`);
        return data.filter((item, index) => pred(item, index));
      },
    });

    this.register('reduce', {
      category: 'transform',
      inputs: ['data', 'fn', 'initial'],
      description: 'Reduce an array with an accumulator expression',
      execute: async (_ctx, { data, fn, initial }) => {
        if (!Array.isArray(data)) return initial;
        const reducer = new Function('acc', 'item', 'index', `return (${fn})`);
        return data.reduce((acc, item, index) => reducer(acc, item, index), initial);
      },
    });

    this.register('sort', {
      category: 'transform',
      inputs: ['data', 'key', 'order'],
      description: 'Sort an array by a key',
      execute: async (_ctx, { data, key, order = 'asc' }) => {
        if (!Array.isArray(data)) return [];
        const sorted = [...data].sort((a, b) => {
          const va = key ? a[key] : a;
          const vb = key ? b[key] : b;
          if (va < vb) return -1;
          if (va > vb) return 1;
          return 0;
        });
        return order === 'desc' ? sorted.reverse() : sorted;
      },
    });

    this.register('pick', {
      category: 'transform',
      inputs: ['data', 'keys'],
      description: 'Pick specific keys from objects in an array',
      execute: async (_ctx, { data, keys }) => {
        if (!Array.isArray(data)) return [];
        return data.map(item => {
          const picked = {};
          for (const k of keys) picked[k] = item[k];
          return picked;
        });
      },
    });

    this.register('template', {
      category: 'transform',
      inputs: ['text', 'vars'],
      description: 'Replace {{key}} placeholders in text with values',
      execute: async (_ctx, { text, vars }) => {
        if (!text) return '';
        return text.replace(/\{\{(\w+)\}\}/g, (_, key) =>
          vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`
        );
      },
    });

    this.register('merge', {
      category: 'transform',
      inputs: ['objects'],
      description: 'Shallow merge multiple objects into one',
      execute: async (_ctx, { objects }) => {
        return Object.assign({}, ...objects);
      },
    });

    this.register('get', {
      category: 'transform',
      inputs: ['data', 'path'],
      description: 'Get a nested value by dot-path (e.g. "field.vector.arousal")',
      execute: async (_ctx, { data, path }) => {
        return path.split('.').reduce((obj, key) => obj?.[key], data);
      },
    });

    this.register('set', {
      category: 'transform',
      inputs: ['data', 'path', 'value'],
      description: 'Set a nested value by dot-path (immutable — returns new object)',
      execute: async (_ctx, { data, path, value }) => {
        const result = JSON.parse(JSON.stringify(data || {}));
        const parts = path.split('.');
        let target = result;
        for (let i = 0; i < parts.length - 1; i++) {
          if (target[parts[i]] === undefined) target[parts[i]] = {};
          target = target[parts[i]];
        }
        target[parts[parts.length - 1]] = value;
        return result;
      },
    });

    // === Query Primitives ===

    this.register('field_read', {
      category: 'query',
      inputs: ['dimension'],
      description: 'Read a dimension from the allostatic field',
      execute: async (ctx, { dimension }) => {
        if (!ctx.field) return null;
        if (dimension === '*') return { ...ctx.field.vector };
        return ctx.field.vector?.[dimension] ?? null;
      },
    });

    this.register('field_modulations', {
      category: 'query',
      inputs: [],
      description: 'Get current field modulations',
      execute: async (ctx) => {
        if (!ctx.field) return null;
        return ctx.field.getModulations?.() ?? null;
      },
    });

    this.register('bus_recent', {
      category: 'query',
      inputs: ['count'],
      description: 'Get recent events from the bus log',
      execute: async (ctx, { count = 20 }) => {
        if (!ctx.bus) return [];
        return ctx.bus.getRecentEvents?.(count) ?? [];
      },
    });

    // === Control Flow Primitives ===

    this.register('branch', {
      category: 'control',
      inputs: ['condition', 'ifTrue', 'ifFalse'],
      description: 'Branch: return ifTrue or ifFalse based on condition',
      execute: async (_ctx, { condition, ifTrue, ifFalse }) => {
        return condition ? ifTrue : ifFalse;
      },
    });

    this.register('clamp', {
      category: 'control',
      inputs: ['value', 'min', 'max'],
      description: 'Clamp a numeric value between min and max',
      execute: async (_ctx, { value, min = 0, max = 1 }) => {
        return Math.min(max, Math.max(min, value));
      },
    });

    this.register('throttle', {
      category: 'control',
      inputs: ['key', 'intervalMs'],
      description: 'Throttle: returns true if enough time has passed since last call for key',
      execute: async (ctx, { key, intervalMs = 60000 }) => {
        if (!ctx._throttle) ctx._throttle = new Map();
        const last = ctx._throttle.get(key) || 0;
        const now = Date.now();
        if (now - last < intervalMs) return false;
        ctx._throttle.set(key, now);
        return true;
      },
    });

    this.register('log', {
      category: 'control',
      inputs: ['message', 'data'],
      description: 'Log a message to console (debugging)',
      execute: async (_ctx, { message, data }) => {
        console.log(`  [composer] ${message}`, data !== undefined ? data : '');
        return data !== undefined ? data : message;
      },
    });

    this.register('timestamp', {
      category: 'control',
      inputs: [],
      description: 'Return current ISO timestamp',
      execute: async () => new Date().toISOString(),
    });

    this.register('literal', {
      category: 'control',
      inputs: ['value'],
      description: 'Return a literal value (pass-through)',
      execute: async (_ctx, { value }) => value,
    });

    // === Math Primitives ===

    this.register('math', {
      category: 'transform',
      inputs: ['expr', 'vars'],
      description: 'Evaluate a math expression with variables',
      execute: async (_ctx, { expr, vars = {} }) => {
        // Safe subset: only allow math operations
        const fn = new Function(...Object.keys(vars), `return (${expr})`);
        return fn(...Object.values(vars));
      },
    });

    this.register('aggregate_stats', {
      category: 'transform',
      inputs: ['data', 'key'],
      description: 'Compute min/max/mean/count for a numeric key in array',
      execute: async (_ctx, { data, key }) => {
        if (!Array.isArray(data) || data.length === 0) return { min: 0, max: 0, mean: 0, count: 0 };
        const values = data.map(d => key ? d[key] : d).filter(v => typeof v === 'number');
        if (values.length === 0) return { min: 0, max: 0, mean: 0, count: 0 };
        return {
          min: Math.min(...values),
          max: Math.max(...values),
          mean: values.reduce((s, v) => s + v, 0) / values.length,
          count: values.length,
        };
      },
    });
  }
}

// ── Pipeline Execution Engine ─────────────────────────────

/**
 * A pipeline is described as JSON:
 *
 * {
 *   name: "my-pipeline",
 *   description: "What it does",
 *   trigger: { event: "field.updated" } | { interval: 60000 } | null,
 *   steps: [
 *     { id: "s1", primitive: "read_file", args: { path: "seele/SCHATTEN.md" } },
 *     { id: "s2", primitive: "parse_markdown_table", args: { content: "$s1" } },
 *     { id: "s3", primitive: "filter", args: { data: "$s2", predicate: "item.Status === 'offen'" } },
 *     { id: "s4", primitive: "emit", args: { event: "shadows.scanned", payload: { count: "$s3.length" } } },
 *   ]
 * }
 *
 * Data flow:
 *   - "$stepId" references the output of a previous step
 *   - "$stepId.key" references a nested property
 *   - "$input" references the pipeline input (trigger payload or manual input)
 *   - "$ctx.field" / "$ctx.soulPath" references context values
 *   - Literal values are passed through as-is
 */

class PipelineExecutor {
  constructor(registry) {
    this.registry = registry;
  }

  /**
   * Execute a pipeline definition against a context.
   *
   * @param {object} pipeline - Pipeline definition (name, steps, etc.)
   * @param {object} ctx - Execution context { soulPath, bus, field, ... }
   * @param {any} input - Optional input data (from trigger payload)
   * @returns {{ results: Map, output: any, success: boolean, error: string|null, duration: number }}
   */
  async execute(pipeline, ctx, input = null) {
    const start = Date.now();
    const results = new Map();
    results.set('input', input);
    let lastOutput = input;
    let error = null;

    for (const step of pipeline.steps) {
      try {
        const primitive = this.registry.get(step.primitive);
        const resolvedArgs = this._resolveArgs(step.args || {}, results, ctx);
        const output = await primitive.execute(ctx, resolvedArgs);
        results.set(step.id, output);
        lastOutput = output;
      } catch (err) {
        error = `Step '${step.id}' (${step.primitive}): ${err.message}`;
        console.error(`  [composer] Pipeline '${pipeline.name}' failed at step '${step.id}': ${err.message}`);
        break;
      }
    }

    return {
      results,
      output: lastOutput,
      success: error === null,
      error,
      duration: Date.now() - start,
    };
  }

  /**
   * Resolve argument references ($stepId, $input, $ctx.path).
   */
  _resolveArgs(args, results, ctx) {
    const resolved = {};
    for (const [key, value] of Object.entries(args)) {
      resolved[key] = this._resolveValue(value, results, ctx);
    }
    return resolved;
  }

  _resolveValue(value, results, ctx) {
    if (typeof value !== 'string') return value;
    if (!value.startsWith('$')) return value;

    // Handle arrays/objects with refs
    if (Array.isArray(value)) {
      return value.map(v => this._resolveValue(v, results, ctx));
    }

    const ref = value.slice(1); // Remove $

    // $ctx.field, $ctx.soulPath, etc.
    if (ref.startsWith('ctx.')) {
      return ref.split('.').slice(1).reduce((obj, k) => obj?.[k], ctx);
    }

    // $stepId or $stepId.path
    const dotIndex = ref.indexOf('.');
    if (dotIndex === -1) {
      return results.get(ref);
    }

    const stepId = ref.slice(0, dotIndex);
    const path = ref.slice(dotIndex + 1);
    const stepResult = results.get(stepId);
    return path.split('.').reduce((obj, k) => obj?.[k], stepResult);
  }
}

// ── Pipeline Builder (Fluent API) ─────────────────────────

class PipelineBuilder {
  constructor(name) {
    this._pipeline = {
      name,
      description: '',
      trigger: null,
      steps: [],
    };
    this._stepCounter = 0;
  }

  describe(text) {
    this._pipeline.description = text;
    return this;
  }

  onEvent(eventName) {
    this._pipeline.trigger = { event: eventName };
    return this;
  }

  onInterval(ms) {
    this._pipeline.trigger = { interval: ms };
    return this;
  }

  step(primitive, args = {}) {
    const id = `s${++this._stepCounter}`;
    this._pipeline.steps.push({ id, primitive, args });
    return this;
  }

  /** Reference the output of step N (1-indexed) */
  ref(stepNum) {
    return `$s${stepNum}`;
  }

  build() {
    return this._pipeline;
  }
}

// ── Composer (Main Module) ────────────────────────────────

const STATE_FILE = '.soul-composer.json';

export class SoulComposer {
  constructor(soulPath, { bus, field } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.field = field;
    this.statePath = resolve(soulPath, STATE_FILE);

    this.registry = new PrimitiveRegistry();
    this.executor = new PipelineExecutor(this.registry);

    // Registered pipelines
    this.pipelines = new Map();

    // Active event listeners (for cleanup)
    this._eventListeners = new Map();

    // Active interval timers
    this._intervalTimers = new Map();

    // Execution log
    this.executionLog = [];

    // Metrics
    this.metrics = {
      totalExecutions: 0,
      successes: 0,
      failures: 0,
      avgDuration: 0,
      byPipeline: {},
    };

    this._saveTimer = null;

    // Register built-in pipelines
    this._registerBuiltinPipelines();
  }

  // ── Lifecycle ───────────────────────────────────────────

  async load() {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const loaded = JSON.parse(raw);
      if (loaded.metrics) this.metrics = { ...this.metrics, ...loaded.metrics };
      if (loaded.executionLog) this.executionLog = loaded.executionLog.slice(-100);
      // Restore custom pipelines
      if (loaded.customPipelines) {
        for (const p of loaded.customPipelines) {
          this.registerPipeline(p, { persist: false });
        }
      }
    } catch {
      // Corrupted — start fresh
    }
  }

  async save() {
    try {
      const customPipelines = [...this.pipelines.values()]
        .filter(p => !p._builtin);
      await writeFile(this.statePath, JSON.stringify({
        metrics: this.metrics,
        executionLog: this.executionLog.slice(-100),
        customPipelines,
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch {
      // Best effort
    }
  }

  start() {
    // Wire up all registered pipelines with triggers
    for (const [name, pipeline] of this.pipelines) {
      this._activateTrigger(name, pipeline);
    }
    this._saveTimer = setInterval(() => this.save(), 600000);
  }

  async stop() {
    // Clean up event listeners
    for (const [name, cleanup] of this._eventListeners) {
      cleanup();
    }
    this._eventListeners.clear();

    // Clean up timers
    for (const [name, timer] of this._intervalTimers) {
      clearInterval(timer);
    }
    this._intervalTimers.clear();

    if (this._saveTimer) clearInterval(this._saveTimer);
    return this.save();
  }

  registerListeners() {
    if (!this.bus) return;

    // Allow runtime pipeline registration via events
    this.bus.on('composer.register', (event) => {
      if (event.pipeline) {
        try {
          this.registerPipeline(event.pipeline);
        } catch (err) {
          console.error(`  [composer] Registration failed: ${err.message}`);
        }
      }
    });

    // Allow runtime pipeline execution via events
    this.bus.on('composer.execute', async (event) => {
      if (event.pipeline) {
        const result = await this.execute(event.pipeline, event.input);
        if (this.bus) {
          this.bus.safeEmit('composer.result', {
            source: 'composer',
            pipeline: event.pipeline,
            result: { success: result.success, output: result.output, error: result.error },
          });
        }
      }
    });
  }

  // ── Pipeline Management ─────────────────────────────────

  /**
   * Register a pipeline definition.
   */
  registerPipeline(pipeline, { persist = true } = {}) {
    // Validate
    if (!pipeline.name) throw new Error('Pipeline must have a name');
    if (!pipeline.steps || pipeline.steps.length === 0) throw new Error('Pipeline must have steps');

    for (const step of pipeline.steps) {
      if (!step.id) throw new Error(`Step missing id in pipeline '${pipeline.name}'`);
      if (!step.primitive) throw new Error(`Step '${step.id}' missing primitive`);
      if (!this.registry.has(step.primitive)) {
        throw new Error(`Unknown primitive '${step.primitive}' in step '${step.id}'`);
      }
    }

    this.pipelines.set(pipeline.name, pipeline);

    // If already started, activate trigger immediately
    if (this._saveTimer) {
      this._activateTrigger(pipeline.name, pipeline);
    }

    return pipeline;
  }

  /**
   * Execute a pipeline by name or definition.
   */
  async execute(nameOrPipeline, input = null) {
    const pipeline = typeof nameOrPipeline === 'string'
      ? this.pipelines.get(nameOrPipeline)
      : nameOrPipeline;

    if (!pipeline) throw new Error(`Pipeline '${nameOrPipeline}' not found`);

    const ctx = {
      soulPath: this.soulPath,
      bus: this.bus,
      field: this.field,
    };

    const result = await this.executor.execute(pipeline, ctx, input);

    // Track metrics
    this.metrics.totalExecutions++;
    if (result.success) this.metrics.successes++;
    else this.metrics.failures++;

    const totalDur = this.executionLog.reduce((s, e) => s + e.duration, 0) + result.duration;
    this.metrics.avgDuration = Math.round(totalDur / this.metrics.totalExecutions);

    if (!this.metrics.byPipeline[pipeline.name]) {
      this.metrics.byPipeline[pipeline.name] = { runs: 0, successes: 0, failures: 0 };
    }
    const pm = this.metrics.byPipeline[pipeline.name];
    pm.runs++;
    if (result.success) pm.successes++;
    else pm.failures++;

    // Log
    this.executionLog.push({
      pipeline: pipeline.name,
      success: result.success,
      error: result.error,
      duration: result.duration,
      ts: Date.now(),
    });
    if (this.executionLog.length > 200) {
      this.executionLog = this.executionLog.slice(-200);
    }

    return result;
  }

  // ── Trigger Activation ──────────────────────────────────

  _activateTrigger(name, pipeline) {
    if (!pipeline.trigger) return;

    if (pipeline.trigger.event && this.bus) {
      const handler = async (eventData) => {
        await this.execute(name, eventData);
      };
      this.bus.on(pipeline.trigger.event, handler);
      this._eventListeners.set(name, () => {
        this.bus.removeListener(pipeline.trigger.event, handler);
      });
    }

    if (pipeline.trigger.interval) {
      const timer = setInterval(async () => {
        await this.execute(name);
      }, pipeline.trigger.interval);
      this._intervalTimers.set(name, timer);
    }
  }

  // ── Built-in Pipelines ─────────────────────────────────

  _registerBuiltinPipelines() {
    // Pipeline 1: Shadow Scanner
    // Reads SCHATTEN.md → parses table → filters open → emits event with count
    this.registerPipeline({
      name: 'shadow-scanner',
      _builtin: true,
      description: 'Scan shadow tensions and emit status',
      trigger: { interval: 3600000 }, // Every hour
      steps: [
        { id: 's1', primitive: 'read_file', args: { path: 'seele/SCHATTEN.md' } },
        { id: 's2', primitive: 'parse_markdown_table', args: { content: '$s1' } },
        { id: 's3', primitive: 'filter', args: { data: '$s2', predicate: "item.Status === 'offen'" } },
        { id: 's4', primitive: 'aggregate_stats', args: { data: '$s3', key: null } },
        { id: 's5', primitive: 'emit', args: {
          event: 'shadows.scanned',
          payload: { openCount: '$s3.length', tensions: '$s3' },
        }},
      ],
    }, { persist: false });

    // Pipeline 2: Interest Staleness Check
    // Reads interests → finds stale ones → emits alert
    this.registerPipeline({
      name: 'interest-staleness',
      _builtin: true,
      description: 'Find interests not checked in >7 days',
      trigger: { interval: 7200000 }, // Every 2 hours
      steps: [
        { id: 's1', primitive: 'read_file', args: { path: 'seele/INTERESSEN.md' } },
        { id: 's2', primitive: 'parse_markdown_table', args: { content: '$s1' } },
        { id: 's3', primitive: 'filter', args: {
          data: '$s2',
          predicate: "item.Status === 'aktiv' && item['Letzter Check'] && (Date.now() - new Date(item['Letzter Check']).getTime()) > 7 * 86400000",
        }},
        { id: 's4', primitive: 'emit', args: {
          event: 'interest.stale',
          payload: { staleInterests: '$s3' },
        }},
      ],
    }, { persist: false });

    // Pipeline 3: Field Deviation Report
    // Reads all field dimensions → finds deviations → writes summary
    this.registerPipeline({
      name: 'field-deviation-report',
      _builtin: true,
      description: 'Report field dimensions deviating >0.2 from baseline',
      trigger: { event: 'field.updated' },
      steps: [
        { id: 's1', primitive: 'throttle', args: { key: 'field-report', intervalMs: 1800000 } },
        { id: 's2', primitive: 'field_read', args: { dimension: '*' } },
        { id: 's3', primitive: 'timestamp', args: {} },
        { id: 's4', primitive: 'template', args: {
          text: '{{ts}} | Field: arousal={{arousal}} valence={{valence}} openness={{openness}} vigilance={{vigilance}} ct={{creative_tension}} so={{social_orientation}} tf={{time_focus}} ip={{integration_pressure}}',
          vars: '$s2',
        }},
      ],
    }, { persist: false });

    // Pipeline 4: Surprise → Field Nudge → Log
    // On surprise → nudge integration pressure → log the event
    this.registerPipeline({
      name: 'surprise-response',
      _builtin: true,
      description: 'React to surprises: log and notify',
      trigger: { event: 'surprise.detected' },
      steps: [
        { id: 's1', primitive: 'log', args: {
          message: 'Surprise detected',
          data: '$input',
        }},
        { id: 's2', primitive: 'timestamp', args: {} },
        { id: 's3', primitive: 'template', args: {
          text: '\n[{{ts}}] Surprise: {{message}} (error: {{avgError}})\n',
          vars: '$input',
        }},
        { id: 's4', primitive: 'append_file', args: {
          path: '.soul-surprise-log.md',
          content: '$s3',
        }},
      ],
    }, { persist: false });

    // Pipeline 5: Daily Soul Summary
    // Reads multiple soul files → composes a summary → writes it
    this.registerPipeline({
      name: 'daily-soul-summary',
      _builtin: true,
      description: 'Compose a daily summary from multiple soul files',
      trigger: null, // Manual or scheduled externally
      steps: [
        { id: 's1', primitive: 'read_file', args: { path: 'seele/SCHATTEN.md' } },
        { id: 's2', primitive: 'parse_markdown_table', args: { content: '$s1' } },
        { id: 's3', primitive: 'filter', args: { data: '$s2', predicate: "item.Status === 'offen'" } },
        { id: 's4', primitive: 'read_file', args: { path: 'seele/INTERESSEN.md' } },
        { id: 's5', primitive: 'parse_markdown_table', args: { content: '$s4' } },
        { id: 's6', primitive: 'filter', args: { data: '$s5', predicate: "item.Status === 'aktiv'" } },
        { id: 's7', primitive: 'field_read', args: { dimension: '*' } },
        { id: 's8', primitive: 'timestamp', args: {} },
        { id: 's9', primitive: 'template', args: {
          text: '# Soul Summary — {{date}}\n\n## Shadows ({{shadowCount}} open)\n{{shadows}}\n\n## Interests ({{interestCount}} active)\n{{interests}}\n\n## Field State\n{{field}}\n',
          vars: {
            date: '$s8',
            shadowCount: '$s3.length',
            shadows: '$s3',
            interestCount: '$s6.length',
            interests: '$s6',
            field: '$s7',
          },
        }},
        { id: 's10', primitive: 'write_file', args: {
          path: '.soul-daily-summary.md',
          content: '$s9',
        }},
        { id: 's11', primitive: 'emit', args: {
          event: 'summary.generated',
          payload: { shadows: '$s3.length', interests: '$s6.length' },
        }},
      ],
    }, { persist: false });
  }

  // ── Query Interface ─────────────────────────────────────

  /**
   * Get all registered pipeline names and descriptions.
   */
  listPipelines() {
    return [...this.pipelines.entries()].map(([name, p]) => ({
      name,
      description: p.description,
      trigger: p.trigger,
      stepCount: p.steps.length,
      builtin: !!p._builtin,
    }));
  }

  /**
   * Get registered primitives.
   */
  listPrimitives(category) {
    return this.registry.list(category).map(p => ({
      name: p.name,
      category: p.category,
      inputs: p.inputs,
      description: p.description,
    }));
  }

  /**
   * Get execution stats.
   */
  getStats() {
    return {
      primitives: this.registry.primitives.size,
      pipelines: this.pipelines.size,
      builtinPipelines: [...this.pipelines.values()].filter(p => p._builtin).length,
      customPipelines: [...this.pipelines.values()].filter(p => !p._builtin).length,
      ...this.metrics,
      successRate: this.metrics.totalExecutions > 0
        ? (this.metrics.successes / this.metrics.totalExecutions * 100).toFixed(1) + '%'
        : 'N/A',
    };
  }

  /**
   * Get recent execution log.
   */
  getLog(limit = 20) {
    return this.executionLog.slice(-limit);
  }

  /**
   * For seed consolidation: one-line summary.
   */
  toSeedLine() {
    const s = this.getStats();
    return `primitives:${s.primitives}|pipelines:${s.pipelines}|runs:${s.totalExecutions}|success:${s.successRate}`;
  }
}

// ── Fluent Builder Export ─────────────────────────────────

export function pipeline(name) {
  return new PipelineBuilder(name);
}

// ── Default Export for Convenience ────────────────────────

export { PrimitiveRegistry, PipelineExecutor, PipelineBuilder };
