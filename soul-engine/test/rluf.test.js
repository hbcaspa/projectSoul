import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackLearner } from '../src/rluf.js';
import { MemoryDB } from '../src/memory-db.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('FeedbackLearner', () => {
  let tmpDir, db, rluf;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-rluf-'));
    db = new MemoryDB(tmpDir).init();
    db.insertMemory({ content: 'Test memory', confidence: 0.5 });

    rluf = new FeedbackLearner({ soulPath: tmpDir, db, impulseState: null, bus: null });
  });

  after(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('onUserResponse', () => {
    it('positive reward for fast positive response', () => {
      rluf.lastImpulseType = 'reflection';
      const signal = rluf.onUserResponse('Danke, das war super!', 60000);
      assert.ok(signal.reward > 0);
      assert.ok(signal.components.latency > 0);
      assert.ok(signal.components.sentiment > 0);
    });

    it('negative reward for slow negative response', () => {
      rluf.lastImpulseType = 'world_check';
      const signal = rluf.onUserResponse('Nein, falsch.', 7200000);
      assert.ok(signal.reward < 0);
    });

    it('tracks impulse type', () => {
      rluf.lastImpulseType = 'dream';
      const signal = rluf.onUserResponse('Interesting!');
      assert.equal(signal.impulseType, 'dream');
    });

    it('resets lastImpulseType after processing', () => {
      rluf.lastImpulseType = 'test';
      rluf.onUserResponse('hello');
      assert.equal(rluf.lastImpulseType, null);
    });

    it('engagement bonus for long messages', () => {
      const signal = rluf.onUserResponse('x'.repeat(250));
      assert.ok(signal.components.engagement > 0);
    });

    it('continuation bonus for questions', () => {
      const signal = rluf.onUserResponse('What do you think?');
      assert.ok(signal.components.continuation > 0);
    });

    it('clamps reward to [-1, 1]', () => {
      const signal = rluf.onUserResponse('Danke danke super toll perfekt amazing!', 1000);
      assert.ok(signal.reward <= 1 && signal.reward >= -1);
    });
  });

  describe('impulse weights', () => {
    it('increases for positive feedback', () => {
      const r = new FeedbackLearner({ soulPath: tmpDir, db: null, bus: null });
      r.lastImpulseType = 'dream';
      r.onUserResponse('Toll! Super!');
      assert.ok(r.getImpulseWeights().dream > 1.0);
    });

    it('decreases for negative feedback', () => {
      const r = new FeedbackLearner({ soulPath: tmpDir, db: null, bus: null });
      r.lastImpulseType = 'boring';
      r.onUserResponse('Nein falsch schlecht', 7200000);
      assert.ok(r.getImpulseWeights().boring < 1.0);
    });

    it('stays within [0.1, 3.0]', () => {
      const r = new FeedbackLearner({ soulPath: tmpDir, db: null, bus: null });
      for (let i = 0; i < 100; i++) {
        r.lastImpulseType = 'popular';
        r.onUserResponse('Toll!');
      }
      assert.ok(r.impulseWeights.popular <= 3.0);
    });
  });

  it('persists state', () => {
    assert.ok(existsSync(join(tmpDir, '.soul-rluf-state')));
    const r2 = new FeedbackLearner({ soulPath: tmpDir, db: null, bus: null });
    assert.ok(r2.totalFeedback > 0);
  });

  it('getStats returns data', () => {
    const stats = rluf.getStats();
    assert.ok(typeof stats.totalFeedback === 'number');
    assert.ok(typeof stats.avgSessionReward === 'number');
  });
});
