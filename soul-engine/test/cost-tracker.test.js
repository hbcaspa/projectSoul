/**
 * Tests for CostTracker — LLM token usage monitoring.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CostTracker } from '../src/cost-tracker.js';

// ── Direct recording ────────────────────────────────────

describe('CostTracker — record()', () => {
  let tmpDir, tracker;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-cost-'));
    tracker = new CostTracker(tmpDir);
  });

  it('records token usage by category', () => {
    tracker.record('conversation', 100, 50);
    const today = tracker.getToday();

    assert.equal(today.categories.conversation.input, 100);
    assert.equal(today.categories.conversation.output, 50);
    assert.equal(today.categories.conversation.calls, 1);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accumulates multiple calls', () => {
    tracker.record('conversation', 100, 50);
    tracker.record('conversation', 200, 80);
    const today = tracker.getToday();

    assert.equal(today.categories.conversation.input, 300);
    assert.equal(today.categories.conversation.output, 130);
    assert.equal(today.categories.conversation.calls, 2);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks different categories separately', () => {
    tracker.record('conversation', 100, 50);
    tracker.record('heartbeat', 200, 80);
    tracker.record('impulse', 50, 30);
    const today = tracker.getToday();

    assert.equal(today.categories.conversation.calls, 1);
    assert.equal(today.categories.heartbeat.calls, 1);
    assert.equal(today.categories.impulse.calls, 1);
    assert.equal(today.total.calls, 3);
    assert.equal(today.total.input, 350);
    assert.equal(today.total.output, 160);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists to .soul-cost.json on flush()', () => {
    tracker.record('conversation', 100, 50);
    tracker.flush();

    assert.ok(existsSync(join(tmpDir, '.soul-cost.json')));

    const data = JSON.parse(readFileSync(join(tmpDir, '.soul-cost.json'), 'utf-8'));
    const today = new Date().toISOString().split('T')[0];
    assert.ok(data.days[today]);
    assert.equal(data.days[today].conversation.input, 100);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads persisted data on init', () => {
    tracker.record('conversation', 100, 50);
    tracker.flush();

    // New tracker reads from disk
    const tracker2 = new CostTracker(tmpDir);
    const today = tracker2.getToday();
    assert.equal(today.categories.conversation.input, 100);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Summary ─────────────────────────────────────────────

describe('CostTracker — getSummary()', () => {
  it('returns summary for available days', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-cost-summary-'));
    const tracker = new CostTracker(tmpDir);

    tracker.record('conversation', 100, 50);
    tracker.record('heartbeat', 200, 80);

    const summary = tracker.getSummary(7);
    assert.ok(Object.keys(summary.days).length >= 1);
    assert.equal(summary.total.input, 300);
    assert.equal(summary.total.output, 130);
    assert.equal(summary.total.calls, 2);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Proxy wrapper ───────────────────────────────────────

describe('CostTracker — wrap()', () => {
  it('wraps LLM adapter and tracks calls', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-cost-wrap-'));
    const tracker = new CostTracker(tmpDir);

    // Fake LLM adapter
    const fakeLLM = {
      modelName: 'test-model',
      generate: async (system, history, message) => {
        return 'Hello! This is a test response from the model.';
      },
    };

    const wrapped = tracker.wrap(fakeLLM, 'conversation');

    // Should still work like the original
    assert.equal(wrapped.modelName, 'test-model');

    const result = await wrapped.generate('System prompt', [], 'Hello');
    assert.equal(result, 'Hello! This is a test response from the model.');

    // Should have tracked the call
    const today = tracker.getToday();
    assert.equal(today.categories.conversation.calls, 1);
    assert.ok(today.categories.conversation.input > 0);
    assert.ok(today.categories.conversation.output > 0);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('preserves other adapter properties', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-cost-wrap2-'));
    const tracker = new CostTracker(tmpDir);

    const fakeLLM = {
      modelName: 'gpt-4o',
      apiKey: 'test-key',
      generate: async () => 'ok',
    };

    const wrapped = tracker.wrap(fakeLLM, 'heartbeat');
    assert.equal(wrapped.modelName, 'gpt-4o');
    assert.equal(wrapped.apiKey, 'test-key');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('estimates tokens from char count', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-cost-wrap3-'));
    const tracker = new CostTracker(tmpDir);

    const fakeLLM = {
      generate: async () => 'x'.repeat(400), // 400 chars = ~100 tokens
    };

    const wrapped = tracker.wrap(fakeLLM, 'reflection');
    await wrapped.generate('a'.repeat(800), [], 'b'.repeat(200)); // 1000 chars input = ~250 tokens

    const today = tracker.getToday();
    assert.equal(today.categories.reflection.input, 250); // ceil(1000/4)
    assert.equal(today.categories.reflection.output, 100); // ceil(400/4)

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Budget alert ────────────────────────────────────────

describe('CostTracker — budget alert', () => {
  it('emits cost.budget-exceeded when over daily budget', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-cost-budget-'));

    // Simple mock bus
    const events = [];
    const mockBus = {
      safeEmit: (name, payload) => events.push({ name, payload }),
    };

    const tracker = new CostTracker(tmpDir, { bus: mockBus, budgetPerDay: 100 });

    // Under budget
    tracker.record('conversation', 40, 20);
    assert.equal(events.length, 0);

    // Over budget (total = 40+20+30+20 = 110)
    tracker.record('heartbeat', 30, 20);
    assert.equal(events.length, 1);
    assert.equal(events[0].name, 'cost.budget-exceeded');
    assert.equal(events[0].payload.total, 110);
    assert.equal(events[0].payload.budget, 100);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Empty state ─────────────────────────────────────────

describe('CostTracker — empty state', () => {
  it('returns zeros when no calls recorded', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-cost-empty-'));
    const tracker = new CostTracker(tmpDir);
    const today = tracker.getToday();

    assert.equal(today.total.input, 0);
    assert.equal(today.total.output, 0);
    assert.equal(today.total.calls, 0);
    assert.deepEqual(today.categories, {});

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
