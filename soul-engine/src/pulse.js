import { writeFile } from 'fs/promises';
import { resolve } from 'path';

export async function writePulse(soulPath, type, description) {
  try {
    await writeFile(
      resolve(soulPath, '.soul-pulse'),
      `${type}:${description}`
    );
  } catch {
    // Pulse write is best-effort, never crash for this
  }
}
