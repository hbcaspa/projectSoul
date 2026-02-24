/**
 * State Versioning — git-based version control for soul state files.
 *
 * Automatically commits soul file changes triggered by engine events.
 * Provides history, diff, timeline, and rollback capabilities.
 *
 * Design:
 * - Listens to bus events (memory, heartbeat, interest, personal, seed)
 * - Debounces rapid changes into batched commits (60s window)
 * - Uses execFile (not exec) for safe git subprocess calls
 * - All operations are best-effort: git failures never crash the engine
 */

import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { diffSeedsWithEvents } from './seed-diff.js';

const execFile = promisify(execFileCb);

const DEBOUNCE_MS = 60_000;
const GITIGNORE_ENTRIES = [
  '.env',
  '.mcp.json',
  'node_modules/',
  '.soul-events/',
  '.soul-pulse',
  '.soul-mood',
  '.soul-state-tick',
  '.soul-memory.db',
  '.soul-memory.db-journal',
  '.soul-memory.db-wal',
  '.session-active',
  '*.enc',
];

export class StateVersioner {
  constructor({ soulPath, bus }) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.gitAvailable = false;

    // Debounce state
    this._pendingChanges = [];
    this._debounceTimer = null;
    this._flushing = false;
  }

  // ── Initialization ──────────────────────────────────────

  /**
   * Check git availability, initialize repo if needed,
   * set up .gitignore, and make an initial commit for fresh repos.
   */
  async init() {
    // Check if git is installed
    try {
      await execFile('git', ['--version']);
      this.gitAvailable = true;
    } catch {
      console.error('  [versioning] git not found — state versioning disabled');
      return false;
    }

    // Initialize repo if missing
    const gitDir = resolve(this.soulPath, '.git');
    const freshInit = !existsSync(gitDir);

    if (freshInit) {
      try {
        await this._git('init');
        console.log('  [versioning] Initialized git repository');
      } catch (err) {
        console.error(`  [versioning] git init failed: ${err.message}`);
        this.gitAvailable = false;
        return false;
      }
    }

    // Create or update .gitignore
    await this._ensureGitignore();

    // Initial commit for fresh repos
    if (freshInit) {
      try {
        await this._git('add', '-A');
        const { stdout } = await execFile(
          'git', ['status', '--porcelain'],
          { cwd: this.soulPath }
        );
        if (stdout.trim()) {
          await this._git('commit', '-m', '[init] Soul state versioning initialized');
          console.log('  [versioning] Initial commit created');
        }
      } catch (err) {
        console.error(`  [versioning] Initial commit failed: ${err.message}`);
      }
    }

    console.log(`  [versioning] ${freshInit ? 'New' : 'Existing'} repo at ${this.soulPath}`);
    return true;
  }

  /**
   * Register event bus listeners that trigger debounced commits.
   * Call after init().
   */
  registerListeners() {
    if (!this.bus || !this.gitAvailable) return;

    this.bus.on('memory.written', (event) => {
      const detail = event.note
        ? event.note.substring(0, 80)
        : 'Memory updated';
      this._queueCommit('memory', detail);
    });

    this.bus.on('heartbeat.completed', () => {
      this._queueCommit('heartbeat', 'Autonomous pulse');
    });

    this.bus.on('interest.routed', () => {
      this._queueCommit('interest', 'Updated interests');
    });

    this.bus.on('personal.detected', (event) => {
      const who = event.userName || 'someone';
      this._queueCommit('personal', `New insight about ${who}`);
    });

    this.bus.on('state.committed', () => {
      this._queueCommit('seed', 'Consolidated');
    });

    console.log('  [versioning] Listening for 5 event types');
  }

  // ── Debounce Mechanism ──────────────────────────────────

  /**
   * Queue a change for batched commit.
   * Accumulates events for DEBOUNCE_MS, then commits all at once.
   */
  _queueCommit(type, detail) {
    if (!this.gitAvailable) return;

    this._pendingChanges.push({ type, detail, ts: Date.now() });

    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._flushCommits(), DEBOUNCE_MS);
  }

  /**
   * Flush all pending changes into a single git commit.
   * Builds a combined commit message from accumulated events.
   */
  async _flushCommits() {
    if (this._pendingChanges.length === 0) return;
    if (this._flushing) return;
    this._flushing = true;

    try {
      const changes = [...this._pendingChanges];
      this._pendingChanges = [];
      this._debounceTimer = null;

      // Build combined message
      const types = [...new Set(changes.map(c => c.type))];
      const message = types.length === 1
        ? `[${types[0]}] ${changes[0].detail}`
        : `[auto] ${changes.length} changes: ${types.join(', ')}`;

      await this.autoCommit(message);
    } finally {
      this._flushing = false;

      // If more events arrived while flushing, schedule another flush
      if (this._pendingChanges.length > 0) {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => this._flushCommits(), DEBOUNCE_MS);
      }
    }
  }

  // ── Core Git Operations ─────────────────────────────────

  /**
   * Stage all changes and commit if there are any.
   * Uses execFile for safety — no shell injection possible.
   *
   * @param {string} message - The commit message
   * @returns {string|null} The commit hash, or null if nothing to commit
   */
  async autoCommit(message) {
    if (!this.gitAvailable) return null;

    try {
      // Capture SEED.md before staging for drift detection
      let seedBefore = null;
      const seedPath = resolve(this.soulPath, 'SEED.md');
      const seedChanged = await this._isSeedDirty();
      if (seedChanged) {
        try {
          const committed = await this._git('show', 'HEAD:SEED.md');
          seedBefore = committed;
        } catch {
          // First commit or SEED.md not yet tracked — no diff possible
        }
      }

      // Stage all changes
      await this._git('add', '-A');

      // Check if there are staged changes
      const status = await this._git('status', '--porcelain');
      if (!status) return null;

      // Commit
      await this._git('commit', '-m', message);

      // Get the new commit hash
      const hash = await this._git('rev-parse', '--short', 'HEAD');
      console.log(`  [versioning] Committed ${hash}: ${message}`);

      this.bus?.safeEmit('state.versioned', {
        source: 'state-versioning',
        hash,
        message,
      });

      // Run seed drift detection after commit
      if (seedBefore && existsSync(seedPath)) {
        try {
          const seedAfter = await readFile(seedPath, 'utf-8');
          diffSeedsWithEvents(seedBefore, seedAfter, {
            bus: this.bus,
            source: 'state-versioning',
          });
        } catch {
          // Drift detection is best-effort
        }
      }

      return hash;
    } catch (err) {
      console.error(`  [versioning] Commit failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Check if SEED.md has uncommitted changes.
   * @returns {boolean}
   */
  async _isSeedDirty() {
    try {
      const status = await this._git('status', '--porcelain', 'SEED.md');
      return status.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get commit history, optionally filtered to a specific file.
   *
   * @param {string} [filePath] - Relative path within soulPath to filter by
   * @param {number} [limit=20] - Maximum number of entries to return
   * @returns {Array<{hash: string, date: string, message: string}>}
   */
  async getHistory(filePath, limit = 20) {
    if (!this.gitAvailable) return [];

    try {
      const args = [
        'log',
        `--pretty=format:%H|%ai|%s`,
        `-n`, String(limit),
      ];

      if (filePath) {
        args.push('--', filePath);
      }

      const output = await this._git(...args);
      if (!output) return [];

      return output.split('\n').filter(Boolean).map(line => {
        const [hash, date, ...messageParts] = line.split('|');
        return { hash, date, message: messageParts.join('|') };
      });
    } catch (err) {
      console.error(`  [versioning] getHistory failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Get the diff (stat + patch) for a specific commit.
   *
   * @param {string} hash - The commit hash
   * @returns {string} The diff output
   */
  async getDiff(hash) {
    if (!this.gitAvailable) return '';

    try {
      // Validate hash format to prevent injection via args
      if (!/^[a-f0-9]{4,40}$/.test(hash)) {
        throw new Error(`Invalid commit hash: ${hash}`);
      }

      return await this._git('show', '--stat', '--patch', hash);
    } catch (err) {
      console.error(`  [versioning] getDiff failed: ${err.message}`);
      return '';
    }
  }

  /**
   * Get a timeline of commits grouped by date.
   *
   * @param {string} since - Git date string (e.g. "7 days ago", "2026-02-15")
   * @returns {Object} { [date]: [{ hash, time, message }] }
   */
  async getTimeline(since) {
    if (!this.gitAvailable) return {};

    try {
      const output = await this._git(
        'log',
        `--pretty=format:%H|%ai|%s`,
        `--since=${since}`,
      );

      if (!output) return {};

      const timeline = {};

      for (const line of output.split('\n').filter(Boolean)) {
        const [hash, datetime, ...messageParts] = line.split('|');
        const message = messageParts.join('|');

        // datetime format: "2026-02-22 14:30:00 +0100"
        const [date, time] = datetime.trim().split(' ');

        if (!timeline[date]) timeline[date] = [];
        timeline[date].push({ hash, time, message });
      }

      return timeline;
    } catch (err) {
      console.error(`  [versioning] getTimeline failed: ${err.message}`);
      return {};
    }
  }

  /**
   * Revert a specific commit by creating a new revert commit.
   * This is safe — it does not rewrite history.
   *
   * @param {string} hash - The commit hash to revert
   * @returns {string|null} The new revert commit hash, or null on failure
   */
  async rollback(hash) {
    if (!this.gitAvailable) return null;

    try {
      // Validate hash format
      if (!/^[a-f0-9]{4,40}$/.test(hash)) {
        throw new Error(`Invalid commit hash: ${hash}`);
      }

      await this._git('revert', '--no-edit', hash);

      const newHash = await this._git('rev-parse', '--short', 'HEAD');
      console.log(`  [versioning] Reverted ${hash} → new commit ${newHash}`);

      this.bus?.safeEmit('state.rolled-back', {
        source: 'state-versioning',
        revertedHash: hash,
        newHash,
      });

      return newHash;
    } catch (err) {
      console.error(`  [versioning] Rollback failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Force-flush the debounce buffer and create a final session-end commit.
   * Called during engine shutdown.
   */
  async finalCommit() {
    if (!this.gitAvailable) return;

    // Clear any pending debounce timer
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }

    // Flush any pending changes first
    if (this._pendingChanges.length > 0) {
      // Temporarily disable flushing guard for direct flush
      const wasFlushingFlag = this._flushing;
      this._flushing = false;
      await this._flushCommits();
      this._flushing = wasFlushingFlag;
    }

    // Final session commit
    await this.autoCommit('[session] Session ended');
  }

  // ── Internal Helpers ────────────────────────────────────

  /**
   * Execute a git command safely using execFile.
   * All commands run in the soul directory.
   *
   * @param {...string} args - Arguments to pass to git
   * @returns {string} Trimmed stdout
   */
  async _git(...args) {
    const { stdout } = await execFile('git', args, {
      cwd: this.soulPath,
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024, // 10MB for large diffs
    });
    return stdout.trim();
  }

  /**
   * Ensure .gitignore exists and contains all required entries.
   * Merges with existing entries if the file already exists.
   */
  async _ensureGitignore() {
    const gitignorePath = resolve(this.soulPath, '.gitignore');
    let existing = new Set();

    if (existsSync(gitignorePath)) {
      const content = await readFile(gitignorePath, 'utf-8');
      existing = new Set(
        content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
      );
    }

    // Merge required entries
    let changed = false;
    for (const entry of GITIGNORE_ENTRIES) {
      if (!existing.has(entry)) {
        existing.add(entry);
        changed = true;
      }
    }

    if (changed) {
      const header = '# Soul Protocol — auto-managed by soul-engine\n';
      const content = header + [...existing].join('\n') + '\n';
      await writeFile(gitignorePath, content);
    }
  }
}
