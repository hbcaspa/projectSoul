/**
 * Seed Version Migration — upgrade seeds between format versions.
 *
 * Migration registry with functions per version jump.
 * Creates backup before migration. Runs automatically when
 * the engine detects a version mismatch on load.
 *
 * Usage:
 *   const migrator = new SeedMigrator(soulPath);
 *   const result = await migrator.migrateIfNeeded(seedContent);
 */

import { writeFile, readFile, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { parseSeed } from './seed-parser.js';
import { validateSeed } from './seed-validator.js';

/** Current expected seed format version. */
export const CURRENT_VERSION = '0.3';

/**
 * Migration registry — each entry is a function that transforms
 * seed content from one version to the next.
 *
 * Key format: "fromVersion→toVersion"
 * Function signature: (seedContent: string) => string
 */
const MIGRATIONS = {
  /**
   * v0.1 → v0.2
   * - Added @INTERESTS block (optional)
   * - Added @CONNECTIONS block (optional)
   * - Added @DREAMS block (optional)
   */
  '0.1→0.2': (content) => {
    // Handle both "#SEED v0.1" and "#SEED" (no version)
    let result = /#SEED v0\.1/.test(content)
      ? content.replace(/#SEED v0\.1/, '#SEED v0.2')
      : content.replace(/#SEED\b/, '#SEED v0.2');

    // Add condensed header if missing
    if (!/#(?:condensed|verdichtet):/.test(result)) {
      const today = new Date().toISOString().split('T')[0];
      result = result.replace(
        /(#(?:born|geboren):[^\s#]+)/,
        `$1 #verdichtet:${today}`
      );
    }

    return result;
  },

  /**
   * v0.2 → v0.3
   * - @MEM entries now support confidence and recurrence tags: [aktiv|c:0.5|r:0]
   * - @BONDS replaces @BEZIEHUNG as canonical block name (both still supported)
   */
  '0.2→0.3': (content) => {
    let result = content.replace(/#SEED v0\.2/, '#SEED v0.3');

    // Add default confidence to MEM entries that lack it
    result = result.replace(
      /^(\s+\[(?:kern|core|aktiv|active|archiv|archive)\])(\d)/gm,
      '$1|c:0.5]$2'
    );

    return result;
  },
};

/**
 * Ordered version chain for determining migration path.
 */
const VERSION_CHAIN = ['0.1', '0.2', '0.3'];

export class SeedMigrator {
  constructor(soulPath, options = {}) {
    this.soulPath = soulPath;
    this.bus = options.bus || null;
    this.seedPath = resolve(soulPath, 'SEED.md');
  }

  /**
   * Check if migration is needed and apply if so.
   *
   * @param {string} seedContent - Current raw SEED.md content
   * @returns {{ migrated: boolean, fromVersion: string|null, toVersion: string, content: string, backupPath: string|null }}
   */
  async migrateIfNeeded(seedContent) {
    const soul = parseSeed(seedContent);
    const currentVersion = soul.version || '0.1';

    if (currentVersion === CURRENT_VERSION) {
      return { migrated: false, fromVersion: null, toVersion: CURRENT_VERSION, content: seedContent, backupPath: null };
    }

    // Check if we can migrate
    const path = this._getMigrationPath(currentVersion, CURRENT_VERSION);
    if (!path || path.length === 0) {
      console.error(`  [seed-migration] No migration path from v${currentVersion} to v${CURRENT_VERSION}`);
      return { migrated: false, fromVersion: currentVersion, toVersion: CURRENT_VERSION, content: seedContent, backupPath: null };
    }

    // Backup before migration
    const backupPath = await this._backup(seedContent, currentVersion);

    // Apply migrations sequentially
    let content = seedContent;
    for (const step of path) {
      const migrationFn = MIGRATIONS[step];
      if (!migrationFn) {
        console.error(`  [seed-migration] Missing migration function: ${step}`);
        return { migrated: false, fromVersion: currentVersion, toVersion: CURRENT_VERSION, content: seedContent, backupPath };
      }

      console.log(`  [seed-migration] Applying ${step}...`);
      content = migrationFn(content);
    }

    // Validate the migrated seed
    const validation = validateSeed(content);
    if (!validation.valid) {
      console.error(`  [seed-migration] Migration result is invalid — rolling back`);
      for (const err of validation.errors) {
        console.error(`    - ${err}`);
      }

      if (this.bus) {
        this.bus.safeEmit('seed.migration-failed', {
          source: 'seed-migration',
          fromVersion: currentVersion,
          toVersion: CURRENT_VERSION,
          errors: validation.errors,
        });
      }

      return { migrated: false, fromVersion: currentVersion, toVersion: CURRENT_VERSION, content: seedContent, backupPath };
    }

    // Write migrated seed
    await this._writeSeed(content);

    if (this.bus) {
      this.bus.safeEmit('seed.migrated', {
        source: 'seed-migration',
        fromVersion: currentVersion,
        toVersion: CURRENT_VERSION,
      });
    }

    console.log(`  [seed-migration] Migrated v${currentVersion} → v${CURRENT_VERSION}`);
    return { migrated: true, fromVersion: currentVersion, toVersion: CURRENT_VERSION, content, backupPath };
  }

  /**
   * Get the ordered migration steps from one version to another.
   * @returns {string[]|null} Array of "from→to" keys, or null if no path exists
   */
  _getMigrationPath(from, to) {
    const fromIdx = VERSION_CHAIN.indexOf(from);
    const toIdx = VERSION_CHAIN.indexOf(to);

    if (fromIdx === -1 || toIdx === -1 || fromIdx >= toIdx) return null;

    const steps = [];
    for (let i = fromIdx; i < toIdx; i++) {
      steps.push(`${VERSION_CHAIN[i]}→${VERSION_CHAIN[i + 1]}`);
    }
    return steps;
  }

  /**
   * Backup the current seed before migration.
   */
  async _backup(content, version) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `SEED.md.backup-v${version}-${ts}`;
    const backupPath = resolve(this.soulPath, backupName);
    await writeFile(backupPath, content, 'utf-8');
    console.log(`  [seed-migration] Backup: ${backupName}`);
    return backupPath;
  }

  async _writeSeed(content) {
    const tmpPath = resolve(this.soulPath, 'SEED.md.tmp');
    await writeFile(tmpPath, content, 'utf-8');
    const { rename } = await import('fs/promises');
    await rename(tmpPath, this.seedPath);
  }
}

/**
 * Get the list of available migration steps.
 * Useful for testing and debugging.
 */
export function getAvailableMigrations() {
  return Object.keys(MIGRATIONS);
}

/**
 * Get the current expected version.
 */
export function getCurrentVersion() {
  return CURRENT_VERSION;
}
