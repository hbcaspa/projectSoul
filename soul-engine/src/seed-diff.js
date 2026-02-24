/**
 * Seed Identity Diff — block-by-block comparison of two seeds.
 *
 * Detects drift between seed versions with severity classification:
 * - critical: @KERN changed (axioms should be immutable)
 * - significant: @SELF changed or >3 @MEM entries disappeared
 * - normal: routine updates (@STATE, @INTERESTS, etc.)
 *
 * Emits 'seed.drift-detected' via event bus when changes are found.
 */

import { parseSeed } from './seed-parser.js';

// ── Raw Block Extraction ─────────────────────────────────────

function extractRawBlock(content, blockName) {
  const regex = new RegExp(`@${blockName}\\{([\\s\\S]*?)\\}`, 'g');
  const match = regex.exec(content);
  return match ? match[1].trim() : '';
}

// ── Severity Levels ──────────────────────────────────────────

export const SEVERITY = {
  CRITICAL: 'critical',
  SIGNIFICANT: 'significant',
  NORMAL: 'normal',
};

// Blocks that trigger critical severity when changed
const CRITICAL_BLOCKS = new Set(['KERN']);

// Blocks that trigger significant severity when changed
const SIGNIFICANT_BLOCKS = new Set(['SELF']);

// Threshold for MEM entry disappearance to be significant
const MEM_DISAPPEAR_THRESHOLD = 3;

// Bilingual aliases for relationship blocks
const BONDS_ALIASES = new Set(['BONDS', 'BEZIEHUNG', 'RELATIONSHIP']);

// ── Diff Result Types ────────────────────────────────────────

/**
 * @typedef {Object} BlockDiff
 * @property {string} block - Block name
 * @property {string} type - 'added' | 'removed' | 'changed'
 * @property {string} severity - SEVERITY level
 * @property {Object} [details] - Specific change details
 */

/**
 * @typedef {Object} SeedDiffResult
 * @property {boolean} changed - Whether any changes were detected
 * @property {string} severity - Highest severity level across all changes
 * @property {BlockDiff[]} diffs - List of block-level changes
 * @property {Object} summary - Human-readable summary
 */

/**
 * Compare two seed contents and produce a structured diff.
 *
 * @param {string} oldContent - Previous SEED.md content
 * @param {string} newContent - Current SEED.md content
 * @returns {SeedDiffResult}
 */
export function diffSeeds(oldContent, newContent) {
  const oldSoul = parseSeed(oldContent);
  const newSoul = parseSeed(newContent);

  const diffs = [];
  let highestSeverity = SEVERITY.NORMAL;

  // ── Header Changes ──

  if (oldSoul.sessions !== null && newSoul.sessions !== null) {
    if (newSoul.sessions < oldSoul.sessions) {
      diffs.push({
        block: 'HEADER',
        type: 'changed',
        severity: SEVERITY.SIGNIFICANT,
        details: {
          field: 'sessions',
          old: oldSoul.sessions,
          new: newSoul.sessions,
          note: 'Session count decreased — possible data loss',
        },
      });
      highestSeverity = SEVERITY.SIGNIFICANT;
    }
  }

  // ── Collect all block names ──

  const allBlocks = new Set([
    ...Object.keys(oldSoul.blocks),
    ...Object.keys(newSoul.blocks),
  ]);

  for (const block of allBlocks) {
    const oldBlock = oldSoul.blocks[block];
    const newBlock = newSoul.blocks[block];

    // Block removed
    if (oldBlock && !newBlock) {
      // Skip if it's a bonds alias that was just renamed
      if (BONDS_ALIASES.has(block)) {
        const hasOtherAlias = [...BONDS_ALIASES].some(
          a => a !== block && newSoul.blocks[a]
        );
        if (hasOtherAlias) continue;
      }

      const severity = getSeverityForBlock(block);
      diffs.push({
        block,
        type: 'removed',
        severity,
        details: { keyCount: Object.keys(oldBlock).length },
      });
      highestSeverity = maxSeverity(highestSeverity, severity);
      continue;
    }

    // Block added
    if (!oldBlock && newBlock) {
      diffs.push({
        block,
        type: 'added',
        severity: SEVERITY.NORMAL,
        details: { keyCount: Object.keys(newBlock).length },
      });
      continue;
    }

    // Block changed
    if (oldBlock && newBlock) {
      const blockDiff = diffBlock(block, oldBlock, newBlock, oldContent, newContent);
      if (blockDiff) {
        diffs.push(blockDiff);
        highestSeverity = maxSeverity(highestSeverity, blockDiff.severity);
      }
    }
  }

  // ── Build Summary ──

  const summary = buildSummary(diffs, oldSoul, newSoul);

  return {
    changed: diffs.length > 0,
    severity: diffs.length > 0 ? highestSeverity : SEVERITY.NORMAL,
    diffs,
    summary,
  };
}

/**
 * Compare two seed contents and emit drift event if changes detected.
 *
 * @param {string} oldContent - Previous SEED.md content
 * @param {string} newContent - Current SEED.md content
 * @param {Object} [options]
 * @param {Object} [options.bus] - SoulEventBus instance
 * @param {string} [options.source] - Source identifier
 * @returns {SeedDiffResult}
 */
