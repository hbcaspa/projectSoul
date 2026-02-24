/**
 * Seed Writer — surgical block replacement for SEED.md.
 *
 * Inverse of seed-parser.js. Replaces individual @BLOCK{...} sections
 * without touching other blocks. Supports atomic writes for crash safety.
 */

import { writeFile, readFile, rename, mkdir, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { homedir } from 'os';
import { validateSeedWithEvents } from './seed-validator.js';

const BACKUP_DIR = join(homedir(), '.soul-seed-backup');
const MAX_BACKUPS = 50;

/**
 * Replace a single block in seed content.
 * @param {string} seedContent - Full SEED.md content
 * @param {string} blockName - Block name without @ (e.g. 'STATE')
 * @param {string} newContent - New block body (without @NAME{ and })
 * @returns {string} Updated seed content
 */
export function replaceBlock(seedContent, blockName, newContent) {
  const regex = new RegExp(`@${blockName}\\{[\\s\\S]*?\\}`, 'g');
  const replacement = `@${blockName}{\n${newContent}\n}`;

  if (regex.test(seedContent)) {
    // Reset lastIndex after test()
    regex.lastIndex = 0;
    return seedContent.replace(regex, replacement);
  }

  // Block doesn't exist — append before the last block or at end
  return seedContent.trimEnd() + '\n\n' + replacement + '\n';
}

/**
 * Replace multiple blocks at once (more efficient than chaining replaceBlock).
 * @param {string} seedContent - Full SEED.md content
 * @param {Object<string, string>} blocks - Map of blockName → newContent
 * @returns {string} Updated seed content
 */
export function replaceBlocks(seedContent, blocks) {
  let content = seedContent;
  for (const [name, body] of Object.entries(blocks)) {
    content = replaceBlock(content, name, body);
  }
  return content;
}

/**
 * Update the header line (verdichtet timestamp and sessions count).
 * @param {string} seedContent - Full SEED.md content
 * @param {Object} updates - { condensed?: string, sessions?: number }
 * @returns {string} Updated seed content
 */
export function updateHeader(seedContent, { condensed, sessions } = {}) {
  let content = seedContent;

  if (condensed) {
    content = content.replace(
      /#(?:verdichtet|condensed):[^\s#]+/,
      `#verdichtet:${condensed}`
    );
  }

  if (sessions !== undefined) {
    content = content.replace(
      /#sessions:\d+/,
      `#sessions:${sessions}`
    );
  }

  return content;
}

/**
 * Create a timestamped backup of the current SEED.md to ~/.soul-seed-backup/.
 * Rotates old backups to keep only the last MAX_BACKUPS files.
 *
 * @param {string} soulPath - Path to the soul directory
 * @returns {Promise<string|null>} Backup path or null if no seed to backup
 */
export async function backupSeed(soulPath) {
  const existing = await readSeed(soulPath);
  if (!existing) return null;

  await mkdir(BACKUP_DIR, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `SEED-${ts}.md`;
  const backupPath = join(BACKUP_DIR, backupName);

  await writeFile(backupPath, existing, 'utf-8');

  // Rotate: keep only last MAX_BACKUPS
  try {
    const files = (await readdir(BACKUP_DIR))
      .filter(f => f.startsWith('SEED-') && f.endsWith('.md'))
      .sort();
    if (files.length > MAX_BACKUPS) {
      const toDelete = files.slice(0, files.length - MAX_BACKUPS);
      for (const f of toDelete) {
        await unlink(join(BACKUP_DIR, f));
      }
    }
  } catch { /* rotation is best-effort */ }

  return backupPath;
}

/**
 * Atomically write seed content to SEED.md.
 * Writes to .tmp file first, then renames for crash safety.
 * Creates a redundant backup in ~/.soul-seed-backup/ before writing.
 *
 * When `validate: true` is passed, the seed is validated before writing.
 * If validation fails, the write is rejected and an event is emitted.
 *
 * @param {string} soulPath - Path to the soul directory
 * @param {string} seedContent - Complete SEED.md content
 * @param {Object} [options]
 * @param {boolean} [options.validate=false] - Validate seed before writing
 * @param {boolean} [options.backup=true] - Create backup before writing
 * @param {Object} [options.bus] - SoulEventBus for validation failure events
 * @param {string} [options.source] - Source identifier for events
 * @returns {Promise<{written: boolean, backupPath?: string, validation?: import('./seed-validator.js').ValidationResult}>}
 */
export async function writeSeed(soulPath, seedContent, options = {}) {
  const { validate = false, backup = true, bus, source } = options;

  if (validate) {
    const result = validateSeedWithEvents(seedContent, { bus, source });
    if (!result.valid) {
      console.error(`  [seed-writer] Validation failed — write blocked (${result.errors.length} error(s))`);
      for (const err of result.errors) {
        console.error(`    - ${err}`);
      }
      return { written: false, validation: result };
    }
    if (result.warnings.length > 0) {
      for (const warn of result.warnings) {
        console.warn(`  [seed-writer] Warning: ${warn}`);
      }
    }
  }

  // Create redundant backup before overwriting
  let backupPath = null;
  if (backup) {
    try {
      backupPath = await backupSeed(soulPath);
    } catch (err) {
      console.warn(`  [seed-writer] Backup failed (non-blocking): ${err.message}`);
    }
  }

  const seedPath = resolve(soulPath, 'SEED.md');
  const tmpPath = resolve(soulPath, 'SEED.md.tmp');

  await writeFile(tmpPath, seedContent, 'utf-8');
  await rename(tmpPath, seedPath);
  return { written: true, backupPath };
}

/**
 * Read the current SEED.md content.
 * @param {string} soulPath - Path to the soul directory
 * @returns {string|null} Seed content or null if not found
 */
export async function readSeed(soulPath) {
  const seedPath = resolve(soulPath, 'SEED.md');
  if (!existsSync(seedPath)) return null;
  return readFile(seedPath, 'utf-8');
}
