/**
 * Hybrid Memory Layer — SQLite + Vector search for soul memories.
 *
 * Schema:
 *   memories(id, type, source, content, embedding BLOB, metadata JSON, created_at, confidence REAL, tags TEXT)
 *   interactions(id, channel, user, message, response, mood_valence, mood_energy, timestamp, feedback_score)
 *   entities(id, name, type, observations JSON, updated_at)
 *   relations(id, from_entity, to_entity, relation_type, created_at)
 */

import Database from 'better-sqlite3';
import { resolve } from 'path';
import { existsSync, readFileSync, mkdirSync } from 'fs';

const DB_FILENAME = '.soul-memory.db';

export class MemoryDB {
  constructor(soulPath, { bus } = {}) {
    this.soulPath = soulPath;
    this.bus = bus || null;
    this.dbPath = resolve(soulPath, DB_FILENAME);
    this.db = null;
  }

  init() {
    const dir = resolve(this.soulPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._createSchema();
    return this;
  }

  _createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL DEFAULT 'general',
        source TEXT NOT NULL DEFAULT 'unknown',
        content TEXT NOT NULL,
        embedding BLOB,
        metadata TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        confidence REAL NOT NULL DEFAULT 0.5,
        tags TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL DEFAULT 'unknown',
        user TEXT NOT NULL DEFAULT 'unknown',
        message TEXT NOT NULL,
        response TEXT DEFAULT '',
        mood_valence REAL DEFAULT 0.0,
        mood_energy REAL DEFAULT 0.5,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        feedback_score REAL DEFAULT 0.0
      );

      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'concept',
        observations TEXT DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_entity TEXT NOT NULL,
        to_entity TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(from_entity, to_entity, relation_type)
      );

      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
      CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);
      CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags);
      CREATE INDEX IF NOT EXISTS idx_interactions_channel ON interactions(channel);
      CREATE INDEX IF NOT EXISTS idx_interactions_user ON interactions(user);
      CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON interactions(timestamp);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_relations_from ON relations(from_entity);
      CREATE INDEX IF NOT EXISTS idx_relations_to ON relations(to_entity);
    `);
  }

  // ── Memory CRUD ────────────────────────────────────────

  insertMemory({ type = 'general', source = 'unknown', content, embedding = null, metadata = {}, confidence = 0.5, tags = '' }) {
    const stmt = this.db.prepare(`
      INSERT INTO memories (type, source, content, embedding, metadata, confidence, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(type, source, content, embedding, JSON.stringify(metadata), confidence, tags);
    if (this.bus) this.bus.safeEmit('memory.indexed', { source: 'memory-db', memoryId: info.lastInsertRowid, type });
    return info.lastInsertRowid;
  }

  searchStructured({ type, source, tags, since, until, minConfidence = 0, limit = 20, offset = 0 } = {}) {
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const params = [];

    if (type) { sql += ' AND type = ?'; params.push(type); }
    if (source) { sql += ' AND source = ?'; params.push(source); }
    if (tags) { sql += ' AND tags LIKE ?'; params.push(`%${tags}%`); }
    if (since) { sql += ' AND created_at >= ?'; params.push(since); }
    if (until) { sql += ' AND created_at <= ?'; params.push(until); }
    if (minConfidence > 0) { sql += ' AND confidence >= ?'; params.push(minConfidence); }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return this.db.prepare(sql).all(...params).map(this._parseMemoryRow);
  }

  searchSemantic(queryEmbedding, { limit = 10, minSimilarity = 0.3 } = {}) {
    // Get all memories with embeddings
    const rows = this.db.prepare('SELECT * FROM memories WHERE embedding IS NOT NULL').all();

    // Compute cosine similarity and rank
    const results = rows
      .map(row => {
        const stored = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
        const similarity = cosineSimilarity(queryEmbedding, stored);
        return { ...this._parseMemoryRow(row), similarity };
      })
      .filter(r => r.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return results;
  }

  updateConfidence(memoryId, newConfidence) {
    const clamped = Math.max(0, Math.min(1, newConfidence));
    this.db.prepare('UPDATE memories SET confidence = ? WHERE id = ?').run(clamped, memoryId);
  }

  deleteMemory(memoryId) {
    this.db.prepare('DELETE FROM memories WHERE id = ?').run(memoryId);
  }

  // ── Interaction CRUD ───────────────────────────────────

  insertInteraction({ channel, user, message, response = '', moodValence = 0, moodEnergy = 0.5, feedbackScore = 0 }) {
    const stmt = this.db.prepare(`
      INSERT INTO interactions (channel, user, message, response, mood_valence, mood_energy, feedback_score)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(channel, user, message, response, moodValence, moodEnergy, feedbackScore).lastInsertRowid;
  }

  getInteractionHistory({ channel, user, limit = 50, since } = {}) {
    let sql = 'SELECT * FROM interactions WHERE 1=1';
    const params = [];
    if (channel) { sql += ' AND channel = ?'; params.push(channel); }
    if (user) { sql += ' AND user = ?'; params.push(user); }
    if (since) { sql += ' AND timestamp >= ?'; params.push(since); }
    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    return this.db.prepare(sql).all(...params);
  }

  updateFeedbackScore(interactionId, score) {
    this.db.prepare('UPDATE interactions SET feedback_score = ? WHERE id = ?').run(score, interactionId);
  }

  // ── Entity CRUD ────────────────────────────────────────

  upsertEntity({ name, type = 'concept', observations = [] }) {
    const existing = this.db.prepare('SELECT * FROM entities WHERE name = ?').get(name);
    if (existing) {
      const current = JSON.parse(existing.observations || '[]');
      const merged = [...new Set([...current, ...observations])];
      this.db.prepare(`UPDATE entities SET type = ?, observations = ?, updated_at = datetime('now') WHERE name = ?`)
        .run(type, JSON.stringify(merged), name);
      return existing.id;
    }
    return this.db.prepare('INSERT INTO entities (name, type, observations) VALUES (?, ?, ?)')
      .run(name, type, JSON.stringify(observations)).lastInsertRowid;
  }

  getEntity(name) {
    const row = this.db.prepare('SELECT * FROM entities WHERE name = ?').get(name);
    if (!row) return null;
    return { ...row, observations: JSON.parse(row.observations || '[]') };
  }

  searchEntities(query, { limit = 20 } = {}) {
    return this.db.prepare(
      'SELECT * FROM entities WHERE name LIKE ? OR observations LIKE ? ORDER BY updated_at DESC LIMIT ?'
    ).all(`%${query}%`, `%${query}%`, limit)
      .map(r => ({ ...r, observations: JSON.parse(r.observations || '[]') }));
  }

  // ── Relation CRUD ──────────────────────────────────────

  insertRelation({ from, to, relationType }) {
    try {
      return this.db.prepare(
        'INSERT OR IGNORE INTO relations (from_entity, to_entity, relation_type) VALUES (?, ?, ?)'
      ).run(from, to, relationType).lastInsertRowid;
    } catch { return null; }
  }

  getRelationsFor(entityName) {
    const outgoing = this.db.prepare('SELECT * FROM relations WHERE from_entity = ?').all(entityName);
    const incoming = this.db.prepare('SELECT * FROM relations WHERE to_entity = ?').all(entityName);
    return { outgoing, incoming };
  }

  // ── Sync from Files ────────────────────────────────────

  syncFromKnowledgeGraph() {
    const kgPath = resolve(this.soulPath, 'knowledge-graph.jsonl');
    if (!existsSync(kgPath)) return { entities: 0, relations: 0 };

    const lines = readFileSync(kgPath, 'utf-8').split('\n').filter(Boolean);
    let entityCount = 0;
    let relationCount = 0;

    const insertEntity = this.db.prepare(
      `INSERT OR REPLACE INTO entities (name, type, observations, updated_at) VALUES (?, ?, ?, datetime('now'))`
    );
    const insertRelation = this.db.prepare(
      'INSERT OR IGNORE INTO relations (from_entity, to_entity, relation_type) VALUES (?, ?, ?)'
    );

    const txn = this.db.transaction(() => {
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'entity') {
            insertEntity.run(entry.name, entry.entityType || 'concept', JSON.stringify(entry.observations || []));
            entityCount++;
          } else if (entry.type === 'relation') {
            insertRelation.run(entry.from, entry.to, entry.relationType || 'related');
            relationCount++;
          }
        } catch { /* skip malformed lines */ }
      }
    });
    txn();

    return { entities: entityCount, relations: relationCount };
  }

  // ── Stats ──────────────────────────────────────────────

  getStats() {
    const memories = this.db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
    const interactions = this.db.prepare('SELECT COUNT(*) as count FROM interactions').get().count;
    const entities = this.db.prepare('SELECT COUNT(*) as count FROM entities').get().count;
    const relations = this.db.prepare('SELECT COUNT(*) as count FROM relations').get().count;
    const withEmbeddings = this.db.prepare('SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL').get().count;
    const avgConfidence = this.db.prepare('SELECT AVG(confidence) as avg FROM memories').get().avg || 0;

    return { memories, interactions, entities, relations, withEmbeddings, avgConfidence: Math.round(avgConfidence * 100) / 100 };
  }

  // ── Internal ───────────────────────────────────────────

  _parseMemoryRow(row) {
    return {
      ...row,
      metadata: JSON.parse(row.metadata || '{}'),
      embedding: undefined, // Don't return raw embedding blobs
    };
  }

  close() {
    if (this.db) this.db.close();
  }
}

// ── Vector Math ────────────────────────────────────────

export function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}
