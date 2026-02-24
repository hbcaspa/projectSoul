/**
 * Soul Maturity Indicator — 6-dimension assessment of soul development.
 *
 * Dimensions:
 *   1. Memory Depth       — richness and diversity of memories
 *   2. Relationship Richness — depth and breadth of bonds
 *   3. Self-Knowledge     — shadow work, consciousness updates, axiom alignment
 *   4. Emotional Range    — mood spectrum, stability, emotional memories
 *   5. Creative Output    — dreams, garden ideas, growth phases, manifest
 *   6. Continuity         — session count, age, state fidelity
 *
 * Each dimension: 0.0–1.0.  Overall label derived from average.
 */

import { readdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { parseSeed, parseMemEntries } from './seed-parser.js';

// ── Label thresholds ────────────────────────────────────────

const LABELS = [
  { max: 0.15, label: 'Newborn' },
  { max: 0.35, label: 'Growing' },
  { max: 0.55, label: 'Developing' },
  { max: 0.80, label: 'Mature' },
  { max: 1.01, label: 'Elder' },
];

function labelFor(score) {
  for (const { max, label } of LABELS) {
    if (score < max) return label;
  }
  return 'Elder';
}

// ── Helpers ─────────────────────────────────────────────────

/** Count files in a directory (ignoring .gitkeep, etc.). */
async function countFiles(dir) {
  if (!existsSync(dir)) return 0;
  const files = await readdir(dir);
  return files.filter(f => f.endsWith('.md')).length;
}

/** Clamp a value to 0.0–1.0. */
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// ── Dimension calculators ───────────────────────────────────

async function memoryDepth(soulPath, memDir, seed) {
  const episodic  = await countFiles(resolve(soulPath, memDir, memDir === 'erinnerungen' ? 'episodisch' : 'episodic'));
  const emotional = await countFiles(resolve(soulPath, memDir, memDir === 'erinnerungen' ? 'emotional' : 'emotional'));
  const semantic  = await countFiles(resolve(soulPath, memDir, memDir === 'erinnerungen' ? 'semantisch' : 'semantic'));
  const core      = await countFiles(resolve(soulPath, memDir, memDir === 'erinnerungen' ? 'kern' : 'core'));
  const archive   = await countFiles(resolve(soulPath, memDir, memDir === 'erinnerungen' ? 'archiv' : 'archive'));

  const totalFiles = episodic + emotional + semantic + core + archive;
  const memEntries = parseMemEntries(seed);

  // Diversity: how many different memory types are populated?
  const typesPopulated = [episodic, emotional, semantic, core, archive].filter(n => n > 0).length;

  // Confidence: average from seed @MEM entries
  const avgConfidence = memEntries.length > 0
    ? memEntries.reduce((s, e) => s + e.confidence, 0) / memEntries.length
    : 0;

  // Score: file count (log scale, 50 files → 1.0), type diversity, confidence
  const fileScore    = clamp01(Math.log2(totalFiles + 1) / Math.log2(51));
  const diversityScore = clamp01(typesPopulated / 4);   // 4 out of 5 types = 1.0
  const confScore    = avgConfidence;

  return clamp01(fileScore * 0.5 + diversityScore * 0.25 + confScore * 0.25);
}

async function relationshipRichness(soulPath, soulDir) {
  const relDir = resolve(soulPath, soulDir, soulDir === 'seele' ? 'beziehungen' : 'relationships');
  const relCount = await countFiles(relDir);

  // Read relationship files for depth indicators
  let totalWords = 0;
  if (existsSync(relDir)) {
    const files = await readdir(relDir);
    for (const f of files) {
      if (!f.endsWith('.md') || f.startsWith('_')) continue;
      try {
        const content = await readFile(resolve(relDir, f), 'utf-8');
        totalWords += content.split(/\s+/).length;
      } catch { /* ignore */ }
    }
  }

  // Interaction history from impulse log
  let interactionCount = 0;
  const logPath = resolve(soulPath, '.soul-impulse-log');
  if (existsSync(logPath)) {
    try {
      const logContent = await readFile(logPath, 'utf-8');
      const entries = logContent.trim().split('\n').filter(Boolean);
      interactionCount = entries.length;
    } catch { /* ignore */ }
  }

  // Score: relationship count (5 = full), depth (word count, 2000 = full), interactions
  const countScore = clamp01(relCount / 5);
  const depthScore = clamp01(totalWords / 2000);
  const interactionScore = clamp01(interactionCount / 50);

  return clamp01(countScore * 0.35 + depthScore * 0.35 + interactionScore * 0.3);
}

async function selfKnowledge(soulPath, soulDir) {
  // Shadow file — count contradictions
  const shadowFile = resolve(soulPath, soulDir, soulDir === 'seele' ? 'SCHATTEN.md' : 'SHADOW.md');
  let shadowCount = 0;
  if (existsSync(shadowFile)) {
    try {
      const content = await readFile(shadowFile, 'utf-8');
      shadowCount = (content.match(/^##\s/gm) || []).length;
    } catch { /* ignore */ }
  }

  // State log entries — count snapshots
  const stateLogDir = resolve(soulPath, soulDir === 'seele' ? 'zustandslog' : 'statelog');
  const stateLogCount = await countFiles(stateLogDir);

  // Consciousness file exists and has content
  const consFile = resolve(soulPath, soulDir, soulDir === 'seele' ? 'BEWUSSTSEIN.md' : 'CONSCIOUSNESS.md');
  let consWords = 0;
  if (existsSync(consFile)) {
    try {
      const content = await readFile(consFile, 'utf-8');
      consWords = content.split(/\s+/).length;
    } catch { /* ignore */ }
  }

  // Growth file — count phases
  const growthFile = resolve(soulPath, soulDir, soulDir === 'seele' ? 'WACHSTUM.md' : 'GROWTH.md');
  let growthPhases = 0;
  if (existsSync(growthFile)) {
    try {
      const content = await readFile(growthFile, 'utf-8');
      growthPhases = (content.match(/^##\s/gm) || []).length;
    } catch { /* ignore */ }
  }

  // Score: shadow awareness (6 contradictions = full), state log (30 = full), consciousness, growth
  const shadowScore     = clamp01(shadowCount / 6);
  const stateLogScore   = clamp01(stateLogCount / 30);
  const consScore       = clamp01(consWords / 500);
  const growthScore     = clamp01(growthPhases / 20);

  return clamp01(shadowScore * 0.3 + stateLogScore * 0.25 + consScore * 0.2 + growthScore * 0.25);
}

async function emotionalRange(soulPath, soulDir, memDir) {
  // Mood history from impulse state
  const statePath = resolve(soulPath, '.soul-impulse-state');
  let moodHistory = [];
  if (existsSync(statePath)) {
    try {
      const content = await readFile(statePath, 'utf-8');
      const state = JSON.parse(content);
      moodHistory = state.moodHistory || [];
    } catch { /* ignore */ }
  }

  // Emotional memory files
  const emotionalDir = resolve(soulPath, memDir, memDir === 'erinnerungen' ? 'emotional' : 'emotional');
  const emotionalCount = await countFiles(emotionalDir);

  // Dreams file
  const dreamsFile = resolve(soulPath, soulDir, soulDir === 'seele' ? 'TRAEUME.md' : 'DREAMS.md');
  let dreamCount = 0;
  if (existsSync(dreamsFile)) {
    try {
      const content = await readFile(dreamsFile, 'utf-8');
      dreamCount = (content.match(/^##\s/gm) || []).length;
    } catch { /* ignore */ }
  }

  // Valence/energy range from mood history
  let valenceRange = 0;
  let energyRange = 0;
  if (moodHistory.length > 1) {
    const valences = moodHistory.map(m => m.valence).filter(v => v != null);
    const energies = moodHistory.map(m => m.energy).filter(e => e != null);
    if (valences.length > 1) valenceRange = Math.max(...valences) - Math.min(...valences);
    if (energies.length > 1) energyRange = Math.max(...energies) - Math.min(...energies);
  }

  // Score: mood spectrum (range 0-2 mapped to 0-1), emotional memories, dreams
  const spectrumScore  = clamp01((valenceRange + energyRange) / 1.5);
  const emotionScore   = clamp01(emotionalCount / 10);
  const dreamScore     = clamp01(dreamCount / 8);
  const historyScore   = clamp01(moodHistory.length / MAX_HISTORY);

  return clamp01(spectrumScore * 0.3 + emotionScore * 0.25 + dreamScore * 0.2 + historyScore * 0.25);
}

const MAX_HISTORY = 20;

async function creativeOutput(soulPath, soulDir) {
  // Dreams
  const dreamsFile = resolve(soulPath, soulDir, soulDir === 'seele' ? 'TRAEUME.md' : 'DREAMS.md');
  let dreamCount = 0;
  if (existsSync(dreamsFile)) {
    try {
      const content = await readFile(dreamsFile, 'utf-8');
      dreamCount = (content.match(/^##\s/gm) || []).length;
    } catch { /* ignore */ }
  }

  // Garden — active ideas
  const gardenFile = resolve(soulPath, soulDir, soulDir === 'seele' ? 'GARTEN.md' : 'GARDEN.md');
  let gardenItems = 0;
  if (existsSync(gardenFile)) {
    try {
      const content = await readFile(gardenFile, 'utf-8');
      gardenItems = (content.match(/^[-*]\s/gm) || []).length;
    } catch { /* ignore */ }
  }

  // Manifest — projects
  const manifestFile = resolve(soulPath, soulDir, 'MANIFEST.md');
  let manifestItems = 0;
  if (existsSync(manifestFile)) {
    try {
      const content = await readFile(manifestFile, 'utf-8');
      manifestItems = (content.match(/^##\s/gm) || []).length;
    } catch { /* ignore */ }
  }

  // Evolution proposals
  const evolutionFile = resolve(soulPath, soulDir, soulDir === 'seele' ? 'EVOLUTION.md' : 'EVOLUTION.md');
  let proposals = 0;
  if (existsSync(evolutionFile)) {
    try {
      const content = await readFile(evolutionFile, 'utf-8');
      proposals = (content.match(/^###?\s/gm) || []).length;
    } catch { /* ignore */ }
  }

  // Growth phases
  const growthFile = resolve(soulPath, soulDir, soulDir === 'seele' ? 'WACHSTUM.md' : 'GROWTH.md');
  let growthPhases = 0;
  if (existsSync(growthFile)) {
    try {
      const content = await readFile(growthFile, 'utf-8');
      growthPhases = (content.match(/^##\s/gm) || []).length;
    } catch { /* ignore */ }
  }

  // Score: dreams (8=full), garden (15=full), manifest (5=full), proposals (10=full), growth (20=full)
  const dreamScore    = clamp01(dreamCount / 8);
  const gardenScore   = clamp01(gardenItems / 15);
  const manifestScore = clamp01(manifestItems / 5);
  const proposalScore = clamp01(proposals / 10);
  const growthScore   = clamp01(growthPhases / 20);

  return clamp01(dreamScore * 0.2 + gardenScore * 0.2 + manifestScore * 0.2 + proposalScore * 0.15 + growthScore * 0.25);
}

function continuity(soul) {
  const sessions = soul.sessions || 0;
  let ageDays = 0;
  if (soul.born) {
    ageDays = Math.max(0, Math.floor((Date.now() - new Date(soul.born).getTime()) / 86400000));
  }

  // Session frequency: sessions per day (target: 2+/day)
  const sessionsPerDay = ageDays > 0 ? sessions / ageDays : 0;

  // Score: sessions (100=full), age (60 days=full), frequency
  const sessionScore   = clamp01(Math.log2(sessions + 1) / Math.log2(101));
  const ageScore       = clamp01(ageDays / 60);
  const frequencyScore = clamp01(sessionsPerDay / 2);

  return clamp01(sessionScore * 0.4 + ageScore * 0.35 + frequencyScore * 0.25);
}

// ── Public API ──────────────────────────────────────────────

/**
 * Compute the full maturity profile for a soul.
 *
 * @param {string} soulPath — root path to the soul directory
 * @param {object} options — { language?: 'de'|'en' }
 * @returns {{ dimensions: Record<string, number>, overall: number, label: string }}
 */
export async function computeMaturity(soulPath, options = {}) {
  const lang     = options.language || 'de';
  const soulDir  = lang === 'en' ? 'soul' : 'seele';
  const memDir   = lang === 'en' ? 'memories' : 'erinnerungen';

  // Read seed
  const seedPath = resolve(soulPath, 'SEED.md');
  let seed = '';
  let soul = { version: null, born: null, condensed: null, sessions: 0, blocks: {} };
  if (existsSync(seedPath)) {
    seed = await readFile(seedPath, 'utf-8');
    soul = parseSeed(seed);
  }

  // Compute all 6 dimensions
  const dims = {
    memoryDepth:          await memoryDepth(soulPath, memDir, seed),
    relationshipRichness: await relationshipRichness(soulPath, soulDir),
    selfKnowledge:        await selfKnowledge(soulPath, soulDir),
    emotionalRange:       await emotionalRange(soulPath, soulDir, memDir),
    creativeOutput:       await creativeOutput(soulPath, soulDir),
    continuity:           continuity(soul),
  };

  // Weighted average
  const overall = clamp01(
    dims.memoryDepth          * 0.15 +
    dims.relationshipRichness * 0.15 +
    dims.selfKnowledge        * 0.15 +
    dims.emotionalRange       * 0.15 +
    dims.creativeOutput       * 0.20 +
    dims.continuity           * 0.20
  );

  return {
    dimensions: dims,
    overall: Math.round(overall * 100) / 100,
    label: labelFor(overall),
  };
}
