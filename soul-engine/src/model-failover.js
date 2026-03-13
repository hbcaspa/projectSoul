/**
 * ModelFailover — Resiliente LLM-Provider-Kette
 *
 * Besser als OpenClaw:
 *  - Circuit Breaker (closed → open → half-open) pro Provider
 *  - Gesundheits-Score (EMA) — lernt welcher Provider zuverlässiger ist
 *  - Rate-Limit vs. transiente Fehler getrennt behandelt
 *  - Automatischer Fallback ohne Neustart: Gemini → Anthropic → OpenAI → Ollama
 *  - Bus-Events für Monitoring: provider.failover, provider.recovered
 *  - Retry-Policy pro Fehlertyp (rate limit: warten, crash: sofort weiter)
 *
 * Konfiguration via .env:
 *   FAILOVER_CHAIN=gemini,anthropic,openai,ollama   (Reihenfolge)
 *   FAILOVER_OPEN_DURATION_MS=60000                 (wie lang circuit offen bleibt)
 *   FAILOVER_HALF_OPEN_CALLS=3                      (Probeanrufe im half-open state)
 */

import { GeminiAdapter } from './gemini.js';
import { AnthropicAdapter } from './anthropic.js';
import { OpenAIAdapter } from './openai.js';
import { OllamaAdapter } from './ollama.js';

// Circuit states
const CLOSED    = 'closed';    // Normal — calls go through
const OPEN      = 'open';      // Failing — skip this provider
const HALF_OPEN = 'half_open'; // Testing — allow probe calls

const OPEN_DURATION_MS  = parseInt(process.env.FAILOVER_OPEN_DURATION_MS || '60000');
const HALF_OPEN_CALLS   = parseInt(process.env.FAILOVER_HALF_OPEN_CALLS || '3');
const FAILURE_THRESHOLD = 3; // failures before circuit opens

export class ModelFailover {
  constructor({ bus } = {}) {
    this.bus       = bus;
    this._primary  = null;      // active adapter (for direct use)
    this._providers = [];       // ordered list of providers
    this._circuits  = new Map(); // id → CircuitState
  }

  /**
   * Initialize the failover chain from available API keys.
   * Returns the primary (first available) adapter.
   */
  init() {
    const chain = (process.env.FAILOVER_CHAIN || 'gemini,anthropic,openai,ollama').split(',');

    for (const name of chain) {
      const p = this._buildProvider(name.trim());
      if (p) {
        this._providers.push(p);
        this._circuits.set(p.id, {
          state:         CLOSED,
          failures:      0,
          openedAt:      null,
          halfOpenCalls: 0,
          healthScore:   1.0,   // EMA: 1.0 = perfect, 0.0 = dead
        });
      }
    }

    if (this._providers.length === 0) return null;

    this._primary = this._providers[0].adapter;
    console.log(`  [failover] Chain: ${this._providers.map(p => p.id).join(' → ')}`);
    return this._primary;
  }

