import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EmbeddingGenerator } from '../src/embeddings.js';

describe('EmbeddingGenerator', () => {
  describe('TF-IDF fallback', () => {
    const gen = new EmbeddingGenerator({}); // No API keys → TF-IDF

    it('uses tfidf mode without API keys', () => {
      assert.equal(gen.mode, 'tfidf');
      assert.equal(gen.dimensions, 256);
    });

    it('generates a 256-dim vector', async () => {
      const vec = await gen.embed('Hello world');
      assert.ok(vec instanceof Float32Array);
      assert.equal(vec.length, 256);
    });

    it('returns normalized vectors', async () => {
      const vec = await gen.embed('The quick brown fox jumps over the lazy dog');
      let mag = 0;
      for (let i = 0; i < vec.length; i++) mag += vec[i] * vec[i];
      assert.ok(Math.abs(Math.sqrt(mag) - 1) < 0.01);
    });

    it('returns null for empty text', async () => {
      const vec = await gen.embed('');
      assert.equal(vec, null);
    });

    it('similar texts have higher similarity than different texts', async () => {
      const { cosineSimilarity } = await import('../src/memory-db.js');
      const a = await gen.embed('artificial intelligence and machine learning');
      const b = await gen.embed('AI and deep learning algorithms');
      const c = await gen.embed('chocolate cake recipe with vanilla frosting');
      const simAB = cosineSimilarity(a, b);
      const simAC = cosineSimilarity(a, c);
      assert.ok(simAB > simAC, `Expected ${simAB} > ${simAC}`);
    });

    it('batch embed returns array', async () => {
      const results = await gen.embedBatch(['Hello', 'World']);
      assert.equal(results.length, 2);
      assert.ok(results[0] instanceof Float32Array);
    });
  });

  describe('mode selection', () => {
    it('selects openai when key provided', () => {
      const gen = new EmbeddingGenerator({ openaiKey: 'sk-test' });
      assert.equal(gen.mode, 'openai');
      assert.equal(gen.dimensions, 1536);
    });

    it('selects gemini when only gemini key', () => {
      const gen = new EmbeddingGenerator({ geminiKey: 'gemini-test' });
      assert.equal(gen.mode, 'gemini');
      assert.equal(gen.dimensions, 768);
    });

    it('prefers openai over gemini', () => {
      const gen = new EmbeddingGenerator({ openaiKey: 'sk-test', geminiKey: 'gemini-test' });
      assert.equal(gen.mode, 'openai');
    });
  });
});
