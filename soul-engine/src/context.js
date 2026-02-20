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
    this.seed = await readFile(
      resolve(this.soulPath, 'SEED.md'), 'utf-8'
    );

    const langPath = resolve(this.soulPath, '.language');
    if (existsSync(langPath)) {
      const raw = await readFile(langPath, 'utf-8');
      this.language = raw.includes('en') ? 'en' : 'de';
    }

    this.soulDir = this.language === 'en' ? 'soul' : 'seele';
    this.memoryDir = this.language === 'en' ? 'memories' : 'erinnerungen';
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
