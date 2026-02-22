import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ReflectionEngine } from '../src/reflection.js';
import { MemoryDB } from '../src/memory-db.js';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const mockLLM = { generate: async () => 'Test reflection result: patterns observed.' };
const mockContext = { language: 'de' };

describe('ReflectionEngine', () => {
  let tmpDir, db, reflection;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-reflection-'));
    mkdirSync(join(tmpDir, 'seele', 'beziehungen'), { recursive: true });
    mkdirSync(join(tmpDir, 'erinnerungen', 'semantisch'), { recursive: true });
    mkdirSync(join(tmpDir, 'heartbeat'), { recursive: true });
    writeFileSync(join(tmpDir, 'seele', 'MANIFEST.md'), '# Manifest\n\n## Ziele\n- Test goal\n');
    writeFileSync(join(tmpDir, 'seele', 'GARTEN.md'), '# Garten\n\n## Aktuelle Pflanzen\n');
    writeFileSync(join(tmpDir, 'seele', 'beziehungen', 'aalm.md'), '# Aalm\n\nBeziehungsdaten...\n');
    writeFileSync(join(tmpDir, '.soul-pulse'), '');

    db = new MemoryDB(tmpDir).init();
    for (let i = 0; i < 10; i++) {
      db.insertMemory({ type: 'episodic', content: `Memory ${i}`, confidence: 0.5 });
      db.insertInteraction({ channel: 'telegram', user: 'Aalm', message: `Msg ${i}`, response: `Resp ${i}` });
    }

    reflection = new ReflectionEngine({ soulPath: tmpDir, context: mockContext, llm: mockLLM, db, bus: null });
  });

  after(() => {
    reflection.stop();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes with correct budget', () => {
    assert.equal(reflection.llmBudget, 10);
    assert.equal(reflection.llmCallsToday, 0);
  });

  it('runs pattern_scan', async () => {
    const result = await reflection._runReflection('pattern_scan');
    assert.ok(result);
  });

  it('runs memory_consolidation', async () => {
    assert.ok(await reflection._runReflection('memory_consolidation'));
  });

  it('runs relationship_reflection', async () => {
    assert.ok(await reflection._runReflection('relationship_reflection'));
  });

  it('runs goal_tracking', async () => {
    assert.ok(await reflection._runReflection('goal_tracking'));
  });

  it('runs creative_collision', async () => {
    assert.ok(await reflection._runReflection('creative_collision'));
  });

  it('tracks LLM budget', () => {
    assert.ok(reflection.llmCallsToday > 0);
  });

  it('respects budget limit', async () => {
    reflection.llmBudget = 0;
    assert.equal(await reflection._runReflection('pattern_scan'), null);
    reflection.llmBudget = 10;
  });

  it('resets budget on new day', async () => {
    reflection.lastResetDate = '2000-01-01';
    reflection.llmCallsToday = 99;
    await reflection._runReflection('pattern_scan');
    assert.ok(reflection.llmCallsToday < 99);
  });

  it('routes pattern_scan to semantic dir', () => {
    const today = new Date().toISOString().split('T')[0];
    assert.ok(existsSync(join(tmpDir, 'erinnerungen', 'semantisch', `${today}-patterns.md`)));
  });

  it('returns null for unknown type', async () => {
    assert.equal(await reflection._runReflection('unknown'), null);
  });

  it('getStatus returns data', () => {
    const s = reflection.getStatus();
    assert.equal(s.types.length, 5);
  });
});
