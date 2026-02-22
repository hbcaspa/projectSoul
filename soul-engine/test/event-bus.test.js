/**
 * Tests for SoulEventBus — the reactive nervous system.
 *
 * Uses the REAL SoulEventBus (not the mock) since this IS the bus test.
 * Temp directories are used for cross-process and mood file tests.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, join } from 'path';
import { SoulEventBus } from '../src/event-bus.js';

describe('SoulEventBus', () => {
  let bus;

  beforeEach(() => {
    bus = new SoulEventBus();
  });

  describe('safeEmit basics', () => {
    it('increments eventCount on each emit', () => {
      assert.equal(bus.totalEvents, 0);
      bus.safeEmit('test.event', { source: 'test' });
      assert.equal(bus.totalEvents, 1);
      bus.safeEmit('test.event', { source: 'test' });
      assert.equal(bus.totalEvents, 2);
    });

    it('adds events to eventLog', () => {
      bus.safeEmit('test.first', { source: 'test' });
      bus.safeEmit('test.second', { source: 'test', data: 'hello' });

      assert.equal(bus.eventLog.length, 2);
      assert.equal(bus.eventLog[0].type, 'test.first');
      assert.equal(bus.eventLog[1].type, 'test.second');
      assert.equal(bus.eventLog[1].data, 'hello');
    });

    it('assigns incremental ids and timestamps', () => {
      bus.safeEmit('a', {});
      bus.safeEmit('b', {});

      assert.equal(bus.eventLog[0].id, 1);
      assert.equal(bus.eventLog[1].id, 2);
      assert.ok(typeof bus.eventLog[0].ts === 'number');
      assert.ok(bus.eventLog[0].ts <= bus.eventLog[1].ts);
    });

    it('trims eventLog beyond MAX_LOG (200)', () => {
      for (let i = 0; i < 210; i++) {
        bus.safeEmit('bulk.event', { source: 'test' });
      }
      assert.equal(bus.totalEvents, 210);
      // eventLog trimmed to last 200
      assert.ok(bus.eventLog.length <= 200);
      // First event in log should be id 11 (210 - 200 + 1)
      assert.equal(bus.eventLog[0].id, 11);
    });
  });

  describe('error isolation', () => {
    it('does not crash when a sync handler throws', () => {
      bus.on('crash.test', () => {
        throw new Error('Handler exploded');
      });

      // Should not throw
      bus.safeEmit('crash.test', { source: 'test' });
      assert.equal(bus.totalEvents, 1);
      assert.equal(bus.handlerErrors.length, 1);
      assert.match(bus.handlerErrors[0].error, /Handler exploded/);
    });

    it('calls remaining handlers after one throws', () => {
      let called = false;

      bus.on('multi.test', () => {
        throw new Error('First handler dies');
      });
      bus.on('multi.test', () => {
        called = true;
      });

      bus.safeEmit('multi.test', { source: 'test' });
      assert.ok(called, 'Second handler should have been called');
    });

    it('catches async handler rejections', async () => {
      bus.on('async.test', async () => {
        throw new Error('Async boom');
      });

      bus.safeEmit('async.test', { source: 'test' });

      // Give the async rejection a tick to be caught
      await new Promise((r) => setTimeout(r, 50));

      assert.equal(bus.handlerErrors.length, 1);
      assert.match(bus.handlerErrors[0].error, /Async boom/);
    });

    it('trims handlerErrors beyond MAX_ERRORS (50)', () => {
      bus.on('err.flood', () => {
        throw new Error('boom');
      });

      for (let i = 0; i < 60; i++) {
        bus.safeEmit('err.flood', { source: 'test' });
      }

      assert.ok(bus.handlerErrors.length <= 50);
    });
  });

  describe('getRecentEvents', () => {
    it('returns the last N events', () => {
      for (let i = 0; i < 30; i++) {
        bus.safeEmit('numbered', { source: 'test', n: i });
      }

      const recent = bus.getRecentEvents(5);
      assert.equal(recent.length, 5);
      assert.equal(recent[0].n, 25);
      assert.equal(recent[4].n, 29);
    });

    it('returns all events if fewer than N exist', () => {
      bus.safeEmit('one', { source: 'test' });
      bus.safeEmit('two', { source: 'test' });

      const recent = bus.getRecentEvents(10);
      assert.equal(recent.length, 2);
    });

    it('defaults to 20 events', () => {
      for (let i = 0; i < 25; i++) {
        bus.safeEmit('x', { source: 'test' });
      }
      assert.equal(bus.getRecentEvents().length, 20);
    });
  });

  describe('getErrors', () => {
    it('returns a copy of handlerErrors', () => {
      bus.on('e', () => { throw new Error('test'); });
      bus.safeEmit('e', { source: 'test' });

      const errors = bus.getErrors();
      assert.equal(errors.length, 1);
      // Verify it is a copy
      errors.push({ fake: true });
      assert.equal(bus.handlerErrors.length, 1);
    });
  });

  describe('cross-process JSONL', () => {
    let tmpDir;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'bus-test-'));
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('writes events to .soul-events/current.jsonl when soulPath is set', async () => {
      const busWithPath = new SoulEventBus({ soulPath: tmpDir });
      busWithPath.safeEmit('test.cross', { source: 'test-channel' });

      // Wait for async write
      await new Promise((r) => setTimeout(r, 200));

      const jsonlPath = resolve(tmpDir, '.soul-events', 'current.jsonl');
      assert.ok(existsSync(jsonlPath), 'JSONL file should exist');

      const content = await readFile(jsonlPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      assert.ok(lines.length >= 1);

      const parsed = JSON.parse(lines[lines.length - 1]);
      assert.equal(parsed.type, 'test.cross');
      assert.equal(parsed.source, 'test-channel');
    });

    it('skips JSONL write for SKIP_CROSS_PROCESS events', async () => {
      const dir2 = await mkdtemp(join(tmpdir(), 'bus-skip-'));
      try {
        const busWithPath = new SoulEventBus({ soulPath: dir2 });

        // These should be skipped
        busWithPath.safeEmit('pulse.written', { source: 'test' });
        busWithPath.safeEmit('impulse.tick', { source: 'test' });

        await new Promise((r) => setTimeout(r, 200));

        const jsonlPath = resolve(dir2, '.soul-events', 'current.jsonl');
        // Either file doesn't exist or it's empty
        if (existsSync(jsonlPath)) {
          const content = await readFile(jsonlPath, 'utf-8');
          assert.equal(content.trim(), '', 'JSONL should be empty for skipped events');
        }
      } finally {
        await rm(dir2, { recursive: true, force: true });
      }
    });
  });

  describe('mood file', () => {
    let tmpDir;

    before(async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'bus-mood-'));
    });

    after(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    it('writes .soul-mood on mood.changed event', async () => {
      const busWithPath = new SoulEventBus({ soulPath: tmpDir });
      busWithPath.safeEmit('mood.changed', {
        source: 'impulse-state',
        mood: { valence: 0.5, energy: 0.7, label: 'begeistert' },
        trigger: 'user_response',
      });

      // Wait for async write
      await new Promise((r) => setTimeout(r, 200));

      const moodPath = resolve(tmpDir, '.soul-mood');
      assert.ok(existsSync(moodPath), '.soul-mood file should exist');

      const data = JSON.parse(await readFile(moodPath, 'utf-8'));
      assert.equal(data.valence, 0.5);
      assert.equal(data.energy, 0.7);
      assert.equal(data.label, 'begeistert');
      assert.equal(data.trigger, 'user_response');
      assert.ok(data.since, 'should have a since timestamp');
    });

    it('does not write .soul-mood for other events', async () => {
      const dir2 = await mkdtemp(join(tmpdir(), 'bus-nomood-'));
      try {
        const busWithPath = new SoulEventBus({ soulPath: dir2 });
        busWithPath.safeEmit('message.received', { source: 'test' });

        await new Promise((r) => setTimeout(r, 100));

        const moodPath = resolve(dir2, '.soul-mood');
        assert.ok(!existsSync(moodPath), '.soul-mood should not be created for non-mood events');
      } finally {
        await rm(dir2, { recursive: true, force: true });
      }
    });
  });
});
