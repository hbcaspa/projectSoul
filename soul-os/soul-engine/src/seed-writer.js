/**
 * Seed Writer — surgical block replacement for SEED.md.
 *
 * Inverse of seed-parser.js. Replaces individual @BLOCK{...} sections
 * without touching other blocks. Supports atomic writes for crash safety.
 */

import { writeFile, readFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

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
 * Atomically write seed content to SEED.md.
 * Writes to .tmp file first, then renames for crash safety.
 * @param {string} soulPath - Path to the soul directory
 * @param {string} seedContent - Complete SEED.md content
 */
export async function writeSeed(soulPath, seedContent) {
  const seedPath = resolve(soulPath, 'SEED.md');
  const tmpPath = resolve(soulPath, 'SEED.md.tmp');

  await writeFile(tmpPath, seedContent, 'utf-8');
  await rename(tmpPath, seedPath);
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
