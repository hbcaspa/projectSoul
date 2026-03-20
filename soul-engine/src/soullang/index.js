/**
 * SoulLang Module
 *
 * Main entry point. Integrates into the Soul Engine as a module.
 * Lifecycle: load → registerListeners → start → stop
 *
 * Architecture:
 *   Engine State (numbers) → Writer → .soul-state.sl → Compiler → model-prompt + human-display
 *                                                                       ↓
 *                                                          .soul-compiled-prompt (for Claude)
 *                                                          .soul-display (for Monitor)
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from './parser.js';
import { compile } from './compiler.js';
import { SoulLangWriter } from './writer.js';

export class SoulLangModule {
  constructor(soulPath, { bus, field, contradictions, tom, predictor, impulseState } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.statePath = resolve(soulPath, '.soul-state.sl');
    this.compiledPromptPath = resolve(soulPath, '.soul-compiled-prompt');
    this.displayPath = resolve(soulPath, '.soul-display');
    this.evalPath = resolve(soulPath, '.soul-eval.sl');

    // Writer handles Engine → SoulLang
    this.writer = new SoulLangWriter(soulPath, {
      bus, field, contradictions, tom, predictor, impulseState
    });

    this._compileInterval = null;
  }

  async load() {
    // Try initial compilation if state file exists
    try {
      await this._compile();
    } catch {
      // No state file yet — writer will create one on start
    }
  }

  registerListeners() {
    this.writer.registerListeners();

    if (this.bus) {
      // Recompile when writer produces new state
      this.bus.on('soullang.state.written', () => this._compile());
    }
  }

  start() {
    this.writer.start();

    // Compile every 5 minutes (matches writer interval)
    this._compileInterval = setInterval(() => this._compile(), 5 * 60 * 1000);

    // Initial compile after writer's first write
    setTimeout(() => this._compile(), 2000);

    console.log('  [soullang] Module active — writer + compiler running');
  }

  stop() {
    this.writer.stop();
    if (this._compileInterval) clearInterval(this._compileInterval);
    this._compile(); // final compilation
  }

  async _compile() {
    try {
      const source = await readFile(this.statePath, 'utf-8');
      const blocks = parse(source);
      const { modelPrompt, humanDisplay } = compile(blocks);

      // Write compiled outputs
      await Promise.all([
        writeFile(this.compiledPromptPath, modelPrompt, 'utf-8'),
        writeFile(this.displayPath, humanDisplay, 'utf-8')
      ]);

      if (this.bus) {
        this.bus.safeEmit('soullang.compiled', {
          source: 'soullang',
          blockCount: blocks.length,
          promptLength: modelPrompt.length,
          timestamp: Date.now()
        });
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('  [soullang] Compile error:', err.message);
      }
    }
  }

  /**
   * Read an eval file written by Claude Code (feedback loop)
   */
  async readEval() {
    try {
      const source = await readFile(this.evalPath, 'utf-8');
      const blocks = parse(source);
      return blocks.filter(b => b.type === 'eval');
    } catch {
      return [];
    }
  }

  /**
   * Get current compiled state for API / monitoring
   */
  async getDisplay() {
    try {
      return await readFile(this.displayPath, 'utf-8');
    } catch {
      return '(no compiled state yet)';
    }
  }

  /**
   * Get current compiled prompt for Claude Context Writer integration
   */
  async getModelPrompt() {
    try {
      return await readFile(this.compiledPromptPath, 'utf-8');
    } catch {
      return '';
    }
  }

  getStats() {
    return {
      writer: this.writer.getStats(),
      paths: {
        state: this.statePath,
        prompt: this.compiledPromptPath,
        display: this.displayPath,
        eval: this.evalPath
      }
    };
  }
}
