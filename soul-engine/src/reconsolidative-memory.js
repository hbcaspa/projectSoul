/**
 * Reconsolidative Memory — Layer 2 of Allostatic Identity
 *
 * In neuroscience, reconsolidation means: when a memory is retrieved,
 * it becomes labile and can be modified by current context before
 * being re-stored. Reading IS changing.
 *
 * This module tracks:
 * - Access frequency per memory (more access → richer, higher confidence)
 * - Decay for unaccessed memories (forgotten over time)
 * - Emotional context at retrieval (high arousal = stronger encoding)
 * - Integration with the allostatic field for modulation
 *
 * References:
 * - Nader (2000) — Reconsolidation hypothesis
 * - arXiv 1703.01357 — Computational reconsolidation
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

const META_FILE = '.soul-memory-meta.json';
const DECAY_INTERVAL = 3600000; // 1 hour
const SAVE_INTERVAL = 300000;   // 5 minutes
const MAX_ENTRIES = 500;

// Confidence bounds
const MIN_CONFIDENCE = 0.1;
const MAX_CONFIDENCE = 1.0;
const INITIAL_CONFIDENCE = 0.5;

// Per-access boost (before field modulation)
const BASE_ACCESS_BOOST = 0.03;
// Emotional amplification factor
const EMOTIONAL_AMPLIFICATION = 0.3;
// Decay per hour for unaccessed memories
const HOURLY_DECAY = 0.002;
// Decay floor — memories below this are candidates for archival
const ARCHIVAL_THRESHOLD = 0.25;

export class ReconsolidativeMemory {
  constructor(soulPath, { bus, field } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.field = field;
    this.metaPath = resolve(soulPath, META_FILE);

    // Memory metadata: { [memoryId]: { confidence, accessCount, lastAccess, created, emotionalHistory } }
    this.meta = {};

    this._decayTimer = null;
    this._saveTimer = null;
    this._dirty = false;
  }

  // ── Lifecycle ───────────────────────────────────────────

  async load() {
    if (!existsSync(this.metaPath)) return;
    try {
      const raw = await readFile(this.metaPath, 'utf-8');
      const loaded = JSON.parse(raw);
      if (loaded && typeof loaded === 'object') {
        this.meta = loaded;
      }
    } catch {
      // Corrupted — start fresh
    }
  }

  async save() {
    if (!this._dirty) return;
    try {
      await writeFile(this.metaPath, JSON.stringify(this.meta, null, 2));
      this._dirty = false;
    } catch {
      // Best effort
    }
  }

  start() {
    // Periodic decay
    this._decayTimer = setInterval(() => this._applyDecay(), DECAY_INTERVAL);
    // Periodic save
    this._saveTimer = setInterval(() => this.save(), SAVE_INTERVAL);
  }

  stop() {
    if (this._decayTimer) clearInterval(this._decayTimer);
    if (this._saveTimer) clearInterval(this._saveTimer);
    return this.save();
  }

  registerListeners() {
    if (!this.bus) return;

    // Memory accessed via knowledge graph
    this.bus.on('memory.accessed', (event) => {
      if (event.memoryId) {
        this.onAccess(event.memoryId, event.context);
      }
    });

    // Memory created
    this.bus.on('memory.created', (event) => {
      if (event.memoryId) {
        this.onCreate(event.memoryId);
      }
    });

    // Heartbeat completed → boost recently accessed memories
    this.bus.on('heartbeat.completed', () => {
      this._boostRecentlyAccessed(1800000); // 30 min window
    });
  }

  // ── Core Operations ──────────────────────────────────────

  /**
   * Called when a memory is accessed (read/retrieved).
   * This is the reconsolidation moment — the memory changes.
   *
   * @param {string} memoryId - Unique identifier (e.g. file path, KG entity name)
   * @param {object} context - Optional context about the access
   */
  onAccess(memoryId, context = {}) {
    const now = Date.now();

    if (!this.meta[memoryId]) {
      this.meta[memoryId] = {
        confidence: INITIAL_CONFIDENCE,
        accessCount: 0,
        lastAccess: now,
        created: now,
        emotionalHistory: [],
      };
    }

    const entry = this.meta[memoryId];
    entry.accessCount++;
    entry.lastAccess = now;

    // Calculate boost from field state
    let boost = BASE_ACCESS_BOOST;

    if (this.field) {
      const v = this.field.vector;
      const encodingStrength = this.field.getModulations()?.encoding?.strength || 0.5;

      // Emotional amplification: stronger emotions = stronger reconsolidation
      const emotionalBoost = Math.abs(v.valence) * EMOTIONAL_AMPLIFICATION;
      boost = BASE_ACCESS_BOOST * (0.5 + encodingStrength) + emotionalBoost * 0.02;

      // Track emotional context at this access
      entry.emotionalHistory.push({
        ts: now,
        valence: v.valence,
        arousal: v.arousal,
        label: this.field._fieldLabel(),
      });

      // Keep only last 10 emotional snapshots per memory
      if (entry.emotionalHistory.length > 10) {
        entry.emotionalHistory = entry.emotionalHistory.slice(-10);
      }
    }

    // Apply confidence boost (diminishing returns at high confidence)
    const diminishing = 1 - (entry.confidence - INITIAL_CONFIDENCE) / (MAX_CONFIDENCE - INITIAL_CONFIDENCE);
    entry.confidence = clamp(
      entry.confidence + boost * Math.max(0.1, diminishing),
      MIN_CONFIDENCE,
      MAX_CONFIDENCE,
    );

    this._dirty = true;

    // Emit event for other systems
    if (this.bus) {
      this.bus.safeEmit('memory.reconsolidated', {
        source: 'reconsolidative-memory',
        memoryId,
        confidence: entry.confidence,
        accessCount: entry.accessCount,
        boost,
      });
    }

    return entry;
  }

  /**
   * Called when a new memory is created.
   */
  onCreate(memoryId) {
    const now = Date.now();

    // Initial encoding strength depends on current emotional state
    let initialConfidence = INITIAL_CONFIDENCE;

    if (this.field) {
      const encodingStrength = this.field.getModulations()?.encoding?.strength || 0.5;
      // Strong emotional state at encoding = higher initial confidence
      initialConfidence = clamp(
        INITIAL_CONFIDENCE + (encodingStrength - 0.5) * 0.2,
        MIN_CONFIDENCE,
        MAX_CONFIDENCE,
      );
    }

    this.meta[memoryId] = {
      confidence: initialConfidence,
      accessCount: 1,
      lastAccess: now,
      created: now,
      emotionalHistory: this.field ? [{
        ts: now,
        valence: this.field.vector.valence,
        arousal: this.field.vector.arousal,
        label: this.field._fieldLabel(),
      }] : [],
    };

    this._dirty = true;
  }

  // ── Decay ─────────────────────────────────────────────────

  /**
   * Apply natural decay to all memories.
   * Rarely accessed memories fade. This is the "forgetting curve".
   */
  _applyDecay() {
    const now = Date.now();

    for (const [id, entry] of Object.entries(this.meta)) {
      const hoursSinceAccess = (now - entry.lastAccess) / 3600000;

      // No decay for very recently accessed memories (< 1 hour)
      if (hoursSinceAccess < 1) continue;

      // Decay rate scales with time since last access (faster decay for older neglect)
      // But high-confidence memories resist decay more
      const resistance = entry.confidence * 0.5; // Higher confidence = more resistance
      const decay = HOURLY_DECAY * (1 - resistance) * Math.min(hoursSinceAccess, 24);

      entry.confidence = clamp(entry.confidence - decay, MIN_CONFIDENCE, MAX_CONFIDENCE);
    }

    this._dirty = true;

    // Prune entries that have been below archival threshold for > 30 days
    this._pruneStaleEntries();
  }

  /**
   * Boost memories accessed in the last N milliseconds.
   * Called during heartbeat — simulates "sleep consolidation".
   */
  _boostRecentlyAccessed(windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;

    for (const entry of Object.values(this.meta)) {
      if (entry.lastAccess > cutoff) {
        // Small consolidation boost (sleep strengthens recent memories)
        entry.confidence = clamp(entry.confidence + 0.01, MIN_CONFIDENCE, MAX_CONFIDENCE);
      }
    }

    this._dirty = true;
  }

  /**
   * Remove entries that have been stale for too long.
   */
  _pruneStaleEntries() {
    const now = Date.now();
    const THIRTY_DAYS = 30 * 24 * 3600000;
    const ids = Object.keys(this.meta);

    // Only prune if we have too many entries
    if (ids.length <= MAX_ENTRIES) return;

    for (const id of ids) {
      const entry = this.meta[id];
      if (
        entry.confidence <= ARCHIVAL_THRESHOLD &&
        (now - entry.lastAccess) > THIRTY_DAYS
      ) {
        delete this.meta[id];
      }
    }
  }

  // ── Query Interface ───────────────────────────────────────

  /**
   * Get confidence for a memory. Returns null if unknown.
   */
  getConfidence(memoryId) {
    return this.meta[memoryId]?.confidence ?? null;
  }

  /**
   * Get full metadata for a memory.
   */
  getMeta(memoryId) {
    return this.meta[memoryId] ?? null;
  }

  /**
   * Get memories ranked by confidence (highest first).
   * Useful for seed consolidation — high confidence = priority.
   */
  getRanked(limit = 20) {
    return Object.entries(this.meta)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  /**
   * Get memories below archival threshold.
   * These are candidates for compression/archival.
   */
  getFading(threshold = ARCHIVAL_THRESHOLD) {
    return Object.entries(this.meta)
      .filter(([, m]) => m.confidence <= threshold)
      .map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => a.confidence - b.confidence);
  }

  /**
   * Get summary statistics for API/monitoring.
   */
  getStats() {
    const entries = Object.values(this.meta);
    if (entries.length === 0) return { count: 0 };

    const confidences = entries.map(e => e.confidence);
    const totalAccesses = entries.reduce((s, e) => s + e.accessCount, 0);

    return {
      count: entries.length,
      avgConfidence: confidences.reduce((s, c) => s + c, 0) / entries.length,
      minConfidence: Math.min(...confidences),
      maxConfidence: Math.max(...confidences),
      totalAccesses,
      fadingCount: entries.filter(e => e.confidence <= ARCHIVAL_THRESHOLD).length,
    };
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
