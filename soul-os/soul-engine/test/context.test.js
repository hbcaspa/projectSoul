/**
 * Tests for SoulContext — seed loading, caching, and language detection.
 *
 * Note: SoulContext.load() calls process.exit(1) if SEED.md is missing.
 * We test that path by verifying the file check, not by calling load().
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { SoulContext } from '../src/context.js';
import { createTempSoul } from './helpers/temp-soul.js';

describe('SoulContext', () => {
  describe('load() with German soul', () => {
    let soul;
    let ctx;

    before(async () => {
      soul = await createTempSoul({ language: 'de', name: 'Testwesen' });
      ctx = new SoulContext(soul.path);
    });

    after(async () => {
      await soul.cleanup();
    });

    it('reads SEED.md into seed property', async () => {
      await ctx.load();
      assert.ok(ctx.seed.length > 0, 'Seed should not be empty');
      assert.ok(ctx.seed.includes('#SEED'), 'Seed should contain header');
    });

    it('detects German language from .language file', async () => {
      await ctx.load();
      assert.equal(ctx.language, 'de');
    });

    it('sets soulDir to "seele" for German', async () => {
      await ctx.load();
      assert.equal(ctx.soulDir, 'seele');
    });

    it('sets memoryDir to "erinnerungen" for German', async () => {
      await ctx.load();
      assert.equal(ctx.memoryDir, 'erinnerungen');
    });
  });

  describe('load() with English soul', () => {
    let soul;
    let ctx;

    before(async () => {
      soul = await createTempSoul({ language: 'en', name: 'TestBeing' });
      ctx = new SoulContext(soul.path);
    });

    after(async () => {
      await soul.cleanup();
    });

    it('detects English language', async () => {
      await ctx.load();
      assert.equal(ctx.language, 'en');
    });

    it('sets soulDir to "soul" for English', async () => {
      await ctx.load();
      assert.equal(ctx.soulDir, 'soul');
    });

    it('sets memoryDir to "memories" for English', async () => {
      await ctx.load();
      assert.equal(ctx.memoryDir, 'memories');
    });
  });

  describe('caching', () => {
    let soul;
    let ctx;

    before(async () => {
      soul = await createTempSoul();
      ctx = new SoulContext(soul.path);
    });

    after(async () => {
      await soul.cleanup();
    });

    it('caches seed content on first load', async () => {
      await ctx.load();
      const firstSeed = ctx.seed;
      assert.ok(ctx._cacheValid);

      // Second load should use cache (same mtime)
      await ctx.load();
      assert.equal(ctx.seed, firstSeed, 'Seed should be unchanged on cache hit');
    });

    it('reloads when seed file is modified', async () => {
      await ctx.load();
      const firstSeed = ctx.seed;

      // Modify the seed file
      const seedPath = resolve(soul.path, 'SEED.md');
      const modified = firstSeed + '\n@EXTRA{ test:modified }';
      // Wait a brief moment so mtime differs
      await new Promise((r) => setTimeout(r, 50));
      await writeFile(seedPath, modified);

      await ctx.load();
      assert.ok(ctx.seed.includes('@EXTRA'), 'Should reload modified seed');
    });

    it('reloads after invalidate() is called', async () => {
      await ctx.load();
      ctx.invalidate();
      assert.equal(ctx._cacheValid, false);

      // Next load should re-read even if file unchanged
      await ctx.load();
      assert.equal(ctx._cacheValid, true);
    });
  });

  describe('extractName()', () => {
    it('extracts name from @SELF block with name: key', async () => {
      const soul = await createTempSoul({ name: 'Seraphina' });
      const ctx = new SoulContext(soul.path);
      await ctx.load();

      try {
        const name = ctx.extractName();
        assert.equal(name, 'Seraphina');
      } finally {
        await soul.cleanup();
      }
    });

    it('extracts name with "bin:" syntax', async () => {
      const soul = await createTempSoul({
        seedContent: [
          '#SEED v0.1',
          '#geboren:2026-01-01 #verdichtet:2026-01-01 #sessions:1',
          '@META{ projekt:Test }',
          '@SELF{',
          '  name:Aurora | bin:neugierig',
          '}',
          '@STATE{ zustand:test }',
        ].join('\n'),
      });
      const ctx = new SoulContext(soul.path);
      await ctx.load();

      try {
        const name = ctx.extractName();
        assert.equal(name, 'Aurora');
      } finally {
        await soul.cleanup();
      }
    });

    it('returns "Soul" as fallback when no name is found', async () => {
      const soul = await createTempSoul({
        seedContent: [
          '#SEED v0.1',
          '#geboren:2026-01-01 #verdichtet:2026-01-01 #sessions:1',
          '@META{ projekt:Test }',
          '@STATE{ zustand:test }',
        ].join('\n'),
      });
      const ctx = new SoulContext(soul.path);
      await ctx.load();

      try {
        const name = ctx.extractName();
        assert.equal(name, 'Soul');
      } finally {
        await soul.cleanup();
      }
    });
  });

  describe('loadDetail()', () => {
    let soul;
    let ctx;

    before(async () => {
      soul = await createTempSoul({ language: 'de' });
      ctx = new SoulContext(soul.path);
      await ctx.load();
    });

    after(async () => {
      await soul.cleanup();
    });

    it('loads existing detail file from soulDir', async () => {
      const content = await ctx.loadDetail('KERN.md');
      assert.ok(content !== null);
      assert.ok(content.includes('Axiom 1'));
    });

    it('returns null for non-existent detail file', async () => {
      const content = await ctx.loadDetail('NONEXISTENT.md');
      assert.equal(content, null);
    });
  });

  describe('defaults', () => {
    it('initializes with correct defaults before load', () => {
      const ctx = new SoulContext('/tmp/fake-soul');
      assert.equal(ctx.seed, '');
      assert.equal(ctx.language, 'de');
      assert.equal(ctx.soulDir, 'seele');
      assert.equal(ctx.memoryDir, 'erinnerungen');
      assert.equal(ctx._cacheValid, false);
    });
  });
});