export function diffSeedsWithEvents(oldContent, newContent, { bus, source } = {}) {
  const result = diffSeeds(oldContent, newContent);

  if (result.changed && bus) {
    bus.safeEmit('seed.drift-detected', {
      source: source || 'seed-diff',
      severity: result.severity,
      changeCount: result.diffs.length,
      blocks: result.diffs.map(d => d.block),
      summary: result.summary,
    });
  }

  return result;
}

// ── Internal: Block-Level Diff ──────────────────────────────

/**
 * Compare two parsed block objects and return a diff or null if identical.
 * For MEM blocks, uses raw line comparison instead of parsed keys
 * (the parser is lossy for [aktiv|c:X.X] tags because | splits them).
 */
function diffBlock(blockName, oldBlock, newBlock, oldContent, newContent) {
  // MEM needs special line-based comparison
  if (blockName === 'MEM' && oldContent && newContent) {
    return diffMemBlock(oldContent, newContent);
  }

  const oldKeys = new Set(Object.keys(oldBlock));
  const newKeys = new Set(Object.keys(newBlock));

  const added = [...newKeys].filter(k => !oldKeys.has(k));
  const removed = [...oldKeys].filter(k => !newKeys.has(k));
  const changed = [...oldKeys].filter(k =>
    newKeys.has(k) && oldBlock[k] !== newBlock[k]
  );

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    return null;
  }

  const severity = getSeverityForBlock(blockName);

  return {
    block: blockName,
    type: 'changed',
    severity,
    details: {
      added: added.length > 0 ? added : undefined,
      removed: removed.length > 0 ? removed : undefined,
      changed: changed.length > 0 ? changed : undefined,
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: changed.length,
    },
  };
}

/**
 * Line-based comparison for @MEM blocks.
 * Each non-empty line is one memory entry. Compare by normalized content.
 */
function diffMemBlock(oldContent, newContent) {
  const oldRaw = extractRawBlock(oldContent, 'MEM');
  const newRaw = extractRawBlock(newContent, 'MEM');

  const oldLines = new Set(oldRaw.split('\n').map(l => l.trim()).filter(Boolean));
  const newLines = new Set(newRaw.split('\n').map(l => l.trim()).filter(Boolean));

  const added = [...newLines].filter(l => !oldLines.has(l));
  const removed = [...oldLines].filter(l => !newLines.has(l));

  if (added.length === 0 && removed.length === 0) {
    return null;
  }

  let severity = SEVERITY.NORMAL;

  // Check for [kern]/[core] removal — critical
  const kernRemoved = removed.filter(l => /\[(kern|core)\]/.test(l));
  if (kernRemoved.length > 0) {
    severity = SEVERITY.CRITICAL;
  }
  // Check for mass disappearance — significant
  else if (removed.length > MEM_DISAPPEAR_THRESHOLD) {
    severity = SEVERITY.SIGNIFICANT;
  }

  return {
    block: 'MEM',
    type: 'changed',
    severity,
    details: {
      added: added.length > 0 ? added : undefined,
      removed: removed.length > 0 ? removed : undefined,
      addedCount: added.length,
      removedCount: removed.length,
      changedCount: 0,
    },
  };
}

/**
 * Determine the base severity for changes to a block.
 */
function getSeverityForBlock(blockName) {
  if (CRITICAL_BLOCKS.has(blockName)) return SEVERITY.CRITICAL;
  if (SIGNIFICANT_BLOCKS.has(blockName)) return SEVERITY.SIGNIFICANT;
  return SEVERITY.NORMAL;
}

/**
 * Return the higher of two severity levels.
 */
function maxSeverity(a, b) {
  const order = { [SEVERITY.CRITICAL]: 3, [SEVERITY.SIGNIFICANT]: 2, [SEVERITY.NORMAL]: 1 };
  return (order[a] || 0) >= (order[b] || 0) ? a : b;
}

/**
 * Build a human-readable summary of the diff.
 */
function buildSummary(diffs, oldSoul, newSoul) {
  if (diffs.length === 0) {
    return { text: 'No changes detected', blocks: [] };
  }

  const lines = [];
  const blocks = diffs.map(d => d.block);

  for (const diff of diffs) {
    const { block, type, severity, details } = diff;
    const label = severity === SEVERITY.CRITICAL ? '[CRITICAL]'
      : severity === SEVERITY.SIGNIFICANT ? '[SIGNIFICANT]'
      : '';

    if (type === 'removed') {
      lines.push(`${label} @${block} removed (${details.keyCount} entries)`);
    } else if (type === 'added') {
      lines.push(`@${block} added (${details.keyCount} entries)`);
    } else if (type === 'changed') {
      const parts = [];
      if (details.addedCount > 0) parts.push(`+${details.addedCount}`);
      if (details.removedCount > 0) parts.push(`-${details.removedCount}`);
      if (details.changedCount > 0) parts.push(`~${details.changedCount}`);
      lines.push(`${label} @${block} changed (${parts.join(', ')})`);
    }
  }

  return { text: lines.join('; '), blocks };
}
