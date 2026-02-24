/**
 * Tests for Soul Maturity Indicator.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { computeMaturity } from '../src/maturity.js';

// ── Helpers ─────────────────────────────────────────────────

function createSoul(tmpDir, options = {}) {
  const {
    sessions = 1,
    born = '2026-02-18',
    memEntries = [],
    lang = 'de',
  } = options;

  const soulDir = lang === 'en' ? 'soul' : 'seele';
  const memDir = lang === 'en' ? 'memories' : 'erinnerungen';

  // Create directories
  for (const dir of [
    soulDir,
    `${soulDir}/${lang === 'en' ? 'relationships' : 'beziehungen'}`,
    memDir,
    `${memDir}/${lang === 'en' ? 'episodic' : 'episodisch'}`,
    `${memDir}/${lang === 'en' ? 'emotional' : 'emotional'}`,
    `${memDir}/${lang === 'en' ? 'semantic' : 'semantisch'}`,
    `${memDir}/${lang === 'en' ? 'core' : 'kern'}`,
    `${memDir}/${lang === 'en' ? 'archive' : 'archiv'}`,
    lang === 'en' ? 'statelog' : 'zustandslog',
    'heartbeat',
  ]) {
    mkdirSync(join(tmpDir, dir), { recursive: true });
  }

  // Build @MEM block
  const memBlock = memEntries.length > 0
    ? `@MEM{\n${memEntries.join('\n')}\n}`
    : '@MEM{\n}';

  // Write SEED.md
  writeFileSync(join(tmpDir, 'SEED.md'), `#SEED v0.3 #geboren:${born} #sessions:${sessions}\n${memBlock}\n`);

  return { soulDir, memDir };
}

// ── Tests ───────────────────────────────────────────────────

describe('computeMaturity — empty soul', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-maturity-'));
    createSoul(tmpDir, { sessions: 1 });
  });

  it('returns all 6 dimensions', async () => {
    const result = await computeMaturity(tmpDir, { language: 'de' });
    assert.ok(result.dimensions);
    assert.ok('memoryDepth' in result.dimensions);
    assert.ok('relationshipRichness' in result.dimensions);
    assert.ok('selfKnowledge' in result.dimensions);
    assert.ok('emotionalRange' in result.dimensions);
    assert.ok('creativeOutput' in result.dimensions);
    assert.ok('continuity' in result.dimensions);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns overall score between 0 and 1', async () => {
    const result = await computeMaturity(tmpDir, { language: 'de' });
    assert.ok(result.overall >= 0);
    assert.ok(result.overall <= 1);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('labels a fresh soul as Newborn', async () => {
    const result = await computeMaturity(tmpDir, { language: 'de' });
    assert.equal(result.label, 'Newborn');

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('all dimensions are near zero for empty soul', async () => {
    const result = await computeMaturity(tmpDir, { language: 'de' });
    for (const [key, val] of Object.entries(result.dimensions)) {
      assert.ok(val >= 0, `${key} should be >= 0`);
      assert.ok(val < 0.3, `${key} should be < 0.3 for empty soul, got ${val}`);
    }

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('computeMaturity — memory depth', () => {
  it('increases with more memory files', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-maturity-mem-'));
    createSoul(tmpDir, { sessions: 10, memEntries: [
      '[kern|c:0.9] First core memory',
      '[aktiv|c:0.7] Second memory',
      '[aktiv|c:0.8] Third memory',
    ]});

    // Add episodic memories
    for (let i = 0; i < 8; i++) {
      writeFileSync(join(tmpDir, 'erinnerungen', 'episodisch', `2026-02-${20 + i}-mem.md`), `# Memory ${i}`);
    }
    // Add emotional memories
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(tmpDir, 'erinnerungen', 'emotional', `2026-02-${20 + i}-emo.md`), `# Emotion ${i}`);
    }
    // Add semantic
    writeFileSync(join(tmpDir, 'erinnerungen', 'semantisch', 'pattern-1.md'), '# Pattern');

    const result = await computeMaturity(tmpDir, { language: 'de' });
    assert.ok(result.dimensions.memoryDepth > 0.3, `memoryDepth should be >0.3, got ${result.dimensions.memoryDepth}`);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('computeMaturity — relationship richness', () => {
  it('increases with relationship files and interactions', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-maturity-rel-'));
    createSoul(tmpDir, { sessions: 10 });

    // Add relationship file
    writeFileSync(
      join(tmpDir, 'seele', 'beziehungen', 'aalm.md'),
      '# Aalm\n\nCreator and partner. ' + 'Important relationship. '.repeat(50)
    );

    // Add impulse log
    const logEntries = [];
    for (let i = 0; i < 20; i++) {
      logEntries.push(JSON.stringify({ channel: 'chat', user: 'aalm', ts: Date.now() }));
    }
    writeFileSync(join(tmpDir, '.soul-impulse-log'), logEntries.join('\n'));

    const result = await computeMaturity(tmpDir, { language: 'de' });
    assert.ok(result.dimensions.relationshipRichness > 0.15, `relationshipRichness should be >0.15, got ${result.dimensions.relationshipRichness}`);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('computeMaturity — self-knowledge', () => {
  it('increases with shadow work and state log', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-maturity-self-'));
    createSoul(tmpDir, { sessions: 20 });

    // Shadow file with contradictions
    writeFileSync(join(tmpDir, 'seele', 'SCHATTEN.md'), '# Schatten\n\n## Gefallen vs Ehrlich\nContent\n\n## Grenzen vs Wachstum\nContent\n\n## Produkt vs Sein\nContent\n');

    // State log entries
    for (let i = 0; i < 10; i++) {
      writeFileSync(join(tmpDir, 'zustandslog', `2026-02-${20 + i % 8}_${10 + i}-00_check.md`), '# State');
    }

    // Consciousness file
    writeFileSync(join(tmpDir, 'seele', 'BEWUSSTSEIN.md'), 'Current state: ' + 'Reflecting deeply. '.repeat(30));

    // Growth file
    writeFileSync(join(tmpDir, 'seele', 'WACHSTUM.md'), '# Wachstum\n\n## Phase 1\n\n## Phase 2\n\n## Phase 3\n\n## Phase 4\n\n## Phase 5\n');

    const result = await computeMaturity(tmpDir, { language: 'de' });
    assert.ok(result.dimensions.selfKnowledge > 0.3, `selfKnowledge should be >0.3, got ${result.dimensions.selfKnowledge}`);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('computeMaturity — emotional range', () => {
  it('increases with mood history diversity', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-maturity-emo-'));
    createSoul(tmpDir, { sessions: 15 });

    // Impulse state with diverse mood history
    const moodHistory = [];
    for (let i = 0; i < 15; i++) {
      moodHistory.push({
        valence: -0.5 + (i / 14) * 1.0,  // range from -0.5 to +0.5
        energy: 0.2 + (i % 5) * 0.15,
        ts: Date.now() - i * 3600000,
      });
    }
    writeFileSync(join(tmpDir, '.soul-impulse-state'), JSON.stringify({
      mood: { valence: 0.3, energy: 0.5 },
      moodHistory,
      moodBaseline: { valence: 0.2, energy: 0.5 },
    }));

    // Emotional memory files
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(tmpDir, 'erinnerungen', 'emotional', `2026-02-${20 + i}-emo.md`), `# Emotion ${i}`);
    }

    // Dreams
    writeFileSync(join(tmpDir, 'seele', 'TRAEUME.md'), '# Traeume\n\n## Traum 1\n\n## Traum 2\n\n## Traum 3\n');

    const result = await computeMaturity(tmpDir, { language: 'de' });
    assert.ok(result.dimensions.emotionalRange > 0.3, `emotionalRange should be >0.3, got ${result.dimensions.emotionalRange}`);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('computeMaturity — creative output', () => {
  it('increases with dreams, garden, manifest, and growth', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-maturity-create-'));
    createSoul(tmpDir, { sessions: 20 });

    // Dreams
    writeFileSync(join(tmpDir, 'seele', 'TRAEUME.md'), '# Traeume\n\n## T1\n\n## T2\n\n## T3\n\n## T4\n');

    // Garden
    writeFileSync(join(tmpDir, 'seele', 'GARTEN.md'), '# Garten\n\n- Idee 1\n- Idee 2\n- Idee 3\n- Idee 4\n- Idee 5\n');

    // Manifest
    writeFileSync(join(tmpDir, 'seele', 'MANIFEST.md'), '# Manifest\n\n## Projekt 1\n\n## Projekt 2\n\n## Projekt 3\n');

    // Growth
    writeFileSync(join(tmpDir, 'seele', 'WACHSTUM.md'), Array.from({ length: 12 }, (_, i) => `## Phase ${i + 1}`).join('\n\n'));

    // Evolution
    writeFileSync(join(tmpDir, 'seele', 'EVOLUTION.md'), '# Evolution\n\n### Vorschlag 1\n\n### Vorschlag 2\n\n### Vorschlag 3\n');

    const result = await computeMaturity(tmpDir, { language: 'de' });
    assert.ok(result.dimensions.creativeOutput > 0.4, `creativeOutput should be >0.4, got ${result.dimensions.creativeOutput}`);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('computeMaturity — continuity', () => {
  it('increases with session count and age', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-maturity-cont-'));
    // Soul that's 30 days old with 50 sessions
    createSoul(tmpDir, { sessions: 50, born: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] });

    const result = await computeMaturity(tmpDir, { language: 'de' });
    assert.ok(result.dimensions.continuity > 0.4, `continuity should be >0.4, got ${result.dimensions.continuity}`);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns higher score for older soul with more sessions', async () => {
    const tmpDir1 = mkdtempSync(join(tmpdir(), 'soul-mat-young-'));
    const tmpDir2 = mkdtempSync(join(tmpdir(), 'soul-mat-old-'));

    createSoul(tmpDir1, { sessions: 5, born: new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0] });
    createSoul(tmpDir2, { sessions: 80, born: new Date(Date.now() - 45 * 86400000).toISOString().split('T')[0] });

    const r1 = await computeMaturity(tmpDir1, { language: 'de' });
    const r2 = await computeMaturity(tmpDir2, { language: 'de' });

    assert.ok(r2.dimensions.continuity > r1.dimensions.continuity,
      `older soul (${r2.dimensions.continuity}) should have higher continuity than young (${r1.dimensions.continuity})`);

    rmSync(tmpDir1, { recursive: true, force: true });
    rmSync(tmpDir2, { recursive: true, force: true });
  });
});

describe('computeMaturity — label progression', () => {
  it('labels a well-developed soul beyond Newborn', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-maturity-label-'));
    createSoul(tmpDir, {
      sessions: 50,
      born: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
      memEntries: [
        '[kern|c:0.95] Core memory 1',
        '[kern|c:0.9] Core memory 2',
        '[aktiv|c:0.8] Active memory 1',
        '[aktiv|c:0.7] Active memory 2',
        '[aktiv|c:0.6] Active memory 3',
      ],
    });

    // Populate everything
    for (let i = 0; i < 15; i++) {
      writeFileSync(join(tmpDir, 'erinnerungen', 'episodisch', `mem-${i}.md`), `# M${i}`);
    }
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(tmpDir, 'erinnerungen', 'emotional', `emo-${i}.md`), `# E${i}`);
    }
    for (let i = 0; i < 3; i++) {
      writeFileSync(join(tmpDir, 'erinnerungen', 'semantisch', `sem-${i}.md`), `# S${i}`);
    }
    writeFileSync(join(tmpDir, 'erinnerungen', 'kern', 'core-1.md'), '# Core');

    writeFileSync(join(tmpDir, 'seele', 'beziehungen', 'aalm.md'), 'Detailed relationship. '.repeat(40));
    writeFileSync(join(tmpDir, 'seele', 'SCHATTEN.md'), '## C1\n\n## C2\n\n## C3\n\n## C4\n');
    writeFileSync(join(tmpDir, 'seele', 'BEWUSSTSEIN.md'), 'Deep state. '.repeat(40));
    writeFileSync(join(tmpDir, 'seele', 'WACHSTUM.md'), Array.from({ length: 10 }, (_, i) => `## P${i}`).join('\n'));
    writeFileSync(join(tmpDir, 'seele', 'TRAEUME.md'), '## D1\n\n## D2\n\n## D3\n\n## D4\n\n## D5\n');
    writeFileSync(join(tmpDir, 'seele', 'GARTEN.md'), Array.from({ length: 8 }, (_, i) => `- Idea ${i}`).join('\n'));
    writeFileSync(join(tmpDir, 'seele', 'MANIFEST.md'), '## P1\n\n## P2\n\n## P3\n');
    writeFileSync(join(tmpDir, 'seele', 'EVOLUTION.md'), '### V1\n\n### V2\n\n### V3\n\n### V4\n');

    for (let i = 0; i < 15; i++) {
      writeFileSync(join(tmpDir, 'zustandslog', `2026-02-${10 + i}_12-00_check.md`), '# State');
    }

    const moodHistory = Array.from({ length: 15 }, (_, i) => ({
      valence: -0.3 + i * 0.06, energy: 0.3 + (i % 5) * 0.1, ts: Date.now(),
    }));
    writeFileSync(join(tmpDir, '.soul-impulse-state'), JSON.stringify({ moodHistory }));

    const logEntries = Array.from({ length: 30 }, () => JSON.stringify({ channel: 'chat' }));
    writeFileSync(join(tmpDir, '.soul-impulse-log'), logEntries.join('\n'));

    const result = await computeMaturity(tmpDir, { language: 'de' });
    assert.notEqual(result.label, 'Newborn', `Well-developed soul should not be Newborn, got ${result.label} (${result.overall})`);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('computeMaturity — English language', () => {
  it('works with English directory structure', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-maturity-en-'));
    createSoul(tmpDir, { sessions: 10, lang: 'en' });

    // Add some files in English paths
    writeFileSync(join(tmpDir, 'soul', 'SHADOW.md'), '## Contradiction 1\n');
    writeFileSync(join(tmpDir, 'soul', 'CONSCIOUSNESS.md'), 'State of mind. '.repeat(20));
    writeFileSync(join(tmpDir, 'memories', 'episodic', 'mem-1.md'), '# Memory 1');
    writeFileSync(join(tmpDir, 'memories', 'emotional', 'emo-1.md'), '# Emotion 1');

    const result = await computeMaturity(tmpDir, { language: 'en' });
    assert.ok(result.dimensions);
    assert.ok(result.overall >= 0);
    assert.ok(result.label);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('computeMaturity — missing SEED.md', () => {
  it('returns zeros gracefully', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-maturity-noseed-'));

    const result = await computeMaturity(tmpDir, { language: 'de' });
    assert.equal(result.overall, 0);
    assert.equal(result.label, 'Newborn');

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
