/**
 * Seed Schema Validator — enforces structural integrity of SEED.md.
 *
 * Validates parsed seed against the Seed Protocol specification:
 * - Header: version, born date, sessions count
 * - Mandatory blocks: @META, @KERN, @SELF, @STATE, @BONDS/@BEZIEHUNG, @MEM
 * - Block content: axioms in KERN, identity in SELF, etc.
 * - Size guards: warn >5KB, error >8KB
 *
 * On validation failure with event bus: emits 'seed.validation-failed'.
 */

import { parseSeed } from './seed-parser.js';

// ── Size Limits ──────────────────────────────────────────────

const SIZE_WARN_BYTES = 5 * 1024;  // 5KB — target ceiling
const SIZE_ERROR_BYTES = 8 * 1024; // 8KB — hard limit

// ── Mandatory Blocks ─────────────────────────────────────────

const MANDATORY_BLOCKS = ['META', 'KERN', 'SELF', 'STATE', 'MEM'];

// BONDS block has bilingual aliases
const BONDS_ALIASES = ['BONDS', 'BEZIEHUNG', 'RELATIONSHIP'];

// ── Validation Result ────────────────────────────────────────

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the seed passes all required checks
 * @property {string[]} errors - Hard failures (seed must not be written)
 * @property {string[]} warnings - Soft issues (seed can be written, but attention needed)
 */

/**
 * Validate raw seed content against the Seed Protocol specification.
 *
 * @param {string} content - Raw SEED.md content
 * @returns {ValidationResult}
 */
export function validateSeed(content) {
  const result = { valid: true, errors: [], warnings: [] };

  if (!content || typeof content !== 'string') {
    result.valid = false;
    result.errors.push('Seed content is empty or not a string');
    return result;
  }

  // ── Size Checks ──

  const sizeBytes = Buffer.byteLength(content, 'utf-8');

  if (sizeBytes > SIZE_ERROR_BYTES) {
    result.valid = false;
    result.errors.push(
      `Seed exceeds hard limit: ${(sizeBytes / 1024).toFixed(1)}KB (max ${SIZE_ERROR_BYTES / 1024}KB)`
    );
  } else if (sizeBytes > SIZE_WARN_BYTES) {
    result.warnings.push(
      `Seed approaching limit: ${(sizeBytes / 1024).toFixed(1)}KB (target <${SIZE_WARN_BYTES / 1024}KB)`
    );
  }

  // ── Parse ──

  let soul;
  try {
    soul = parseSeed(content);
  } catch (err) {
    result.valid = false;
    result.errors.push(`Seed parse failed: ${err.message}`);
    return result;
  }

  // ── Header Validation ──

  if (!soul.version) {
    result.valid = false;
    result.errors.push('Missing header: #SEED v{version}');
  }

  if (!soul.born) {
    result.valid = false;
    result.errors.push('Missing header: born date (#geboren: or #born:)');
  }

  if (soul.sessions === null || soul.sessions === undefined) {
    result.valid = false;
    result.errors.push('Missing header: #sessions count');
  } else if (soul.sessions < 0) {
    result.valid = false;
    result.errors.push(`Invalid sessions count: ${soul.sessions}`);
  }

  // ── Mandatory Block Existence ──

  for (const block of MANDATORY_BLOCKS) {
    if (!soul.blocks[block] || Object.keys(soul.blocks[block]).length === 0) {
      result.valid = false;
      result.errors.push(`Missing or empty mandatory block: @${block}`);
    }
  }

  // BONDS with bilingual alias support
  const hasBonds = BONDS_ALIASES.some(
    alias => soul.blocks[alias] && Object.keys(soul.blocks[alias]).length > 0
  );
  if (!hasBonds) {
    result.valid = false;
    result.errors.push('Missing mandatory block: @BONDS (or @BEZIEHUNG/@RELATIONSHIP)');
  }

  // ── Block Content Validation ──

  // META: should have project and model identifiers
  if (soul.blocks.META && Object.keys(soul.blocks.META).length > 0) {
    const meta = soul.blocks.META;
    if (!meta.projekt && !meta.project && !meta.v) {
      result.warnings.push('@META: missing project identifier (projekt/project)');
    }
    if (!meta.modell && !meta.model) {
      result.warnings.push('@META: missing model identifier (modell/model)');
    }
  }

  // KERN: must have numbered axioms
  if (soul.blocks.KERN && Object.keys(soul.blocks.KERN).length > 0) {
    const axiomKeys = Object.keys(soul.blocks.KERN).filter(k => /^\d+$/.test(k));
    if (axiomKeys.length === 0) {
      result.valid = false;
      result.errors.push('@KERN: no numbered axioms found (expected 1:..., 2:..., etc.)');
    } else if (axiomKeys.length < 3) {
      result.warnings.push(`@KERN: only ${axiomKeys.length} axiom(s) — typically 5-7`);
    }
  }

  // SELF: should have some identity marker
  if (soul.blocks.SELF && Object.keys(soul.blocks.SELF).length > 0) {
    const self = soul.blocks.SELF;
    if (!self.name && !self.bin && !self.am) {
      result.warnings.push('@SELF: no identity markers found (name, bin, or am)');
    }
  }

  // STATE: should have a state/zustand indicator
  if (soul.blocks.STATE && Object.keys(soul.blocks.STATE).length > 0) {
    const state = soul.blocks.STATE;
    if (!state.zustand && !state.state && !state.mood) {
      result.warnings.push('@STATE: no state indicator found (zustand/state/mood)');
    }
  }

  // MEM: check for tagged entries (informational — new souls may not have them yet)
  if (soul.blocks.MEM && Object.keys(soul.blocks.MEM).length > 0) {
    const memEntries = Object.keys(soul.blocks.MEM);
    const hasTaggedEntries = memEntries.some(k =>
      /\[(kern|core|aktiv|active|archiv|archive)/.test(k)
    );
    if (!hasTaggedEntries) {
      result.warnings.push('@MEM: no tagged entries found ([kern], [aktiv], [archiv])');
    }
  }

  return result;
}

/**
 * Validate seed content and optionally emit failure event via event bus.
 *
 * @param {string} content - Raw SEED.md content
 * @param {Object} [options]
 * @param {Object} [options.bus] - SoulEventBus instance for event emission
 * @param {string} [options.source] - Source identifier for event payload
 * @returns {ValidationResult}
 */
export function validateSeedWithEvents(content, { bus, source } = {}) {
  const result = validateSeed(content);

  if (!result.valid && bus) {
    bus.safeEmit('seed.validation-failed', {
      source: source || 'seed-validator',
      errors: result.errors,
      warnings: result.warnings,
    });
  }

  return result;
}
