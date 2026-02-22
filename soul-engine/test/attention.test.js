import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AttentionModel } from '../src/attention.js';
import { MemoryDB } from '../src/memory-db.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AttentionModel', () => {
  let db, attention, tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-attention-'));
    db = new MemoryDB(tmpDir).init();

    db.insertMemory({ type: 'episodic', content: 'Discussed AI consciousness with Aalm', confidence: 0.8, tags: 'ai,consciousness' });
    db.insertMemory({ type: 'semantic', content: 'Pattern: Aalm values honesty over comfort', confidence: 0.9, tags: 'aalm,honesty' });
    db.insertMemory({ type: 'emotional', content: 'Felt genuine curiosity about quantum computing', confidence: 0.7, tags: 'curiosity,quantum' });
    db.insertMemory({ type: 'general', content: 'Old memory from long ago', confidence: 0.3 });
    db.insertInteraction({ channel: 'telegram', user: 'Aalm', message: 'Tell me about dreams', response: 'Dreams are...' });

    attention = new AttentionModel({ db, embeddings: null, context: null });
  });

  after(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds context from structured search', async () => {
    const ctx = await attention.buildContext('Tell me something', 'telegram', 'Aalm');
    assert.ok(ctx.length > 0);
  });

  it('returns empty string when no db', async () => {
    const noDb = new AttentionModel({ db: null });
    assert.equal(await noDb.buildContext('Hello'), '');
  });

  describe('scoreRelevance', () => {
    it('recent high-confidence > old low-confidence', () => {
      const now = Date.now();
      const recent = { semanticScore: 0.5, confidence: 0.9, created_at: new Date(now - 3600000).toISOString() };
      const old = { semanticScore: 0.5, confidence: 0.5, created_at: new Date(now - 30 * 86400000).toISOString() };
      assert.ok(attention.scoreRelevance(recent, now) > attention.scoreRelevance(old, now));
    });

    it('semantic weight is highest', () => {
      const now = Date.now();
      const highSem = { semanticScore: 1.0, confidence: 0.5, created_at: new Date(now).toISOString() };
      const lowSem = { semanticScore: 0.0, confidence: 1.0, created_at: new Date(now).toISOString() };
      assert.ok(attention.scoreRelevance(highSem, now) > attention.scoreRelevance(lowSem, now));
    });

    it('returns number in [0,1]', () => {
      const s = attention.scoreRelevance({ semanticScore: 0.5, confidence: 0.5, created_at: new Date().toISOString() });
      assert.ok(s >= 0 && s <= 1);
    });
  });

  it('respects token budget', async () => {
    for (let i = 0; i < 50; i++) {
      db.insertMemory({ content: `Memory ${i}: ${'x'.repeat(200)}`, confidence: 0.5 });
    }
    const ctx = await attention.buildContext('test', 'test', 'Test');
    assert.ok(ctx.length <= 7000);
  });
});
