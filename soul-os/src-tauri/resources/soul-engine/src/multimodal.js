/**
 * Multimodal Memory Store — media storage linked to soul memories.
 *
 * Storage: {soulPath}/media/YYYY-MM-DD/{uuid}.{ext}
 * Metadata: stored in MemoryDB `media` table
 *
 * Supported: image (png/jpg/gif/webp), audio (mp3/ogg/wav/m4a), document (pdf/txt)
 * Size limit: 1MB per file
 */

import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

const MAX_FILE_SIZE = 1 * 1024 * 1024;

const SUPPORTED_TYPES = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
  audio: ['.mp3', '.ogg', '.wav', '.m4a'],
  document: ['.pdf', '.txt'],
};

function detectMediaType(ext) {
  for (const [type, exts] of Object.entries(SUPPORTED_TYPES)) {
    if (exts.includes(ext.toLowerCase())) return type;
  }
  return null;
}

export class MultimodalStore {
  constructor({ soulPath, db, bus }) {
    this.soulPath = soulPath;
    this.db = db || null;
    this.bus = bus || null;
    this.mediaDir = resolve(soulPath, 'media');
  }

  init() {
    if (!existsSync(this.mediaDir)) mkdirSync(this.mediaDir, { recursive: true });

    if (this.db && this.db.db) {
      this.db.db.exec(`
        CREATE TABLE IF NOT EXISTS media (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id INTEGER,
          type TEXT NOT NULL DEFAULT 'image',
          path TEXT NOT NULL,
          description TEXT DEFAULT '',
          metadata TEXT DEFAULT '{}',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_media_memory ON media(memory_id);
        CREATE INDEX IF NOT EXISTS idx_media_type ON media(type);
      `);
    }

    return this;
  }

  async storeImage(buffer, { source = 'unknown', description = '', memoryId = null, ext = '.png' } = {}) {
    return this._storeFile(buffer, { type: 'image', source, description, memoryId, ext });
  }

  async storeAudioRef(audioPath, { transcription = '', memoryId = null } = {}) {
    if (!this.db || !this.db.db) return { mediaId: null, path: audioPath, memoryId };

    const info = this.db.db.prepare(
      `INSERT INTO media (memory_id, type, path, description, metadata) VALUES (?, 'audio', ?, ?, ?)`
    ).run(memoryId, audioPath, transcription, JSON.stringify({ originalPath: audioPath }));

    if (this.bus) {
      this.bus.safeEmit('media.stored', {
        source: 'multimodal', type: 'audio',
        mediaId: info.lastInsertRowid, memoryId,
        description: transcription.substring(0, 100),
      });
    }

    return { mediaId: info.lastInsertRowid, path: audioPath, memoryId };
  }

  getMediaForMemory(memoryId) {
    if (!this.db || !this.db.db) return [];
    return this.db.db.prepare('SELECT * FROM media WHERE memory_id = ? ORDER BY created_at DESC')
      .all(memoryId).map(this._parseMediaRow);
  }

  searchMedia(query, limit = 20) {
    if (!this.db || !this.db.db) return [];
    return this.db.db.prepare('SELECT * FROM media WHERE description LIKE ? ORDER BY created_at DESC LIMIT ?')
      .all(`%${query}%`, limit).map(this._parseMediaRow);
  }

  getStats() {
    if (!this.db || !this.db.db) return { total: 0, byType: {} };
    const total = this.db.db.prepare('SELECT COUNT(*) as count FROM media').get()?.count || 0;
    const byType = {};
    for (const row of this.db.db.prepare('SELECT type, COUNT(*) as count FROM media GROUP BY type').all()) {
      byType[row.type] = row.count;
    }
    return { total, byType };
  }

  async deleteMedia(mediaId) {
    if (!this.db || !this.db.db) return false;
    const media = this.db.db.prepare('SELECT * FROM media WHERE id = ?').get(mediaId);
    if (!media) return false;
    try { if (existsSync(media.path)) await unlink(media.path); } catch { /* ok */ }
    this.db.db.prepare('DELETE FROM media WHERE id = ?').run(mediaId);
    return true;
  }

  async _storeFile(buffer, { type, source, description, memoryId, ext }) {
    if (buffer.length > MAX_FILE_SIZE) throw new Error(`File too large: ${buffer.length} bytes (max: ${MAX_FILE_SIZE})`);

    const mediaType = detectMediaType(ext);
    if (!mediaType) throw new Error(`Unsupported file extension: ${ext}`);

    const date = new Date().toISOString().split('T')[0];
    const dir = resolve(this.mediaDir, date);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });

    const filename = `${randomUUID()}${ext}`;
    const filePath = resolve(dir, filename);
    await writeFile(filePath, buffer);

    let mediaId = null;
    if (this.db && this.db.db) {
      const info = this.db.db.prepare(
        `INSERT INTO media (memory_id, type, path, description, metadata) VALUES (?, ?, ?, ?, ?)`
      ).run(memoryId, type, filePath, description, JSON.stringify({ source, originalExt: ext, size: buffer.length }));
      mediaId = info.lastInsertRowid;
    }

    if (this.bus) {
      this.bus.safeEmit('media.stored', {
        source: 'multimodal', type, mediaId, memoryId,
        description: description.substring(0, 100),
      });
    }

    return { mediaId, path: filePath, memoryId };
  }

  _parseMediaRow(row) {
    return { ...row, metadata: JSON.parse(row.metadata || '{}') };
  }
}
