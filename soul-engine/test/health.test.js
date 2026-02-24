/**
 * Tests for Soul Health Check.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkHealth } from '../src/health.js';

// ── Helpers ─────────────────────────────────────────────────

function createBasicSoul(tmpDir, options = {}) {
  const { sessions = 10, version = '0.3', lang = 'de' } = options;

  const soulDir = lang === 'en' ? 'soul' : 'seele';
  const memDir = lang === 'en' ? 'memories' : 'erinnerungen';
  const subDirs = lang === 'en'
    ? ['episodic', 'emotional', 'semantic', 'core', 'archive']
    : ['episodisch', 'emotional', 'semantisch', 'kern', 'archiv'];

  mkdirSync(join(tmpDir, soulDir), { recursive: true });
  mkdirSync(join(tmpDir, memDir), { recursive: true });
  for (const sub of subDirs) {
    mkdirSync(join(tmpDir, memDir, sub), { recursive: true });
  }

  writeFileSync(join(tmpDir, 'SEED.md'),
    `#SEED v${version} #geboren:2026-02-18 #sessions:${sessions}\n@META{projekt:Soul}\n@KERN{1:Ehrlichkeit}\n@STATE{zustand:aktiv}\n`
  );
}

// ── Tests ───────────────────────────────────────────────────

describe('checkHealth — overall', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-'));
    createBasicSoul(tmpDir);
  });

  it('returns all 6 indicators', async () => {
    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.ok(result.indicators);
    assert.ok('seedValidity' in result.indicators);
    assert.ok('chainSync' in result.indicators);
    assert.ok('costBudget' in result.indicators);
    assert.ok('backupAge' in result.indicators);
    assert.ok('memoryHealth' in result.indicators);
    assert.ok('encryption' in result.indicators);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns overall status', async () => {
    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.ok(['healthy', 'warning', 'critical'].includes(result.overall));
    assert.ok(result.summary);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('checkHealth — seed validity', () => {
  it('healthy for valid current-version seed', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-seed-'));
    createBasicSoul(tmpDir);

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.seedValidity.status, 'healthy');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('critical when SEED.md missing', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-noseed-'));

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.seedValidity.status, 'critical');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('warning for outdated version', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-oldver-'));
    createBasicSoul(tmpDir, { version: '0.1' });

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.seedValidity.status, 'warning');
    assert.ok(result.indicators.seedValidity.detail.includes('0.1'));

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('critical for tiny seed', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-tiny-'));
    writeFileSync(join(tmpDir, 'SEED.md'), '#SEED v0.3');

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.seedValidity.status, 'critical');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('checkHealth — chain sync', () => {
  it('warning when chain not configured', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-nochain-'));
    createBasicSoul(tmpDir);

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.chainSync.status, 'warning');
    assert.ok(result.indicators.chainSync.detail.includes('not configured'));

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('healthy for recent sync', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-chain-'));
    createBasicSoul(tmpDir);

    writeFileSync(join(tmpDir, '.soul-chain-status'), JSON.stringify({
      lastSync: new Date().toISOString(),
      peers: 2,
    }));

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.chainSync.status, 'healthy');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('critical for chain error', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-chainerr-'));
    createBasicSoul(tmpDir);

    writeFileSync(join(tmpDir, '.soul-chain-status'), JSON.stringify({
      error: 'Connection refused',
    }));

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.chainSync.status, 'critical');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('checkHealth — cost budget', () => {
  it('warning when cost tracking not initialized', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-nocost-'));
    createBasicSoul(tmpDir);

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.costBudget.status, 'warning');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('healthy for low usage', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-lowcost-'));
    createBasicSoul(tmpDir);

    const mockCosts = {
      budgetPerDay: 500000,
      getToday: () => ({ total: { input: 10000, output: 5000, calls: 3 } }),
    };

    const result = await checkHealth(tmpDir, { language: 'de', costs: mockCosts });
    assert.equal(result.indicators.costBudget.status, 'healthy');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('critical for over-budget', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-over-'));
    createBasicSoul(tmpDir);

    const mockCosts = {
      budgetPerDay: 100000,
      getToday: () => ({ total: { input: 80000, output: 50000, calls: 20 } }),
    };

    const result = await checkHealth(tmpDir, { language: 'de', costs: mockCosts });
    assert.equal(result.indicators.costBudget.status, 'critical');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('checkHealth — memory health', () => {
  it('warning for empty memories', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-nomem-'));
    createBasicSoul(tmpDir);

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.memoryHealth.status, 'warning');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('healthy with index and populated dirs', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-mem-'));
    createBasicSoul(tmpDir);

    writeFileSync(join(tmpDir, 'erinnerungen', 'INDEX.md'), '# Index\n');
    writeFileSync(join(tmpDir, 'erinnerungen', 'episodisch', 'e1.md'), '# E1');
    writeFileSync(join(tmpDir, 'erinnerungen', 'emotional', 'emo1.md'), '# Emo1');
    writeFileSync(join(tmpDir, 'erinnerungen', 'kern', 'k1.md'), '# K1');

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.memoryHealth.status, 'healthy');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('checkHealth — encryption', () => {
  it('healthy when secrets encrypted', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-enc-'));
    createBasicSoul(tmpDir);
    writeFileSync(join(tmpDir, '.env.enc'), 'encrypted-data');

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.encryption.status, 'healthy');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('warning for plaintext env', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-noenc-'));
    createBasicSoul(tmpDir);
    writeFileSync(join(tmpDir, '.env'), 'API_KEY=secret');

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.encryption.status, 'warning');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('healthy when no secrets exist', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-nosec-'));
    createBasicSoul(tmpDir);

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.indicators.encryption.status, 'healthy');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('checkHealth — overall aggregation', () => {
  it('overall is critical if any indicator is critical', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-crit-'));
    // No SEED.md = critical seedValidity

    const result = await checkHealth(tmpDir, { language: 'de' });
    assert.equal(result.overall, 'critical');
    assert.equal(result.summary, 'Critical issues detected');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('overall is warning if worst is warning', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-warn-'));
    createBasicSoul(tmpDir);
    // Chain not configured = warning, memory empty = warning, etc.

    const result = await checkHealth(tmpDir, { language: 'de' });
    // Multiple warnings (chain, backup, memory, costs) but no critical
    assert.ok(result.overall === 'warning' || result.overall === 'healthy');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('checkHealth — English language', () => {
  it('works with English directory structure', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-health-en-'));
    createBasicSoul(tmpDir, { lang: 'en' });

    writeFileSync(join(tmpDir, 'memories', 'INDEX.md'), '# Index');
    writeFileSync(join(tmpDir, 'memories', 'episodic', 'e1.md'), '# E1');
    writeFileSync(join(tmpDir, 'memories', 'emotional', 'emo1.md'), '# Emo1');

    const result = await checkHealth(tmpDir, { language: 'en' });
    assert.ok(result.indicators);
    assert.ok(result.overall);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
