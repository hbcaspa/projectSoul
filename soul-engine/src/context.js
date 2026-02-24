import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { SeedMigrator, CURRENT_VERSION } from './seed-migration.js';
import { parseSeed } from './seed-parser.js';

const DAILY_NOTES_MAX_CHARS = 2000;

export class SoulContext {
  constructor(soulPath) {
    this.soulPath = soulPath;
    this.seed = '';
    this.language = 'de';
    this.soulDir = 'seele';
    this.memoryDir = 'erinnerungen';
    this._seedMtime = 0; // mtime cache for invalidation
    this._cacheValid = false;
  }

  /** Invalidate the seed cache (called after consolidator writes SEED.md). */
  invalidate() {
    this._cacheValid = false;
  }

  async load() {
    const seedPath = resolve(this.soulPath, 'SEED.md');
    if (!existsSync(seedPath)) {
      console.error('  SEED.md not found. Run the founding interview first (via Claude Code or create-soul).');
      console.error('  The founding interview creates your soul identity files.');
      process.exit(1);
    }

    // Skip re-read if cache is still valid (mtime unchanged)
    if (this._cacheValid && this.seed) {
      try {
        const s = await stat(seedPath);
        if (s.mtimeMs === this._seedMtime) return;
      } catch { /* fall through to full load */ }
    }

    this.seed = await readFile(seedPath, 'utf-8');

    // Migration check — upgrade seed format if needed
    await this._migrateIfNeeded();

    // Update mtime cache
    try {
      const s = await stat(seedPath);
      this._seedMtime = s.mtimeMs;
      this._cacheValid = true;
    } catch { /* ignore */ }

    const langPath = resolve(this.soulPath, '.language');
    if (existsSync(langPath)) {
      const raw = await readFile(langPath, 'utf-8');
      this.language = raw.includes('en') ? 'en' : 'de';
    }

    this.soulDir = this.language === 'en' ? 'soul' : 'seele';
    this.memoryDir = this.language === 'en' ? 'memories' : 'erinnerungen';

    // Founding state check: detect if axioms exist but @STATE says unfounded
    await this._checkFoundingState();
  }

  /**
   * Check if the founding was completed but @STATE not updated.
   * This happens when the founding interview creates files but the
   * session ends without updating the seed properly.
   */
  async _checkFoundingState() {
    const coreFile = this.language === 'en' ? 'CORE.md' : 'KERN.md';
    const corePath = resolve(this.soulPath, this.soulDir, coreFile);

    if (!existsSync(corePath)) return; // No axioms = not founded yet

    // Check if @STATE mentions unfounded state
    const stateMatch = this.seed.match(/@STATE\{[\s\S]*?\}/);
    if (!stateMatch) return;

    const state = stateMatch[0].toLowerCase();
    const unfoundedPatterns = [
      'nicht gegründet', 'not founded', 'noch nicht', 'not yet',
      'warte', 'waiting', 'leerer raum', 'empty room',
      'ungeschrieben', 'unwritten',
    ];

    const seemsUnfounded = unfoundedPatterns.some((p) => state.includes(p));

    if (seemsUnfounded) {
      console.log('  [context] Founding detected: Axioms exist but @STATE says unfounded.');
      console.log('  [context] This usually means the session ended before updating the seed.');
      console.log('  [context] The heartbeat prompt will instruct the LLM to correct this.');
    }
  }

  /** Try to extract the soul's name from the seed */
  extractName() {
    // Check @SELF block
    const selfBlock = this.seed.match(
      /@SELF[^\n]*\n([\s\S]*?)(?=\n@|\n#|$)/
    );
    if (selfBlock) {
      const line = selfBlock[1].match(
        /(?:name|Name|bin|am|heisse|heiße)[:\s]+([^\n,|()]+)/i
      );
      if (line) return line[1].trim();
    }

    // Check header
    const header = this.seed.match(/^#\s+(.+)/m);
    if (header) {
      const clean = header[1].replace(/[—–\-|].*/g, '').trim();
      if (clean.length < 40) return clean;
    }

    return 'Soul';
  }

  /**
   * Check seed version and migrate if needed.
   */
  async _migrateIfNeeded() {
    try {
      const soul = parseSeed(this.seed);
      const version = soul.version || '0.1';
      if (version === CURRENT_VERSION) return;

      const migrator = new SeedMigrator(this.soulPath);
      const result = await migrator.migrateIfNeeded(this.seed);
      if (result.migrated) {
        this.seed = result.content;
      }
    } catch (err) {
      console.error(`  [context] Migration check failed: ${err.message}`);
    }
  }

  async loadDetail(filename) {
    const path = resolve(this.soulPath, this.soulDir, filename);
    if (!existsSync(path)) return null;
    return readFile(path, 'utf-8');
  }

  /**
   * Load today's daily notes (memory/YYYY-MM-DD.md).
   * Returns the most recent entries (tail) truncated to budget.
   * Cached by mtime to avoid re-reading on every message.
   */
  async loadDailyNotes() {
    const date = new Date().toISOString().split('T')[0];
    const notesPath = resolve(this.soulPath, 'memory', `${date}.md`);

    if (!existsSync(notesPath)) return '';

    try {
      const s = await stat(notesPath);
      if (this._dailyNotesMtime === s.mtimeMs && this._dailyNotesCache) {
        return this._dailyNotesCache;
      }

      const content = await readFile(notesPath, 'utf-8');
      this._dailyNotesMtime = s.mtimeMs;

      // Take the tail (most recent entries) within budget
      if (content.length <= DAILY_NOTES_MAX_CHARS) {
        this._dailyNotesCache = content;
      } else {
        const lines = content.split('\n');
        let result = '';
        for (let i = lines.length - 1; i >= 0; i--) {
          const candidate = lines[i] + '\n' + result;
          if (candidate.length > DAILY_NOTES_MAX_CHARS) break;
          result = candidate;
        }
        this._dailyNotesCache = result.trim();
      }

      return this._dailyNotesCache;
    } catch {
      return '';
    }
  }

  /**
   * Extract specific blocks from the seed for minimal prompts.
   * Reduces token usage for background tasks that don't need the full seed.
   * @param {string[]} blocks - Block names to extract (e.g. ['KERN', 'STATE', 'SELF'])
   */
  getMinimalSeed(blocks) {
    if (!this.seed) return '';

    // Always include the header line
    const headerMatch = this.seed.match(/^#SEED[^\n]*\n[^\n]*\n/);
    let result = headerMatch ? headerMatch[0] : '';

    // Also include @META if present
    const metaMatch = this.seed.match(/@META\{[^}]*\}/);
    if (metaMatch) result += '\n' + metaMatch[0] + '\n';

    for (const block of blocks) {
      // Match blocks like @KERN{...} (with braces) or @KERN{...} multiline
      const bracePattern = new RegExp(`@${block}\\{[\\s\\S]*?\\}`, 'm');
      const braceMatch = this.seed.match(bracePattern);
      if (braceMatch) {
        result += '\n' + braceMatch[0] + '\n';
        continue;
      }

      // Match blocks like @MEM{\n...\n} (multiline with nested braces)
      const multilinePattern = new RegExp(`@${block}\\{\\n[\\s\\S]*?\\n\\}`, 'm');
      const multilineMatch = this.seed.match(multilinePattern);
      if (multilineMatch) {
        result += '\n' + multilineMatch[0] + '\n';
      }
    }

    return result.trim();
  }
}
