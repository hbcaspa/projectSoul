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
}

function isoDate() {
  return new Date().toISOString().split('T')[0];
}

function isoTime() {
  return new Date().toTimeString().substring(0, 5);
}