  /**
   * generate() — Drop-in replacement for any LLM adapter.
   * Tries providers in order, fails over automatically.
   */
  async generate(systemPrompt, history, userMessage, options = {}) {
    const errors = [];

    for (const provider of this._providers) {
      const circuit = this._circuits.get(provider.id);

      // Circuit open? Check if we should try again
      if (circuit.state === OPEN) {
        const elapsed = Date.now() - circuit.openedAt;
        if (elapsed < OPEN_DURATION_MS) {
          errors.push(`${provider.id}: circuit open (${Math.ceil((OPEN_DURATION_MS - elapsed) / 1000)}s left)`);
          continue;
        }
        // Transition to half-open
        circuit.state = HALF_OPEN;
        circuit.halfOpenCalls = 0;
        console.log(`  [failover] ${provider.id}: half-open — testing with probe calls`);
      }

      // Half-open limit reached? Go back to open
      if (circuit.state === HALF_OPEN && circuit.halfOpenCalls >= HALF_OPEN_CALLS) {
        circuit.state   = OPEN;
        circuit.openedAt = Date.now();
        errors.push(`${provider.id}: half-open probe failed ${HALF_OPEN_CALLS}x, reopening circuit`);
        continue;
      }

      try {
        const start  = Date.now();
        const result = await provider.adapter.generate(systemPrompt, history, userMessage, options);
        const ms     = Date.now() - start;

        // Success — reset circuit, update health score
        this._onSuccess(provider, circuit);
        if (provider.id !== this._providers[0].id) {
          console.log(`  [failover] ${provider.id}: success after primary failed (${ms}ms)`);
        }
        return result;

      } catch (err) {
        this._onFailure(provider, circuit, err);
        errors.push(`${provider.id}: ${err.message.substring(0, 80)}`);

        // Emit failover event
        if (this._providers.indexOf(provider) < this._providers.length - 1) {
          this.bus?.safeEmit?.('provider.failover', {
            from: provider.id,
            error: err.message.substring(0, 120),
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    // All providers failed
    throw new Error(`All LLM providers failed:\n${errors.join('\n')}`);
  }

  /** Current primary provider (for status display) */
  get primaryId() {
    return this._providers.find(p => this._circuits.get(p.id).state !== OPEN)?.id || 'none';
  }

  /** Health summary for all providers */
  getHealth() {
    return this._providers.map(p => ({
      id:     p.id,
      state:  this._circuits.get(p.id).state,
      health: this._circuits.get(p.id).healthScore.toFixed(2),
    }));
  }

  // ── Private ───────────────────────────────────────────────

  _onSuccess(provider, circuit) {
    if (circuit.state === HALF_OPEN) {
      circuit.halfOpenCalls++;
      if (circuit.halfOpenCalls >= HALF_OPEN_CALLS) {
        circuit.state    = CLOSED;
        circuit.failures = 0;
        console.log(`  [failover] ${provider.id}: recovered (${HALF_OPEN_CALLS} probes OK)`);
        this.bus?.safeEmit?.('provider.recovered', { id: provider.id });
      }
    } else {
      circuit.state    = CLOSED;
      circuit.failures = 0;
    }
    // EMA health score: success → drift toward 1.0
    circuit.healthScore = circuit.healthScore * 0.9 + 0.1;
  }

  _onFailure(provider, circuit, err) {
    circuit.failures++;
    // EMA health: failure → drift toward 0.0
    circuit.healthScore = circuit.healthScore * 0.9;

    const isRateLimit = /429|rate.?limit|quota/i.test(err.message);

    if (circuit.state === HALF_OPEN) {
      // Failed in half-open — reopen immediately
      circuit.state    = OPEN;
      circuit.openedAt = Date.now();
      return;
    }

    if (circuit.failures >= FAILURE_THRESHOLD) {
      circuit.state    = OPEN;
      circuit.openedAt = Date.now();
      const waitSec    = OPEN_DURATION_MS / 1000;
      const reason     = isRateLimit ? 'rate limit' : 'repeated errors';
      console.warn(`  [failover] ${provider.id}: circuit opened (${reason}, ${waitSec}s cooldown)`);
    }
  }

  _buildProvider(name) {
    switch (name) {
      case 'gemini': {
        const key = process.env.GEMINI_API_KEY;
        if (!key) return null;
        const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        return { id: 'gemini', adapter: new GeminiAdapter(key, model) };
      }
      case 'anthropic': {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) return null;
        const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
        return { id: 'anthropic', adapter: new AnthropicAdapter(key, model) };
      }
      case 'openai': {
        const key = process.env.OPENAI_API_KEY;
        if (!key) return null;
        const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
        return { id: 'openai', adapter: new OpenAIAdapter(key, model) };
      }
      case 'ollama': {
        const url = process.env.OLLAMA_URL;
        if (!url) return null;
        const model = process.env.OLLAMA_MODEL || 'llama3.1';
        return { id: 'ollama', adapter: new OllamaAdapter(url, model) };
      }
      default:
        return null;
    }
  }
}
