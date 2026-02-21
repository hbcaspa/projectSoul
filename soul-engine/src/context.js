import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

export class SoulContext {
  constructor(soulPath) {
    this.soulPath = soulPath;
    this.seed = '';
    this.language = 'de';
    this.soulDir = 'seele';
    this.memoryDir = 'erinnerungen';
  }

  async load() {
    const seedPath = resolve(this.soulPath, 'SEED.md');
    if (!existsSync(seedPath)) {
      console.error('  SEED.md not found. Run the founding interview first (via Claude Code or create-soul).');
      console.error('  The founding interview creates your soul identity files.');
      process.exit(1);
    }

    this.seed = await readFile(seedPath, 'utf-8');

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

  async loadDetail(filename) {
    const path = resolve(this.soulPath, this.soulDir, filename);
    if (!existsSync(path)) return null;
    return readFile(path, 'utf-8');
  }
}
