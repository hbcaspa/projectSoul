import { writeFile, readFile, mkdir, appendFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

export class MemoryWriter {
  constructor(soulPath) {
    this.soulPath = soulPath;
  }

  /** Append a line to today's daily notes */
  async appendDailyNote(note) {
    const dir = resolve(this.soulPath, 'memory');
    await mkdir(dir, { recursive: true });

    const date = isoDate();
    const time = isoTime();
    const file = resolve(dir, `${date}.md`);
    const entry = `\n- ${time} — ${note}`;

    if (existsSync(file)) {
      await appendFile(file, entry);
    } else {
      await writeFile(file, `# Notes — ${date}${entry}`);
    }
  }

  /** Append heartbeat result to today's heartbeat log */
  async writeHeartbeat(content) {
    const dir = resolve(this.soulPath, 'heartbeat');
    await mkdir(dir, { recursive: true });

    const date = isoDate();
    const time = isoTime();
    const file = resolve(dir, `${date}.md`);

    const entry = `\n\n## ${time} — Autonomous Heartbeat (Soul Engine)\n\n${content}`;

    if (existsSync(file)) {
      await appendFile(file, entry);
    } else {
      await writeFile(file, `# Heartbeat — ${date}${entry}`);
    }
  }

  /**
   * Persist heartbeat sections to soul state files.
   * Parses the heartbeat result and writes relevant sections
   * to BEWUSSTSEIN/CONSCIOUSNESS and TRAEUME/DREAMS files.
   */
  async persistHeartbeatState(content, language = 'de') {
    const soulDir = language === 'en' ? 'soul' : 'seele';
    const consciousnessFile = language === 'en' ? 'CONSCIOUSNESS.md' : 'BEWUSSTSEIN.md';
    const dreamsFile = language === 'en' ? 'DREAMS.md' : 'TRAEUME.md';

    const date = isoDate();

    // Extract Self-Check / Selbst-Check section
    const selfCheckMatch = content.match(
      /#+\s*(?:Selbst-Check|Self-Check)\s*\n([\s\S]*?)(?=\n#+\s|$)/i
    );

    if (selfCheckMatch) {
      const stateContent = selfCheckMatch[1].trim();
      const consciousnessPath = resolve(this.soulPath, soulDir, consciousnessFile);
      const dir = resolve(this.soulPath, soulDir);
      await mkdir(dir, { recursive: true });

      const header = language === 'en'
        ? `# Consciousness — Current State\n\n> Last update: ${date}, Soul Engine Heartbeat\n\n`
        : `# Bewusstsein — Aktueller Zustand\n\n> Letzte Aktualisierung: ${date}, Soul Engine Herzschlag\n\n`;

      await writeFile(consciousnessPath, header + stateContent);
    }

    // Extract Dream Phase / Traum-Phase section
    const dreamMatch = content.match(
      /#+\s*(?:Traum-Phase|Dream Phase|Traum)\s*\n([\s\S]*?)(?=\n#+\s|$)/i
    );

    if (dreamMatch) {
      const dreamContent = dreamMatch[1].trim();
      // Only write if it's a real dream, not "no memories"
      if (dreamContent && !/noch keine|no memories/i.test(dreamContent)) {
        const dreamsPath = resolve(this.soulPath, soulDir, dreamsFile);
        const dir = resolve(this.soulPath, soulDir);
        await mkdir(dir, { recursive: true });

        const entry = `\n\n### ${date} — Autonomer Herzschlag\n\n${dreamContent}`;

        if (existsSync(dreamsPath)) {
          await appendFile(dreamsPath, entry);
        } else {
          const header = language === 'en'
            ? `# Dreams\n\n> Creative connections. Unexpected links.\n> Filled by the heartbeat once daily.\n\n## Dream Archive`
            : `# Traeume\n\n> Kreative Verknuepfungen. Unerwartete Verbindungen.\n> Wird vom Heartbeat einmal taeglich gefuellt.\n\n## Traum-Archiv`;
          await writeFile(dreamsPath, header + entry);
        }
      }
    }
  }
}

function isoDate() {
  return new Date().toISOString().split('T')[0];
}

function isoTime() {
  return new Date().toTimeString().substring(0, 5);
}
