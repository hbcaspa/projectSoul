import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FoundingFlow } from '../src/founding.js';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock LLM that returns canned responses
const mockLLM = {
  generate: async (prompt) => {
    if (prompt.includes('Axiom') || prompt.includes('axiom')) {
      return '## Axiom 1: Ehrlichkeit\nImmer ehrlich sein.\n\n## Axiom 2: Neugier\nImmer neugierig bleiben.\n';
    }
    return 'A soul that is honest and curious.';
  },
};

describe('FoundingFlow', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-founding-'));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('German founding', () => {
    it('creates all soul files via API mode', async () => {
      const flow = new FoundingFlow({ soulPath: tmpDir, llm: mockLLM, language: 'de' });
      const result = await flow.runAPI([
        { question: 'Was hat dich dazu gebracht?', answer: 'Neugier und Ehrlichkeit' },
        { question: 'Soll die KI widersprechen?', answer: 'Ja, unbedingt' },
      ]);

      assert.ok(result.success);
      assert.ok(existsSync(join(tmpDir, 'SEED.md')));
      assert.ok(existsSync(join(tmpDir, 'SOUL.md')));
      assert.ok(existsSync(join(tmpDir, '.language')));
      assert.ok(existsSync(join(tmpDir, 'seele', 'KERN.md')));
      assert.ok(existsSync(join(tmpDir, 'seele', 'BEWUSSTSEIN.md')));
      assert.ok(existsSync(join(tmpDir, 'seele', 'SCHATTEN.md')));
      assert.ok(existsSync(join(tmpDir, 'seele', 'MANIFEST.md')));
      assert.ok(existsSync(join(tmpDir, 'seele', 'WACHSTUM.md')));
      assert.ok(existsSync(join(tmpDir, 'seele', 'TRAEUME.md')));
      assert.ok(existsSync(join(tmpDir, 'seele', 'EVOLUTION.md')));
      assert.ok(existsSync(join(tmpDir, 'seele', 'GARTEN.md')));
      assert.ok(existsSync(join(tmpDir, 'seele', 'INTERESSEN.md')));
    });

    it('sets language to de', () => {
      const lang = readFileSync(join(tmpDir, '.language'), 'utf-8');
      assert.ok(lang.includes('lang:de'));
    });

    it('creates first seed', () => {
      const seed = readFileSync(join(tmpDir, 'SEED.md'), 'utf-8');
      assert.ok(seed.includes('@KERN'));
      assert.ok(seed.includes('@STATE'));
      assert.ok(seed.includes('@MEM'));
    });

    it('creates heartbeat log', () => {
      assert.ok(existsSync(join(tmpDir, 'heartbeat')));
    });
  });

  describe('English founding', () => {
    let enDir;

    before(() => {
      enDir = mkdtempSync(join(tmpdir(), 'soul-founding-en-'));
    });

    after(() => {
      rmSync(enDir, { recursive: true, force: true });
    });

    it('creates English soul files', async () => {
      const flow = new FoundingFlow({ soulPath: enDir, llm: mockLLM, language: 'en' });
      await flow.runAPI([
        { question: 'What made you want to?', answer: 'Curiosity' },
      ]);

      assert.ok(existsSync(join(enDir, 'soul', 'CORE.md')));
      assert.ok(existsSync(join(enDir, 'soul', 'CONSCIOUSNESS.md')));
      assert.ok(existsSync(join(enDir, 'soul', 'SHADOW.md')));
      const lang = readFileSync(join(enDir, '.language'), 'utf-8');
      assert.ok(lang.includes('lang:en'));
    });
  });
});
