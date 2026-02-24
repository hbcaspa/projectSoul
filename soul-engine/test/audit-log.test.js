/**
 * Tests for AuditLogger — append-only security event log.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AuditLogger } from '../src/audit-log.js';
import { SoulEventBus } from '../src/event-bus.js';

// ── Direct logging ──────────────────────────────────────

describe('AuditLogger — direct log()', () => {
  let tmpDir, audit;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-audit-'));
    audit = new AuditLogger(tmpDir);
  });

  after(() => {
    // Cleanup all temp dirs created in this suite
  });

  it('creates .soul-audit.jsonl on first write', () => {
    audit.log('seed.validation-failed', { source: 'test' });
    assert.ok(existsSync(join(tmpDir, '.soul-audit.jsonl')));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes valid JSONL entries', () => {
    audit.log('seed.validation-failed', { source: 'validator' });
    audit.log('mood.clamped', { source: 'impulse', detail: 'delta exceeded' });

    const lines = readFileSync(join(tmpDir, '.soul-audit.jsonl'), 'utf-8')
      .trim().split('\n');
    assert.equal(lines.length, 2);

    const entry1 = JSON.parse(lines[0]);
    assert.equal(entry1.event, 'seed.validation-failed');
    assert.equal(entry1.source, 'validator');
    assert.ok(entry1.ts);

    const entry2 = JSON.parse(lines[1]);
    assert.equal(entry2.event, 'mood.clamped');
    assert.equal(entry2.detail, 'delta exceeded');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes severity when present', () => {
    audit.log('seed.drift-detected', { source: 'diff', severity: 'critical' });

    const lines = readFileSync(join(tmpDir, '.soul-audit.jsonl'), 'utf-8')
      .trim().split('\n');
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.severity, 'critical');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes patterns and score', () => {
    audit.log('performance.detected', {
      source: 'detector',
      score: 0.85,
      patterns: ['stock-phrases', 'over-empathy'],
    });

    const lines = readFileSync(join(tmpDir, '.soul-audit.jsonl'), 'utf-8')
      .trim().split('\n');
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.score, 0.85);
    assert.deepEqual(entry.patterns, ['stock-phrases', 'over-empathy']);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('truncates long error messages', () => {
    const longError = 'x'.repeat(500);
    audit.log('seed.recovery-failed', { source: 'recovery', error: longError });

    const lines = readFileSync(join(tmpDir, '.soul-audit.jsonl'), 'utf-8')
      .trim().split('\n');
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.error.length, 200);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('tracks entry count', () => {
    assert.equal(audit.entryCount, 0);
    audit.log('mood.clamped', { source: 'test' });
    audit.log('mood.clamped', { source: 'test' });
    assert.equal(audit.entryCount, 2);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('defaults source to ? when not provided', () => {
    audit.log('mood.clamped', {});

    const lines = readFileSync(join(tmpDir, '.soul-audit.jsonl'), 'utf-8')
      .trim().split('\n');
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.source, '?');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Event Bus integration ───────────────────────────────

describe('AuditLogger — bus integration', () => {
  it('captures seed.validation-failed from bus', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-audit-bus-'));
    const bus = new SoulEventBus({ soulPath: tmpDir });
    const audit = new AuditLogger(tmpDir, { bus });
    audit.registerListeners();

    bus.safeEmit('seed.validation-failed', { source: 'consolidator', error: 'Missing @KERN' });

    const lines = readFileSync(join(tmpDir, '.soul-audit.jsonl'), 'utf-8')
      .trim().split('\n');
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.event, 'seed.validation-failed');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('captures mood.clamped from bus', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-audit-bus2-'));
    const bus = new SoulEventBus({ soulPath: tmpDir });
    const audit = new AuditLogger(tmpDir, { bus });
    audit.registerListeners();

    bus.safeEmit('mood.clamped', { source: 'impulse-state', detail: 'Valence clamped from 0.9 to 0.6' });

    const lines = readFileSync(join(tmpDir, '.soul-audit.jsonl'), 'utf-8')
      .trim().split('\n');
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.event, 'mood.clamped');
    assert.ok(entry.detail.includes('clamped'));

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ignores non-audit events', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-audit-bus3-'));
    const bus = new SoulEventBus({ soulPath: tmpDir });
    const audit = new AuditLogger(tmpDir, { bus });
    audit.registerListeners();

    bus.safeEmit('message.received', { source: 'telegram', text: 'hello' });
    bus.safeEmit('heartbeat.completed', { source: 'engine' });

    assert.ok(!existsSync(join(tmpDir, '.soul-audit.jsonl')));
    assert.equal(audit.entryCount, 0);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('captures multiple different audit events', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-audit-bus4-'));
    const bus = new SoulEventBus({ soulPath: tmpDir });
    const audit = new AuditLogger(tmpDir, { bus });
    audit.registerListeners();

    bus.safeEmit('seed.validation-failed', { source: 'a' });
    bus.safeEmit('seed.drift-detected', { source: 'b', severity: 'significant' });
    bus.safeEmit('seed.recovered', { source: 'c', commit: 'abc123' });
    bus.safeEmit('performance.detected', { source: 'd', score: 0.9 });

    const lines = readFileSync(join(tmpDir, '.soul-audit.jsonl'), 'utf-8')
      .trim().split('\n');
    assert.equal(lines.length, 4);
    assert.equal(JSON.parse(lines[2]).commit, 'abc123');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Rotation ────────────────────────────────────────────

describe('AuditLogger — rotation', () => {
  it('rotates current log to monthly archive', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-audit-rot-'));
    const audit = new AuditLogger(tmpDir);

    audit.log('seed.recovered', { source: 'test' });
    assert.ok(existsSync(join(tmpDir, '.soul-audit.jsonl')));

    const ok = audit.rotate();
    assert.equal(ok, true);
    assert.ok(!existsSync(join(tmpDir, '.soul-audit.jsonl')));

    // Archive file exists
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    assert.ok(existsSync(join(tmpDir, `.soul-audit-${monthStr}.jsonl`)));

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false when no file to rotate', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-audit-rot2-'));
    const audit = new AuditLogger(tmpDir);

    const ok = audit.rotate();
    assert.equal(ok, false);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false when archive already exists', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-audit-rot3-'));
    const audit = new AuditLogger(tmpDir);

    audit.log('test', { source: 'test' });

    // Pre-create archive
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    writeFileSync(join(tmpDir, `.soul-audit-${monthStr}.jsonl`), 'existing\n');

    const ok = audit.rotate();
    assert.equal(ok, false);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── No bus ───────────────────────────────────────────────

describe('AuditLogger — no bus', () => {
  it('registerListeners does nothing without bus', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-audit-nobus-'));
    const audit = new AuditLogger(tmpDir);
    audit.registerListeners(); // should not throw
    assert.equal(audit.entryCount, 0);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
