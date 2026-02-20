import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiAdapter {
  constructor(apiKey, model = 'gemini-2.0-flash') {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = model;
  }

  /**
   * Generate a response from the LLM.
   *
   * @param {string} systemPrompt  - The soul's system instruction
   * @param {Array}  history       - Previous messages [{role, content}]
   * @param {string} userMessage   - The new user message
   * @returns {string} The model's response text
   */
  async generate(systemPrompt, history = [], userMessage) {
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      systemInstruction: systemPrompt,
    });

    // Convert to Gemini format
    const geminiHistory = history.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }));

    const chat = model.startChat({ history: geminiHistory });

    try {
      const result = await chat.sendMessage(userMessage);
      return result.response.text();
    } catch (err) {
      console.error(`  [gemini] Error: ${err.message}`);
      throw err;
    }
  }
}
