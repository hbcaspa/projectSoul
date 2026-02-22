import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { AgentRunner } from '../src/agent-runner.js';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Minimal mock engine
function createMockEngine(soulPath) {
  return {
    soulPath,
    context: {
      load: async () => {},
      language: 'de',
    },
    consolidator: {
      consolidateDeep: async () => {},
    },
    runHeartbeat: async () => {},
  };
}

// Minimal mock bus
function createMockBus() {
  const events = [];
  return {
    safeEmit: (type, payload) => events.push({ type, ...payload }),
    getEvents: () => events,
    on: () => {},
  };
}

describe('AgentRunner', () => {
  let tmpDir, engine, bus, runner;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-runner-'));
    mkdirSync(join(tmpDir, 'heartbeat'), { recursive: true });
    writeFileSync(join(tmpDir, 'heartbeat', '2026-02-20.md'), '# Test');
    bus = createMockBus();
    engine = createMockEngine(tmpDir);
    runner = new AgentRunner({ engine, bus });
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('starts a session and creates .session-active', async () => {
    await runner.startSession();
    assert.ok(existsSync(join(tmpDir, '.session-active')));
    assert.ok(runner.sessionActive);
  });

  it('emits session.started event', () => {
    const events = bus.getEvents();
    assert.ok(events.some(e => e.type === 'session.started'));
  });

  it('ends a session and removes .session-active', async () => {
    await runner.endSession();
    assert.ok(!existsSync(join(tmpDir, '.session-active')));
    assert.ok(!runner.sessionActive);
  });

  it('emits session.ended event', () => {
    const events = bus.getEvents();
    assert.ok(events.some(e => e.type === 'session.ended'));
  });

  it('creates state log on end', () => {
    assert.ok(existsSync(join(tmpDir, 'zustandslog')));
  });

  it('creates memory note on end', () => {
    assert.ok(existsSync(join(tmpDir, 'memory')));
  });

  it('detects session number from heartbeat files', async () => {
    const num = await runner._detectSessionNumber();
    assert.ok(num >= 1);
  });

  it('warns if previous session was not ended', async () => {
    writeFileSync(join(tmpDir, '.session-active'), 'session:99\nstart:2026-02-22T00:00:00Z\n');
    await runner.startSession();
    const events = bus.getEvents();
    assert.ok(events.some(e => e.type === 'session.guard_warning'));
    await runner.endSession();
  });

  it('endSession is idempotent when not active', async () => {
    await runner.endSession(); // Should not throw
    assert.ok(true);
  });
});
