/**
 * Tests for memory importance + relevance decay.
 *
 * Tests the importance field, touchMemory, and applyDecay
 * added to MemoryDB, and the updated scoring in AttentionModel.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { MemoryDB } from '../src/memory-db.js';
import { AttentionModel } from '../src/attention.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Memory DB: Importance Field ──────────────────────────────

describe('MemoryDB — importance field', () => {
  let db, tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-importance-'));
    db = new MemoryDB(tmpDir).init();
  });

  after(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores importance with default 0.5', () => {
    const id = db.insertMemory({ content: 'Test memory' });
    const [mem] = db.searchStructured({ limit: 1 });
    assert.equal(mem.importance, 0.5);
  });

  it('stores custom importance value', () => {
    const id = db.insertMemory({ content: 'Important memory', importance: 0.9 });
    const results = db.searchStructured({ limit: 10 });
    const mem = results.find(m => m.id === id);
    assert.equal(mem.importance, 0.9);
  });

  it('updates importance with updateImportance()', () => {
    const id = db.insertMemory({ content: 'Adjustable memory', importance: 0.5 });
    db.updateImportance(id, 0.85);
    const results = db.searchStructured({ limit: 10 });
    const mem = results.find(m => m.id === id);
    assert.equal(mem.importance, 0.85);
  });

  it('clamps importance to [0, 1]', () => {
    const id = db.insertMemory({ content: 'Clamp test' });
    db.updateImportance(id, 1.5);
    let results = db.searchStructured({ limit: 10 });
    let mem = results.find(m => m.id === id);
    assert.equal(mem.importance, 1.0);

    db.updateImportance(id, -0.5);
    results = db.searchStructured({ limit: 10 });
    mem = results.find(m => m.id === id);
    assert.equal(mem.importance, 0.0);
  });

  it('stores last_accessed timestamp', () => {
    const id = db.insertMemory({ content: 'Access test' });
    const results = db.searchStructured({ limit: 10 });
    const mem = results.find(m => m.id === id);
    assert.ok(mem.last_accessed);
  });

  it('includes avgImportance in stats', () => {
    const stats = db.getStats();
    assert.ok('avgImportance' in stats);
    assert.ok(typeof stats.avgImportance === 'number');
  });
});

// ── Memory DB: touchMemory ──────────────────────────────────

describe('MemoryDB — touchMemory', () => {
  let db, tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-touch-'));
    db = new MemoryDB(tmpDir).init();
  });

  after(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('updates last_accessed timestamp', () => {
    const id = db.insertMemory({ content: 'Touch me' });

    // Manually set last_accessed to the past
    db.db.prepare("UPDATE memories SET last_accessed = datetime('now', '-10 days') WHERE id = ?").run(id);

    const before = db.db.prepare('SELECT last_accessed FROM memories WHERE id = ?').get(id);
    db.touchMemory(id);
    const after = db.db.prepare('SELECT last_accessed FROM memories WHERE id = ?').get(id);

    assert.notEqual(before.last_accessed, after.last_accessed);
  });
});

// ── Memory DB: Decay ────────────────────────────────────────

describe('MemoryDB — applyDecay', () => {
  let db, tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-decay-'));
    db = new MemoryDB(tmpDir).init();
  });

  after(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not decay recently accessed memories', () => {
    const id = db.insertMemory({ content: 'Fresh memory', importance: 0.8 });
    const result = db.applyDecay();
    assert.equal(result.decayed, 0);

    const mem = db.db.prepare('SELECT importance FROM memories WHERE id = ?').get(id);
    assert.equal(mem.importance, 0.8);
  });

  it('decays stale memories after grace period', () => {
    const id = db.insertMemory({ content: 'Old memory', importance: 0.8 });

    // Move last_accessed to 15 days ago
    db.db.prepare("UPDATE memories SET last_accessed = datetime('now', '-15 days') WHERE id = ?").run(id);

    const result = db.applyDecay();
    assert.ok(result.decayed > 0);

    const mem = db.db.prepare('SELECT importance FROM memories WHERE id = ?').get(id);
    assert.ok(mem.importance < 0.8);
    // 15 - 7 = 8 days of decay at 0.01/day = 0.08 decay → 0.72
    assert.ok(mem.importance >= 0.7);
    assert.ok(mem.importance <= 0.75);
  });

  it('does not decay below minimum (0.1)', () => {
    const id = db.insertMemory({ content: 'Very old memory', importance: 0.2 });

    // Move last_accessed to 100 days ago
    db.db.prepare("UPDATE memories SET last_accessed = datetime('now', '-100 days') WHERE id = ?").run(id);

    db.applyDecay();
    const mem = db.db.prepare('SELECT importance FROM memories WHERE id = ?').get(id);
    assert.equal(mem.importance, 0.1);
  });

  it('exempts core memories from decay', () => {
    const id = db.insertMemory({ content: 'Core memory', importance: 0.9, tags: 'kern,identity' });

    // Move last_accessed to 30 days ago
    db.db.prepare("UPDATE memories SET last_accessed = datetime('now', '-30 days') WHERE id = ?").run(id);

    db.applyDecay();
    const mem = db.db.prepare('SELECT importance FROM memories WHERE id = ?').get(id);
    assert.equal(mem.importance, 0.9);
  });

  it('exempts English core tag from decay', () => {
    const id = db.insertMemory({ content: 'Core memory EN', importance: 0.9, tags: 'core,identity' });

    db.db.prepare("UPDATE memories SET last_accessed = datetime('now', '-30 days') WHERE id = ?").run(id);

    db.applyDecay();
    const mem = db.db.prepare('SELECT importance FROM memories WHERE id = ?').get(id);
    assert.equal(mem.importance, 0.9);
  });

  it('returns correct count', () => {
    // Create multiple stale memories
    for (let i = 0; i < 3; i++) {
      const id = db.insertMemory({ content: `Stale ${i}`, importance: 0.7 });
      db.db.prepare("UPDATE memories SET last_accessed = datetime('now', '-20 days') WHERE id = ?").run(id);
    }

    const result = db.applyDecay();
    assert.ok(result.decayed >= 3);
  });
});

// ── Memory DB: Schema Migration ─────────────────────────────

describe('MemoryDB — schema migration', () => {
  it('migrates existing database without importance column', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-migrate-'));

    // Create an old-schema database manually
    const dbPath = join(tmpDir, '.soul-memory.db');
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'general',
        source TEXT NOT NULL DEFAULT 'unknown',
        content TEXT NOT NULL,
        embedding BLOB,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        confidence REAL NOT NULL DEFAULT 0.5,
        tags TEXT DEFAULT ''
      )
    `);
    raw.prepare("INSERT INTO memories (content) VALUES ('old memory')").run();
    raw.close();

    // Open with new MemoryDB — should migrate
    const db = new MemoryDB(tmpDir).init();

    // Check new columns exist
    const columns = db.db.prepare("PRAGMA table_info(memories)").all().map(c => c.name);
    assert.ok(columns.includes('importance'));
    assert.ok(columns.includes('last_accessed'));

    // Check existing row has defaults
    const mem = db.db.prepare('SELECT * FROM memories WHERE id = 1').get();
    assert.equal(mem.importance, 0.5);
    assert.ok(mem.last_accessed);

    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Attention Model: Importance in Scoring ──────────────────

describe('AttentionModel — importance scoring', () => {
  let db, attention, tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-att-imp-'));
    db = new MemoryDB(tmpDir).init();
    attention = new AttentionModel({ db, embeddings: null, context: null });
  });

  after(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('high importance scores higher than low importance', () => {
    const now = Date.now();
    const highImp = {
      semanticScore: 0.5, confidence: 0.5, importance: 0.9,
      created_at: new Date(now).toISOString(),
    };
    const lowImp = {
      semanticScore: 0.5, confidence: 0.5, importance: 0.1,
      created_at: new Date(now).toISOString(),
    };
    assert.ok(attention.scoreRelevance(highImp, now) > attention.scoreRelevance(lowImp, now));
  });

  it('importance contributes to composite score with correct weight', () => {
    const now = Date.now();
    // With semantic 0 and same timestamp, score = 0.25*recency + 0.15*conf + 0.2*imp
    // recency for age=0 is 1.0
    // So a={conf:0,imp:1} → 0.25*1 + 0 + 0.2*1 = 0.45
    // b={conf:0,imp:0} → 0.25*1 + 0 + 0 = 0.25
    // diff = 0.2
    const a = attention.scoreRelevance({
      semanticScore: 0, confidence: 0, importance: 1.0,
      created_at: new Date(now).toISOString(),
    }, now);
    const b = attention.scoreRelevance({
      semanticScore: 0, confidence: 0, importance: 0.0,
      created_at: new Date(now).toISOString(),
    }, now);

    const diff = a - b;
    assert.ok(diff > 0.19 && diff < 0.21, `Expected ~0.2, got ${diff}`);
  });

  it('touches memories when building context', async () => {
    const id = db.insertMemory({ content: 'Touchable memory', importance: 0.8 });

    // Set last_accessed to the past
    db.db.prepare("UPDATE memories SET last_accessed = datetime('now', '-5 days') WHERE id = ?").run(id);
    const before = db.db.prepare('SELECT last_accessed FROM memories WHERE id = ?').get(id);

    await attention.buildContext('memory', 'test', 'test');

    const after = db.db.prepare('SELECT last_accessed FROM memories WHERE id = ?').get(id);
    // last_accessed should have been updated (touched)
    assert.notEqual(before.last_accessed, after.last_accessed);
  });
});
