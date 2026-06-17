#!/usr/bin/env node
/**
 * Backfill: embed curated memory .md files into the `memories` table (Sprint 1 / M2 backfill).
 *
 * Makes the historical memory corpus semantically searchable (searchSemantic was inert
 * because the table was empty). Uses the engine's own MemoryDB + LocalEmbeddings so the
 * stored BLOB format and embedding dimension (Ollama nomic-embed-text, 768d) match exactly
 * what live extraction now writes.
 *
 * SAFE against the running engine: SQLite WAL allows multi-process writes (serialized via
 * busy_timeout). Idempotent: skips chunks whose exact content already exists. Dry-run by
 * default — pass --apply to actually write.
 *
 *   SOUL_PATH=/Users/aalm/Projects/soul node backfill-memory-embeddings.mjs           # dry-run
 *   SOUL_PATH=/Users/aalm/Projects/soul node backfill-memory-embeddings.mjs --apply   # write
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { MemoryDB } from './src/memory-db.js';
import { LocalEmbeddings } from './src/local-embeddings.js';

const SOUL_PATH = process.env.SOUL_PATH || '/Users/aalm/Projects/soul';
const APPLY = process.argv.includes('--apply');

// Curated memory directories → memory type + baseline importance.
const SOURCES = [
  { dir: 'erinnerungen/kern',       type: 'core',      importance: 0.9 },
  { dir: 'erinnerungen/episodisch', type: 'episodic',  importance: 0.6 },
  { dir: 'erinnerungen/semantisch', type: 'semantic',  importance: 0.6 },
  { dir: 'erinnerungen/emotional',  type: 'emotional', importance: 0.7 },
  { dir: 'memory',                  type: 'daily',     importance: 0.4 },
];
const MIN_CHUNK = 80; // skip trivial/empty sections

function listMd(dir) {
  try {
    return readdirSync(join(SOUL_PATH, dir))
      .filter(f => f.endsWith('.md'))
      .map(f => join(SOUL_PATH, dir, f))
      .sort();
  } catch { return []; }
}

// Chunk by "## " headings, keeping each heading with its body. Files without
// headings become a single chunk.
function chunkMarkdown(text) {
  const lines = text.split('\n');
  const chunks = [];
  let cur = [];
  for (const line of lines) {
    if (/^##\s/.test(line) && cur.join('\n').trim().length) {
      chunks.push(cur.join('\n').trim());
      cur = [line];
    } else {
      cur.push(line);
    }
  }
  if (cur.join('\n').trim().length) chunks.push(cur.join('\n').trim());
  return chunks.length ? chunks : [text.trim()];
}

const emb = new LocalEmbeddings({});
if (!(await emb.isAvailable())) {
  console.error('✗ Ollama nicht verfügbar — Backfill abgebrochen (kein API-Fallback, Privacy).');
  process.exit(1);
}
console.log(`Embedder: ${emb.model} (${emb.getDimensions()}d)  |  mode: ${APPLY ? 'APPLY (schreibt)' : 'DRY-RUN'}`);

const db = new MemoryDB(SOUL_PATH, {}).init();
db.db.pragma('busy_timeout = 8000'); // wait out the engine's occasional writes

const existsStmt = db.db.prepare('SELECT 1 FROM memories WHERE content = ? LIMIT 1');
const seen = new Set();
const stats = { files: 0, chunks: 0, skippedShort: 0, dupInRun: 0, dupInDb: 0, embedFail: 0, inserted: 0 };
const samples = [];

for (const src of SOURCES) {
  for (const file of listMd(src.dir)) {
    stats.files++;
    let text;
    try { text = readFileSync(file, 'utf-8'); } catch { continue; }
    const rel = relative(SOUL_PATH, file);
    for (const raw of chunkMarkdown(text)) {
      const chunk = raw.trim();
      stats.chunks++;
      if (chunk.length < MIN_CHUNK) { stats.skippedShort++; continue; }
      if (seen.has(chunk)) { stats.dupInRun++; continue; }
      seen.add(chunk);
      if (existsStmt.get(chunk)) { stats.dupInDb++; continue; }
      if (samples.length < 6) samples.push({ type: src.type, file: rel, preview: chunk.replace(/\s+/g, ' ').slice(0, 140) });
      if (!APPLY) { stats.inserted++; continue; }
      const vec = await emb.embed(chunk); // self-truncates at 8000 chars internally
      if (!Array.isArray(vec) || !vec.length) { stats.embedFail++; continue; }
      db.insertMemory({
        type: src.type,
        source: `backfill:${rel}`,
        content: chunk,
        embedding: Buffer.from(Float32Array.from(vec).buffer),
        metadata: { backfill: true, file: rel },
        confidence: 0.5,
        importance: src.importance,
        tags: basename(file, '.md'),
      });
      stats.inserted++;
    }
  }
}

console.log('\nSAMPLES (was eingefügt würde):');
for (const s of samples) console.log(`  [${s.type}] ${s.file}\n      ${s.preview}…`);
console.log('\nSTATS:', JSON.stringify(stats, null, 2));
if (!APPLY) console.log('\nDRY-RUN — nichts geschrieben. Erneut mit --apply ausführen.');
else console.log(`\n✓ Backfill fertig: ${stats.inserted} Memories mit Embedding eingefügt.`);
