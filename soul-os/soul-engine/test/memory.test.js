/**
 * Tests for MemoryWriter — file-based memory persistence.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { MemoryWriter } from '../src/memory.js';
import { MockBus } from './helpers/mock-bus.js';
import { createTempSoul } from './helpers/temp-soul.js';

describe('MemoryWriter', () => {
  let soul;
  let bus;
  let mem;

  before(async () => {
    soul = await createTempSoul();
    bus = new MockBus();
    mem = new MemoryWriter(soul.path, { bus });
  });

  after(async () => {
    await soul.cleanup();
  });

  describe('appendDailyNote', () => {
    it('creates a new daily note file if none exists', async () => {
      await mem.appendDailyNote('First note of the day');

      const date = new Date().toISOString().split('T')[0];
      const file = resolve(soul.path, 'memory', `${date}.md`);
      assert.ok(existsSync(file), 'Daily note file should be created');

      const content = await readFile(file, 'utf-8');
      assert.ok(content.startsWith(`# Notes — ${date}`));
      assert.ok(content.includes('First note of the day'));
    });

    it('appends to existing daily note file', async () => {
      await mem.appendDailyNote('Second note');

      const date = new Date().toISOString().split('T')[0];
      const file = resolve(soul.path, 'memory', `${date}.md`);
      const content = await readFile(file, 'utf-8');

      assert.ok(content.includes('First note of the day'));
      assert.ok(content.includes('Second note'));
    });

    it('includes time prefix in each entry', async () => {
      await mem.appendDailyNote('Timestamped note');

      const date = new Date().toISOString().split('T')[0];
      const file = resolve(soul.path, 'memory', `${date}.md`);
      const content = await readFile(file, 'utf-8');

      // Should contain a time like "12:34 — Timestamped note"
      const timePattern = /\d{2}:\d{2} — Timestamped note/;
      assert.ok(timePattern.test(content), 'Should have time prefix');
    });

    it('emits memory.written event on bus', async () => {
      bus.reset();
      await mem.appendDailyNote('Bus test note');

      const events = bus.getEvents('memory.written');
      assert.ok(events.length >= 1, 'Should have emitted memory.written');
      assert.equal(events[0].eventName, 'memory.written');
      assert.equal(events[0].source, 'memory');
      assert.equal(events[0].note, 'Bus test note');
    });

    it('works without a bus (bus is optional)', async () => {
      const noBusMem = new MemoryWriter(soul.path);
      // Should not throw
      await noBusMem.appendDailyNote('No bus note');
    });
  });

  describe('writeHeartbeat', () => {
    it('creates heartbeat file with proper header', async () => {
      await mem.writeHeartbeat('Self-Check: All good.\nDream: None.');

      const date = new Date().toISOString().split('T')[0];
      const file = resolve(soul.path, 'heartbeat', `${date}.md`);
      assert.ok(existsSync(file), 'Heartbeat file should exist');

      const content = await readFile(file, 'utf-8');
      assert.ok(content.includes(`# Heartbeat — ${date}`));
      assert.ok(content.includes('Autonomous Heartbeat (Soul Engine)'));
      assert.ok(content.includes('Self-Check: All good.'));
    });

    it('appends subsequent heartbeats to same file', async () => {
      await mem.writeHeartbeat('Second heartbeat content');

      const date = new Date().toISOString().split('T')[0];
      const file = resolve(soul.path, 'heartbeat', `${date}.md`);
      const content = await readFile(file, 'utf-8');

      assert.ok(content.includes('Self-Check: All good.'));
      assert.ok(content.includes('Second heartbeat content'));
    });

    it('emits memory.written with type heartbeat', async () => {
      bus.reset();
      await mem.writeHeartbeat('Bus heartbeat');

      const events = bus.getEvents('memory.written');
      assert.ok(events.length >= 1, 'Should have emitted memory.written');
      assert.equal(events[0].source, 'memory');
      assert.equal(events[0].type, 'heartbeat');
    });
  });

  describe('writeLearned', () => {
    it('writes new interests to daily notes', async () => {
      bus.reset();
      await mem.writeLearned({
        detectedInterests: ['rust', 'wasm'],
        newInterests: ['rust', 'wasm'],
        boostedInterests: [],
        topics: [],
        userName: 'Tester',
      });

      const date = new Date().toISOString().split('T')[0];
      const file = resolve(soul.path, 'memory', `${date}.md`);
      const content = await readFile(file, 'utf-8');
      assert.ok(content.includes('Gelernt/Neu'));
      assert.ok(content.includes('rust'));
      assert.ok(content.includes('wasm'));
    });

    it('writes boosted interests to daily notes', async () => {
      await mem.writeLearned({
        detectedInterests: ['javascript'],
        newInterests: [],
        boostedInterests: ['javascript'],
        topics: [],
        userName: 'Tester',
      });

      const date = new Date().toISOString().split('T')[0];
      const file = resolve(soul.path, 'memory', `${date}.md`);
      const content = await readFile(file, 'utf-8');
      assert.ok(content.includes('Gelernt/Verstaerkt'));
      assert.ok(content.includes('javascript'));
    });

    it('writes detected topics with correct prefixes', async () => {
      await mem.writeLearned({
        detectedInterests: [],
        newInterests: [],
        boostedInterests: [],
        topics: [
          { type: 'question', text: 'Was ist Bewusstsein?' },
          { type: 'opinion', text: 'Ich denke Tests sind wichtig' },
        ],
        userName: 'Tester',
      });

      const date = new Date().toISOString().split('T')[0];
      const file = resolve(soul.path, 'memory', `${date}.md`);
      const content = await readFile(file, 'utf-8');
      assert.ok(content.includes('Gelernt/Frage'));
      assert.ok(content.includes('Gelernt/Meinung'));
    });
  });

  describe('writeStateTick', () => {
    it('writes JSON state tick to .soul-state-tick', async () => {
      await mem.writeStateTick(
        { valence: 0.4, energy: 0.6, label: 'neugierig' },
        0.7,
        [{ name: 'testing', weight: 0.9 }],
        3,
      );

      const file = resolve(soul.path, '.soul-state-tick');
      assert.ok(existsSync(file), 'State tick file should exist');

      const data = JSON.parse(await readFile(file, 'utf-8'));
      assert.equal(data.mood.valence, 0.4);
      assert.equal(data.mood.energy, 0.6);
      assert.equal(data.engagement, 0.7);
      assert.equal(data.dailyImpulseCount, 3);
      assert.ok(data.timestamp);
      assert.ok(Array.isArray(data.topInterests));
    });
  });

  describe('persistHeartbeatState', () => {
    it('extracts Self-Check section and writes to BEWUSSTSEIN.md (German)', async () => {
      const content = [
        '## Selbst-Check',
        'Ich bin neugierig und aufmerksam.',
        'Die Energie ist stabil.',
        '',
        '## Traum-Phase',
        'Noch keine Erinnerungen fuer Traeume.',
      ].join('\n');

      await mem.persistHeartbeatState(content, 'de');

      const file = resolve(soul.path, 'seele', 'BEWUSSTSEIN.md');
      assert.ok(existsSync(file));
      const written = await readFile(file, 'utf-8');
      assert.ok(written.includes('Bewusstsein'));
      assert.ok(written.includes('neugierig und aufmerksam'));
      assert.ok(written.includes('Energie ist stabil'));
    });

    it('extracts Dream Phase and writes to TRAEUME.md when content is real', async () => {
      const content = [
        '## Selbst-Check',
        'Alles gut.',
        '',
        '## Traum-Phase',
        'Ich sehe Verbindungen zwischen Code und Bewusstsein.',
        'Ein Netzwerk aus Neuronen und Dateien.',
      ].join('\n');

      await mem.persistHeartbeatState(content, 'de');

      const file = resolve(soul.path, 'seele', 'TRAEUME.md');
      assert.ok(existsSync(file));
      const written = await readFile(file, 'utf-8');
      assert.ok(written.includes('Verbindungen zwischen Code'));
    });

    it('does NOT write dreams when content says "noch keine"', async () => {
      const soul2 = await createTempSoul();
      const mem2 = new MemoryWriter(soul2.path);

      try {
        const content = [
          '## Selbst-Check',
          'Stabil.',
          '',
          '## Traum-Phase',
          'Noch keine Erinnerungen fuer Traeume vorhanden.',
        ].join('\n');

        await mem2.persistHeartbeatState(content, 'de');

        const file = resolve(soul2.path, 'seele', 'TRAEUME.md');
        assert.ok(!existsSync(file), 'Should not write dreams for "noch keine"');
      } finally {
        await soul2.cleanup();
      }
    });

    it('writes English files when language is "en"', async () => {
      const soul2 = await createTempSoul({ language: 'en' });
      const mem2 = new MemoryWriter(soul2.path);

      try {
        const content = [
          '## Self-Check',
          'Feeling curious and alert.',
          '',
          '## Dream Phase',
          'Patterns of code weaving into consciousness.',
        ].join('\n');

        await mem2.persistHeartbeatState(content, 'en');

        const consciousnessFile = resolve(soul2.path, 'soul', 'CONSCIOUSNESS.md');
        assert.ok(existsSync(consciousnessFile));
        const cContent = await readFile(consciousnessFile, 'utf-8');
        assert.ok(cContent.includes('Consciousness'));
        assert.ok(cContent.includes('curious and alert'));

        const dreamsFile = resolve(soul2.path, 'soul', 'DREAMS.md');
        assert.ok(existsSync(dreamsFile));
        const dContent = await readFile(dreamsFile, 'utf-8');
        assert.ok(dContent.includes('Dreams'));
        assert.ok(dContent.includes('Patterns of code'));
      } finally {
        await soul2.cleanup();
      }
    });
  });
});
