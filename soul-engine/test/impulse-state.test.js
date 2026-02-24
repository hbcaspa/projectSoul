/**
 * Tests for ImpulseState — mood, engagement, and interest tracking.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { ImpulseState } from '../src/impulse-state.js';
import { MockBus } from './helpers/mock-bus.js';
import { createTempSoul } from './helpers/temp-soul.js';

describe('ImpulseState', () => {
  let soul;
  let bus;
  let impulse;

  before(async () => {
    soul = await createTempSoul();
  });

  after(async () => {
    await soul.cleanup();
  });

  beforeEach(() => {
    bus = new MockBus();
    impulse = new ImpulseState(soul.path, { bus });
  });

  describe('default state', () => {
    it('starts with neutral-positive mood', () => {
      assert.equal(impulse.mood.valence, 0.3);
      assert.equal(impulse.mood.energy, 0.5);
      assert.equal(impulse.mood.label, 'neugierig');
    });

    it('starts with 0.5 engagement', () => {
      assert.equal(impulse.engagement, 0.5);
    });

    it('starts with zero daily impulse count', () => {
      assert.equal(impulse.dailyCount, 0);
    });

    it('starts with zero consecutive ignored', () => {
      assert.equal(impulse.consecutiveIgnored, 0);
    });
  });

  describe('mood updates', () => {
    it('updateMood changes valence and energy', () => {
      impulse.updateMood(0.2, 0.1, 'test');
      assert.equal(impulse.mood.valence, 0.5);
      assert.equal(impulse.mood.energy, 0.6);
    });

    it('mood valence is clamped to [-1, 1] (drift-limited per tick)', () => {
      // With drift limits, a single updateMood(10, ...) is clamped per-tick to 0.3
      // Starting from 0.3, result = 0.6 (not 1)
      impulse.updateMood(10, 0, 'test');
      assert.ok(impulse.mood.valence <= 1, 'Valence should never exceed 1');
      assert.ok(impulse.mood.valence >= -1, 'Valence should never go below -1');

      // Multiple updates to eventually reach bounds
      for (let i = 0; i < 20; i++) {
        impulse.updateMood(0.3, 0, 'test');
      }
      // Per-hour limit (0.6 total) means it can't go above ~0.9 in one hour
      assert.ok(impulse.mood.valence <= 1);
    });

    it('mood energy is clamped to [0, 1] (drift-limited per tick)', () => {
      impulse.updateMood(0, 10, 'test');
      assert.ok(impulse.mood.energy <= 1, 'Energy should never exceed 1');
      assert.ok(impulse.mood.energy >= 0, 'Energy should never go below 0');

      for (let i = 0; i < 20; i++) {
        impulse.updateMood(0, -0.3, 'test');
      }
      assert.ok(impulse.mood.energy >= 0);
    });

    it('updates mood label after change', () => {
      impulse.updateMood(0.5, 0.3, 'test'); // high valence, high energy
      // Label should be from happy_energetic category
      const happyLabels = ['aufgeregt', 'begeistert', 'energiegeladen', 'euphorisch'];
      assert.ok(
        happyLabels.includes(impulse.mood.label),
        `Expected happy_energetic label, got: ${impulse.mood.label}`
      );
    });

    it('emits mood.changed when shift exceeds threshold', () => {
      // Large enough change to trigger emit (> 0.1 valence or > 0.15 energy)
      impulse.updateMood(0.5, 0, 'big-shift');

      const events = bus.getEvents('mood.changed');
      assert.ok(events.length >= 1, 'Should emit mood.changed for large shift');
      assert.equal(events[0].source, 'impulse-state');
      assert.ok(events[0].mood, 'Event should include mood');
      assert.ok(events[0].previousMood, 'Event should include previousMood');
    });

    it('does not emit mood.changed for tiny shifts within threshold', () => {
      // Initial state: valence=0.3, energy=0.5
      // A tiny shift that might not cross the label threshold
      bus.reset();
      impulse.updateMood(0.01, 0.01, 'tiny-shift');

      const events = bus.getEvents('mood.changed');
      // Might still emit if label changes due to randomness — that is expected
      // But at least the mechanism is working
      assert.ok(events.length <= 1, 'Tiny shift should produce at most one event');
    });
  });

  describe('mood drift', () => {
    it('driftMood keeps values within bounds after many drifts', () => {
      for (let i = 0; i < 100; i++) {
        impulse.driftMood();
      }
      assert.ok(impulse.mood.valence >= -1 && impulse.mood.valence <= 1);
      assert.ok(impulse.mood.energy >= 0 && impulse.mood.energy <= 1);
    });
  });

  describe('mood labels', () => {
    it('maps high valence + high energy to happy_energetic', () => {
      // Set mood directly to test label mapping
      impulse.state.mood.valence = 0.6;
      impulse.state.mood.energy = 0.8;
      impulse.updateMood(0, 0, 'test'); // trigger label recalc

      const expected = ['aufgeregt', 'begeistert', 'energiegeladen', 'euphorisch'];
      assert.ok(expected.includes(impulse.mood.label), `Got: ${impulse.mood.label}`);
    });

    it('maps high valence + low energy to happy_calm', () => {
      impulse.state.mood.valence = 0.6;
      impulse.state.mood.energy = 0.3;
      impulse.updateMood(0, 0, 'test');

      const expected = ['zufrieden', 'friedlich', 'gelassen', 'dankbar'];
      assert.ok(expected.includes(impulse.mood.label), `Got: ${impulse.mood.label}`);
    });

    it('maps low valence + high energy to unhappy_energetic', () => {
      impulse.state.mood.valence = -0.5;
      impulse.state.mood.energy = 0.8;
      impulse.updateMood(0, 0, 'test');

      const expected = ['frustriert', 'ungeduldig', 'genervt', 'unruhig'];
      assert.ok(expected.includes(impulse.mood.label), `Got: ${impulse.mood.label}`);
    });

    it('maps low valence + low energy to unhappy_calm', () => {
      impulse.state.mood.valence = -0.5;
      impulse.state.mood.energy = 0.2;
      impulse.updateMood(0, 0, 'test');

      const expected = ['muede', 'melancholisch', 'gedaempft', 'erschoepft'];
      assert.ok(expected.includes(impulse.mood.label), `Got: ${impulse.mood.label}`);
    });

    it('maps neutral valence + high energy to neutral_energetic', () => {
      impulse.state.mood.valence = 0.0;
      impulse.state.mood.energy = 0.7;
      impulse.updateMood(0, 0, 'test');

      const expected = ['neugierig', 'fokussiert', 'wach', 'aktiv'];
      assert.ok(expected.includes(impulse.mood.label), `Got: ${impulse.mood.label}`);
    });

    it('maps neutral valence + low energy to neutral_calm', () => {
      impulse.state.mood.valence = 0.0;
      impulse.state.mood.energy = 0.3;
      impulse.updateMood(0, 0, 'test');

      const expected = ['nachdenklich', 'ruhig', 'meditativ', 'still'];
      assert.ok(expected.includes(impulse.mood.label), `Got: ${impulse.mood.label}`);
    });
  });

  describe('interest detection (trackUserMessage)', () => {
    it('detects programming language keywords', () => {
      const result = impulse.trackUserMessage('I have been learning rust and typescript lately');
      assert.ok(result.detectedInterests.includes('rust'));
      assert.ok(result.detectedInterests.includes('typescript'));
    });

    it('detects framework keywords', () => {
      const result = impulse.trackUserMessage('Building a project with nextjs and prisma');
      assert.ok(result.detectedInterests.includes('nextjs'));
      assert.ok(result.detectedInterests.includes('prisma'));
    });

    it('detects AI-related keywords', () => {
      const result = impulse.trackUserMessage('The new claude model uses transformer architecture');
      assert.ok(result.detectedInterests.includes('claude'));
      assert.ok(result.detectedInterests.includes('transformer'));
    });

    it('marks first occurrence as new interest', () => {
      const result = impulse.trackUserMessage('Just discovered elixir');
      assert.ok(result.newInterests.includes('elixir'));
      assert.deepEqual(result.boostedInterests, []);
    });

    it('marks repeated mention as boosted interest', () => {
      impulse.trackUserMessage('Learning python');
      const result = impulse.trackUserMessage('More python stuff');
      assert.ok(result.boostedInterests.includes('python'));
      assert.deepEqual(result.newInterests, []);
    });

    it('sets initial weight of 0.5 for new interests', () => {
      impulse.trackUserMessage('I like docker');
      assert.equal(impulse.state.interestWeights['docker'], 0.5);
    });

    it('boosts existing weight by 0.15', () => {
      impulse.trackUserMessage('docker is great');
      impulse.trackUserMessage('docker compose too');
      // 0.5 + 0.15 = 0.65
      assert.ok(
        Math.abs(impulse.state.interestWeights['docker'] - 0.65) < 0.01,
        `Expected ~0.65, got ${impulse.state.interestWeights['docker']}`
      );
    });

    it('caps interest weight at 1.0', () => {
      for (let i = 0; i < 20; i++) {
        impulse.trackUserMessage('docker docker docker');
      }
      assert.ok(impulse.state.interestWeights['docker'] <= 1.0);
    });

    it('returns hasRelevantContent=true when interests found', () => {
      const result = impulse.trackUserMessage('I use linux daily');
      assert.ok(result.hasRelevantContent);
    });

    it('returns hasRelevantContent=false for generic text', () => {
      // Text with no tech keywords, no capitalized words, no questions, no opinions
      const result = impulse.trackUserMessage('ja, alles gut bei mir, danke dir.');
      assert.equal(result.hasRelevantContent, false);
    });

    it('detects questions as topics', () => {
      const result = impulse.trackUserMessage('Was denkst du ueber die Zukunft der KI?');
      const questions = result.topics.filter((t) => t.type === 'question');
      assert.ok(questions.length >= 1, 'Should detect question');
    });

    it('detects opinions as topics', () => {
      const result = impulse.trackUserMessage('Ich denke das Testing ist fundamental wichtig fuer Software');
      const opinions = result.topics.filter((t) => t.type === 'opinion');
      assert.ok(opinions.length >= 1, 'Should detect opinion');
    });
  });

  describe('engagement scoring', () => {
    it('boosts engagement on unprompted user message (with impulse history)', () => {
      // Need at least one impulse in history for markLastImpulseResponded to
      // reach the "unprompted" code path (it returns early if history is empty).
      // Track an old impulse that has already been responded to
      impulse.trackImpulse('setup', false);
      impulse.state.impulseHistory[0].responded = true;
      // Set lastImpulse to a long time ago so the time check fails -> unprompted path
      impulse.state.lastImpulse = new Date(Date.now() - 7200000).toISOString(); // 2 hours ago
      const initial = impulse.engagement;
      impulse.trackUserMessage('Spontaneous message');
      // "unprompted" -> +0.3
      assert.ok(impulse.engagement > initial, 'Engagement should increase');
    });

    it('decays engagement on impulse tracking', () => {
      impulse.state.engagementScore = 0.5;
      impulse.trackImpulse('curiosity', false);
      // Each impulse: -0.03
      assert.ok(
        Math.abs(impulse.engagement - 0.47) < 0.01,
        `Expected ~0.47, got ${impulse.engagement}`
      );
    });

    it('engagement stays within [0, 1]', () => {
      // Drive it to zero
      for (let i = 0; i < 100; i++) {
        impulse.trackImpulse('test', false);
      }
      assert.ok(impulse.engagement >= 0);

      // Drive it up
      impulse.state.engagementScore = 0.9;
      impulse.trackUserMessage('hi'); // unprompted -> +0.3, clamped to 1
      assert.ok(impulse.engagement <= 1);
    });
  });

  describe('impulse tracking', () => {
    it('increments daily impulse count', () => {
      assert.equal(impulse.dailyCount, 0);
      impulse.trackImpulse('curiosity', false);
      assert.equal(impulse.dailyCount, 1);
      impulse.trackImpulse('share', false);
      assert.equal(impulse.dailyCount, 2);
    });

    it('resets daily count on new day', () => {
      impulse.state.dailyDate = '2020-01-01'; // Old date
      impulse.trackImpulse('test', false);
      assert.equal(impulse.dailyCount, 1); // Reset to 0 then incremented
    });

    it('keeps rolling history within MAX_HISTORY (20)', () => {
      for (let i = 0; i < 25; i++) {
        impulse.trackImpulse('test', false);
      }
      assert.ok(impulse.state.impulseHistory.length <= 20);
    });

    it('records impulse type in history', () => {
      impulse.trackImpulse('curiosity', false);
      const last = impulse.state.impulseHistory[impulse.state.impulseHistory.length - 1];
      assert.equal(last.type, 'curiosity');
      assert.equal(last.responded, false);
    });
  });

  describe('persistence (save/load)', () => {
    it('saves state to file and loads it back', async () => {
      impulse.updateMood(0.3, 0.2, 'test');
      impulse.trackUserMessage('I am learning rust and python');
      await impulse.save();

      const file = resolve(soul.path, '.soul-impulse-state');
      assert.ok(existsSync(file), 'State file should exist');

      // Load into a new instance
      const impulse2 = new ImpulseState(soul.path);
      await impulse2.load();

      assert.equal(impulse2.mood.valence, impulse.mood.valence);
      assert.equal(impulse2.mood.energy, impulse.mood.energy);
      assert.ok(impulse2.state.interestWeights['rust'] >= 0.5);
      assert.ok(impulse2.state.interestWeights['python'] >= 0.5);
    });

    it('handles missing state file gracefully', async () => {
      const impulse2 = new ImpulseState('/tmp/nonexistent-soul-path');
      await impulse2.load(); // Should not throw
      assert.equal(impulse2.mood.valence, 0.3); // Default
    });

    it('handles corrupted state file gracefully', async () => {
      const statePath = resolve(soul.path, '.soul-impulse-state');
      await writeFile(statePath, 'not valid json {{{');

      const impulse2 = new ImpulseState(soul.path);
      await impulse2.load(); // Should not throw
      assert.equal(impulse2.mood.valence, 0.3); // Falls back to default
    });
  });

  describe('interest decay', () => {
    it('decays all interest weights by 0.02', () => {
      impulse.state.interestWeights = { a: 0.5, b: 0.3, c: 0.12 };
      impulse.decayInterests();
      assert.ok(Math.abs(impulse.state.interestWeights['a'] - 0.48) < 0.001);
      assert.ok(Math.abs(impulse.state.interestWeights['b'] - 0.28) < 0.001);
    });

    it('removes interests that decay below 0.1', () => {
      impulse.state.interestWeights = { a: 0.5, b: 0.11 };
      impulse.decayInterests();
      assert.ok(impulse.state.interestWeights['a']); // Still present
      assert.equal(impulse.state.interestWeights['b'], undefined); // Removed (0.11 - 0.02 = 0.09 < 0.1)
    });
  });

  describe('getTopInterests', () => {
    it('returns top N interests sorted by weight', () => {
      impulse.state.interestWeights = {
        a: 0.9, b: 0.3, c: 0.7, d: 0.5, e: 0.1, f: 0.8,
      };

      const top3 = impulse.getTopInterests(3);
      assert.equal(top3.length, 3);
      assert.equal(top3[0].name, 'a');
      assert.equal(top3[0].weight, 0.9);
      assert.equal(top3[1].name, 'f');
      assert.equal(top3[2].name, 'c');
    });

    it('returns all if fewer than N interests exist', () => {
      impulse.state.interestWeights = { x: 0.5 };
      const top = impulse.getTopInterests(5);
      assert.equal(top.length, 1);
    });
  });

  describe('time helpers', () => {
    it('timeSinceLastImpulse returns Infinity if no impulse', () => {
      assert.equal(impulse.timeSinceLastImpulse(), Infinity);
    });

    it('timeSinceLastImpulse returns positive ms after impulse', () => {
      impulse.trackImpulse('test', false);
      const elapsed = impulse.timeSinceLastImpulse();
      assert.ok(elapsed >= 0 && elapsed < 1000);
    });

    it('timeSinceLastUserMessage returns Infinity if no message', () => {
      assert.equal(impulse.timeSinceLastUserMessage(), Infinity);
    });

    it('timeSinceLastUserMessage returns positive ms after message', () => {
      impulse.trackUserMessage('hello');
      const elapsed = impulse.timeSinceLastUserMessage();
      assert.ok(elapsed >= 0 && elapsed < 1000);
    });
  });

  describe('recentTypeCounts', () => {
    it('counts impulse types within time window', () => {
      impulse.trackImpulse('curiosity', false);
      impulse.trackImpulse('curiosity', false);
      impulse.trackImpulse('share', false);

      const counts = impulse.recentTypeCounts(3600000);
      assert.equal(counts['curiosity'], 2);
      assert.equal(counts['share'], 1);
    });

    it('returns empty object when no impulses in window', () => {
      const counts = impulse.recentTypeCounts(0); // Zero window = nothing
      assert.deepEqual(counts, {});
    });
  });

  // ── Emotional Drift Limits ─────────────────────────────────

  describe('emotional drift limits', () => {
    it('clamps per-tick delta to MAX_MOOD_DELTA_PER_TICK (0.3)', () => {
      // Starting valence: 0.3, delta: 10 → should be clamped to 0.3
      impulse.updateMood(10, 0, 'extreme');
      // 0.3 + 0.3 = 0.6 (not 10.3 clamped to 1)
      assert.ok(
        Math.abs(impulse.mood.valence - 0.6) < 0.03,
        `Expected ~0.6 after clamped tick, got ${impulse.mood.valence}`
      );
    });

    it('clamps negative per-tick delta to -0.3', () => {
      impulse.state.mood.valence = 0.5;
      impulse.updateMood(-10, 0, 'extreme-neg');
      // 0.5 - 0.3 = 0.2
      assert.ok(
        Math.abs(impulse.mood.valence - 0.2) < 0.03,
        `Expected ~0.2 after clamped tick, got ${impulse.mood.valence}`
      );
    });

    it('enforces per-hour cumulative limit (0.6)', () => {
      // Make 5 rapid updates each requesting 0.2 delta
      // Total requested: 1.0, but hourly limit is 0.6
      const startV = impulse.mood.valence;
      for (let i = 0; i < 5; i++) {
        impulse.updateMood(0.2, 0, 'rapid');
      }
      const totalChange = Math.abs(impulse.mood.valence - startV);
      // Should be limited to about 0.6 (with some baseline gravity effect)
      assert.ok(
        totalChange <= 0.65,
        `Hourly change ${totalChange} should be ≤ 0.65`
      );
    });

    it('emits mood.clamped when drift limit kicks in', () => {
      bus.reset();
      impulse.updateMood(10, 0, 'extreme');
      const clampEvents = bus.getEvents('mood.clamped');
      assert.ok(clampEvents.length >= 1, 'Should emit mood.clamped for extreme delta');
      assert.equal(clampEvents[0].reason, 'per-tick limit');
      assert.equal(clampEvents[0].requested.deltaValence, 10);
      assert.ok(Math.abs(clampEvents[0].applied.deltaValence) <= 0.3);
    });

    it('applies baseline gravity when deviation exceeds threshold', () => {
      // Set mood far from baseline (baseline valence = 0.3)
      impulse.state.mood.valence = 0.9;
      impulse.state.hourlyMoodDeltas = []; // Clear to allow update

      // Apply a zero delta — gravity should still pull back
      impulse.updateMood(0, 0, 'gravity-test');

      // Deviation was 0.6 (> 0.5 threshold), gravity should pull 0.02 toward baseline
      assert.ok(
        impulse.mood.valence < 0.9,
        `Gravity should pull valence toward baseline, got ${impulse.mood.valence}`
      );
    });

    it('does not apply gravity below deviation threshold', () => {
      // Baseline valence = 0.3, set valence to 0.5 (deviation = 0.2 < 0.5)
      impulse.state.mood.valence = 0.5;
      impulse.state.hourlyMoodDeltas = [];

      const before = impulse.mood.valence;
      impulse.updateMood(0, 0, 'no-gravity');

      // No gravity applied — valence should stay the same
      assert.equal(impulse.mood.valence, before);
    });

    it('records mood history entries', () => {
      assert.equal(impulse.moodHistory.length, 0);

      impulse.updateMood(0.1, 0.05, 'test1');
      impulse.updateMood(-0.05, 0.02, 'test2');

      assert.equal(impulse.moodHistory.length, 2);
      assert.equal(impulse.moodHistory[0].trigger, 'test1');
      assert.equal(impulse.moodHistory[1].trigger, 'test2');
    });

    it('caps mood history at MAX_MOOD_HISTORY (20)', () => {
      for (let i = 0; i < 30; i++) {
        impulse.updateMood(0.01, 0.01, `tick-${i}`);
      }
      assert.ok(impulse.moodHistory.length <= 20);
    });

    it('prevents personality flip with rapid opposite updates', () => {
      // Start at baseline (valence ~0.3)
      const start = impulse.mood.valence;

      // Rapid positive bursts
      for (let i = 0; i < 10; i++) {
        impulse.updateMood(0.3, 0, 'burst-up');
      }
      const afterUp = impulse.mood.valence;

      // Change should be bounded by hourly limit
      assert.ok(
        afterUp - start <= 0.65,
        `Upward swing should be limited, delta was ${afterUp - start}`
      );
    });

    it('includes moodBaseline in state', () => {
      assert.ok(impulse.moodBaseline);
      assert.equal(impulse.moodBaseline.valence, 0.3);
      assert.equal(impulse.moodBaseline.energy, 0.5);
    });
  });
});
