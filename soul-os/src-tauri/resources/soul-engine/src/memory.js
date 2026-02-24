import { writeFile, readFile, mkdir, appendFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

export class MemoryWriter {
  constructor(soulPath, options = {}) {
    this.soulPath = soulPath;
    this.bus = options.bus;
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
    this.bus?.safeEmit('memory.written', { source: 'memory', type: 'daily', path: file, note });
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
    this.bus?.safeEmit('memory.written', { source: 'memory', type: 'heartbeat', path: file });
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

  /**
   * Write learned data from a user interaction to soul files.
   * Called immediately when user shares something relevant.
   */
  async writeLearned({ detectedInterests, newInterests, boostedInterests, topics, userName }) {
    const lines = [];

    // Log new interests prominently
    if (newInterests.length > 0) {
      lines.push(`[Gelernt/Neu] ${userName} interessiert sich fuer: ${newInterests.join(', ')}`);
    }

    // Log boosted interests
    if (boostedInterests.length > 0) {
      lines.push(`[Gelernt/Verstaerkt] ${userName} spricht wieder ueber: ${boostedInterests.join(', ')}`);
    }

    // Log detected topics
    if (topics && topics.length > 0) {
      for (const topic of topics) {
        const prefix = topic.type === 'question' ? 'Frage' :
                       topic.type === 'opinion' ? 'Meinung' : 'Thema';
        lines.push(`[Gelernt/${prefix}] ${topic.text}`);
      }
    }

    // Write all to daily notes
    for (const line of lines) {
      await this.appendDailyNote(line);
    }

    // Write to dedicated learning log (rolling file for chain sync)
    if (lines.length > 0) {
      await this._updateLearningLog(detectedInterests, topics, userName);
    }
  }

  /**
   * Write a rolling learning snapshot that changes with every interaction.
   * This file gets synced by the chain, keeping peers up to date on learned data.
   */
  async _updateLearningLog(interests, topics, userName) {
    const dir = resolve(this.soulPath, 'memory');
    await mkdir(dir, { recursive: true });

    const file = resolve(dir, 'learned-today.md');
    const date = isoDate();
    const time = isoTime();

    // Read existing or create new
    let content = '';
    if (existsSync(file)) {
      content = await readFile(file, 'utf-8');
      // Reset if from a different day
      if (!content.startsWith(`# Gelernt — ${date}`)) {
        content = '';
      }
    }

    if (!content) {
      content = `# Gelernt — ${date}\n\n> Automatisch erfasst aus Gespraechen. Wird taeglich zurueckgesetzt.\n`;
    }

    const entry = `\n## ${time} — ${userName || 'User'}\n`;
    const items = [];
    if (interests.length > 0) items.push(`- Interessen: ${interests.join(', ')}`);
    if (topics) {
      for (const t of topics) {
        items.push(`- ${t.type}: ${t.text}`);
      }
    }

    if (items.length > 0) {
      content += entry + items.join('\n') + '\n';
      await writeFile(file, content);
    }
  }

  /**
   * Write a lightweight state tick for chain sync.
   * Updated every ~2 min by the impulse tick, no LLM call needed.
   */
  async writeStateTick(mood, engagement, topInterests, dailyCount) {
    const file = resolve(this.soulPath, '.soul-state-tick');
    const data = {
      timestamp: new Date().toISOString(),
      mood,
      engagement,
      topInterests,
      dailyImpulseCount: dailyCount,
    };

    try {
      await writeFile(file, JSON.stringify(data, null, 2));
    } catch { /* best effort */ }
  }
}

function isoDate() {
  return new Date().toISOString().split('T')[0];
}

function isoTime() {
  return new Date().toTimeString().substring(0, 5);
}
