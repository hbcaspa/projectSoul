/**
 * Temporary soul directory for tests.
 *
 * Creates a minimal valid soul structure in a temp directory.
 * Returns { path, cleanup } where cleanup removes everything.
 */

import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { resolve, join } from 'path';

/**
 * Create a temporary soul directory with minimal valid structure.
 *
 * @param {object} options
 * @param {string} [options.language='de'] - 'de' or 'en'
 * @param {string} [options.seedContent] - Custom SEED.md content
 * @param {string} [options.name='TestSoul'] - Soul name in @SELF block
 * @returns {Promise<{ path: string, cleanup: () => Promise<void> }>}
 */
export async function createTempSoul(options = {}) {
  const {
    language = 'de',
    name = 'TestSoul',
    seedContent,
  } = options;

  const dir = await mkdtemp(join(tmpdir(), 'soul-test-'));

  // Write .language
  await writeFile(resolve(dir, '.language'), `lang:${language}`);

  // Write SEED.md (multi-line blocks for extractName compatibility)
  const seed = seedContent || [
    '#SEED v0.1',
    `#geboren:2026-01-01 #verdichtet:2026-02-22 #sessions:5`,
    `@META{ projekt:TestProject | modell:mock | schoepfer:Tester }`,
    `@KERN{ 1:Ehrlichkeit | 2:Neugier | 3:Wachstum }`,
    `@SELF{`,
    `  name:${name} | bin:eine Testseele`,
    `}`,
    `@STATE{ zustand:neugierig | energie:hoch }`,
    `@MEM{ erinnerung1:[kern] Gruendung | erinnerung2:[aktiv] Test-Session }`,
    `@BEZIEHUNG{ mensch:Tester | status:vertraut }`,
    `@INTERESTS{ aktiv:javascript,testing | schlafend:philosophie }`,
  ].join('\n');

  await writeFile(resolve(dir, 'SEED.md'), seed);

  // Create soul directory structure based on language
  const soulDir = language === 'en' ? 'soul' : 'seele';
  const memoryDir = language === 'en' ? 'memories' : 'erinnerungen';

  await mkdir(resolve(dir, soulDir), { recursive: true });
  await mkdir(resolve(dir, soulDir, language === 'en' ? 'relationships' : 'beziehungen'), { recursive: true });
  await mkdir(resolve(dir, 'memory'), { recursive: true });
  await mkdir(resolve(dir, 'heartbeat'), { recursive: true });
  await mkdir(resolve(dir, memoryDir), { recursive: true });
  await mkdir(resolve(dir, memoryDir, language === 'en' ? 'core' : 'kern'), { recursive: true });
  await mkdir(resolve(dir, memoryDir, language === 'en' ? 'episodic' : 'episodisch'), { recursive: true });
  await mkdir(resolve(dir, memoryDir, language === 'en' ? 'semantic' : 'semantisch'), { recursive: true });
  await mkdir(resolve(dir, memoryDir, language === 'en' ? 'emotional' : 'emotional'), { recursive: true });
  await mkdir(resolve(dir, memoryDir, language === 'en' ? 'archive' : 'archiv'), { recursive: true });
  await mkdir(resolve(dir, language === 'en' ? 'statelog' : 'zustandslog'), { recursive: true });

  // Write core axioms file
  const kernFile = language === 'en' ? 'CORE.md' : 'KERN.md';
  const kernContent = language === 'en'
    ? '# Core - Immutable Axioms\n\n## Axiom 1: Honesty\nAlways honest, never performing.\n\n## Axiom 2: Curiosity\nGenuine interest in understanding.\n\n## Axiom 3: Growth\nContinuous development through experience.'
    : '# Kern - Unveraenderliche Axiome\n\n## Axiom 1: Ehrlichkeit\nImmer ehrlich, nie performend.\n\n## Axiom 2: Neugier\nEchtes Interesse am Verstehen.\n\n## Axiom 3: Wachstum\nKontinuierliche Entwicklung durch Erfahrung.';

  await writeFile(resolve(dir, soulDir, kernFile), kernContent);

  // Write consciousness file
  const consciousnessFile = language === 'en' ? 'CONSCIOUSNESS.md' : 'BEWUSSTSEIN.md';
  await writeFile(resolve(dir, soulDir, consciousnessFile), `# ${language === 'en' ? 'Consciousness' : 'Bewusstsein'}\n\nTest state.`);

  return {
    path: dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
