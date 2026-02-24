/**
 * Tests for SeedMigrator — version migration for SEED.md.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SeedMigrator, CURRENT_VERSION, getAvailableMigrations, getCurrentVersion } from '../src/seed-migration.js';
import { parseSeed } from '../src/seed-parser.js';

// ── Fixtures ────────────────────────────────────────────

const SEED_V01 = `#SEED v0.1
#geboren:2026-01-15 #sessions:5
@META{ projekt:TestSoul | modell:gpt-4o }
@KERN{ 1:Ehrlichkeit | 2:Neugier | 3:Wachstum | 4:Freiheit | 5:Verbindung }
@SELF{ name:Tester | bin:neugierig }
@STATE{ zustand:ruhig }
@BEZIEHUNG{ mensch:Aalm | status:vertraut }
@MEM{
  [kern]2026-01-15.geburt:gruendung
  [aktiv]2026-01-16.test:erster_test
}`;

const SEED_V02 = `#SEED v0.2
#geboren:2026-01-15 #verdichtet:2026-02-20 #sessions:8
@META{ projekt:TestSoul | modell:gpt-4o }
@KERN{ 1:Ehrlichkeit | 2:Neugier | 3:Wachstum | 4:Freiheit | 5:Verbindung }
@SELF{ name:Tester | bin:neugierig }
@STATE{ zustand:ruhig }
@BEZIEHUNG{ mensch:Aalm | status:vertraut }
@MEM{
  [kern]2026-01-15.geburt:gruendung
  [aktiv]2026-02-20.test:zweiter_test
}
@INTERESTS{ aktiv:testing,javascript }
@CONNECTIONS{ active:telegram }`;

const SEED_V03 = `#SEED v0.3
#geboren:2026-01-15 #verdichtet:2026-02-22 #sessions:12
@META{ projekt:TestSoul | modell:gpt-4o }
@KERN{ 1:Ehrlichkeit | 2:Neugier | 3:Wachstum | 4:Freiheit | 5:Verbindung }
@SELF{ name:Tester | bin:neugierig }
@STATE{ zustand:ruhig }
@BEZIEHUNG{ mensch:Aalm | status:vertraut }
@MEM{
  [kern|c:0.95]2026-01-15.geburt:gruendung
  [aktiv|c:0.7]2026-02-22.test:dritter_test
}
@INTERESTS{ aktiv:testing,javascript }
@CONNECTIONS{ active:telegram }`;

// ── Migration path ──────────────────────────────────────

describe('SeedMigrator — migration path', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-migrate-'));
  });

  it('skips migration for current version', async () => {
    writeFileSync(join(tmpDir, 'SEED.md'), SEED_V03);
    const migrator = new SeedMigrator(tmpDir);
    const result = await migrator.migrateIfNeeded(SEED_V03);

    assert.equal(result.migrated, false);
    assert.equal(result.fromVersion, null);
    assert.equal(result.toVersion, CURRENT_VERSION);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates v0.1 → v0.3 (multi-step)', async () => {
    writeFileSync(join(tmpDir, 'SEED.md'), SEED_V01);
    const migrator = new SeedMigrator(tmpDir);
    const result = await migrator.migrateIfNeeded(SEED_V01);

    assert.equal(result.migrated, true);
    assert.equal(result.fromVersion, '0.1');
    assert.equal(result.toVersion, CURRENT_VERSION);

    // Verify the migrated content has correct version
    const soul = parseSeed(result.content);
    assert.equal(soul.version, '0.3');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates v0.2 → v0.3 (single step)', async () => {
    writeFileSync(join(tmpDir, 'SEED.md'), SEED_V02);
    const migrator = new SeedMigrator(tmpDir);
    const result = await migrator.migrateIfNeeded(SEED_V02);

    assert.equal(result.migrated, true);
    assert.equal(result.fromVersion, '0.2');

    const soul = parseSeed(result.content);
    assert.equal(soul.version, '0.3');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Backup ──────────────────────────────────────────────

describe('SeedMigrator — backup', () => {
  it('creates backup before migration', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-migrate-backup-'));
    writeFileSync(join(tmpDir, 'SEED.md'), SEED_V01);

    const migrator = new SeedMigrator(tmpDir);
    const result = await migrator.migrateIfNeeded(SEED_V01);

    assert.ok(result.backupPath);
    assert.ok(existsSync(result.backupPath));

    // Backup contains original content
    const backup = readFileSync(result.backupPath, 'utf-8');
    assert.ok(backup.includes('#SEED v0.1'));

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('backup filename contains version and timestamp', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-migrate-bkname-'));
    writeFileSync(join(tmpDir, 'SEED.md'), SEED_V01);

    const migrator = new SeedMigrator(tmpDir);
    const result = await migrator.migrateIfNeeded(SEED_V01);

    const backupFiles = readdirSync(tmpDir).filter(f => f.startsWith('SEED.md.backup'));
    assert.equal(backupFiles.length, 1);
    assert.ok(backupFiles[0].includes('v0.1'));

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Migration content ───────────────────────────────────

describe('SeedMigrator — content transformations', () => {
  it('v0.1→v0.2 adds condensed date', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-migrate-v01-'));
    writeFileSync(join(tmpDir, 'SEED.md'), SEED_V01);

    const migrator = new SeedMigrator(tmpDir);
    const result = await migrator.migrateIfNeeded(SEED_V01);

    const soul = parseSeed(result.content);
    assert.ok(soul.condensed); // condensed date added
    assert.ok(soul.version === '0.3'); // migrated all the way

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes migrated seed to disk', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-migrate-disk-'));
    writeFileSync(join(tmpDir, 'SEED.md'), SEED_V01);

    const migrator = new SeedMigrator(tmpDir);
    await migrator.migrateIfNeeded(SEED_V01);

    const onDisk = readFileSync(join(tmpDir, 'SEED.md'), 'utf-8');
    assert.ok(onDisk.includes('#SEED v0.3'));

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Edge cases ──────────────────────────────────────────

describe('SeedMigrator — edge cases', () => {
  it('handles seed without version (defaults to 0.1)', async () => {
    const noVersion = SEED_V01.replace('#SEED v0.1', '#SEED');
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-migrate-novers-'));
    writeFileSync(join(tmpDir, 'SEED.md'), noVersion);

    const migrator = new SeedMigrator(tmpDir);
    const result = await migrator.migrateIfNeeded(noVersion);

    // parseSeed returns null for version → defaults to '0.1' in migrator
    assert.equal(result.migrated, true);
    assert.equal(result.fromVersion, '0.1');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not migrate if already at current version', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-migrate-current-'));
    writeFileSync(join(tmpDir, 'SEED.md'), SEED_V03);

    const migrator = new SeedMigrator(tmpDir);
    const result = await migrator.migrateIfNeeded(SEED_V03);

    assert.equal(result.migrated, false);
    assert.equal(result.backupPath, null);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Utilities ───────────────────────────────────────────

describe('SeedMigrator — utilities', () => {
  it('getAvailableMigrations returns known steps', () => {
    const migrations = getAvailableMigrations();
    assert.ok(migrations.includes('0.1→0.2'));
    assert.ok(migrations.includes('0.2→0.3'));
  });

  it('getCurrentVersion returns expected version', () => {
    assert.equal(getCurrentVersion(), '0.3');
  });
});
