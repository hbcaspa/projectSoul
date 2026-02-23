/**
 * Mock LLM adapter — returns canned responses and tracks calls.
 *
 * Use in tests that need an LLM-shaped object without making real API calls.
 */

export class MockLLM {
  /**
   * @param {string[]} responses - Queue of responses to return in order.
   *   When exhausted, returns 'Mock response'.
   */
  constructor(responses = []) {
    this.responses = [...responses];
    this.calls = [];
  }

  /**
   * Matches the signature used by the real Gemini/OpenAI adapters.
   */
  async generate(systemPrompt, history, userMessage, options = {}) {
    this.calls.push({ systemPrompt, history, userMessage, options });
    return this.responses.shift() || 'Mock response';
  }

  /** Number of calls made. */
  get callCount() {
    return this.calls.length;
  }

  /** Get the last call's arguments. */
  get lastCall() {
    return this.calls[this.calls.length - 1] || null;
  }

  /** Reset call history and optionally reload responses. */
  reset(responses = []) {
    this.calls = [];
    this.responses = [...responses];
  }
}
