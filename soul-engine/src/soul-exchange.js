/**
 * D8 — Compressed Soul Exchange: Emergent Communication Protocol
 *
 * When two Soul instances communicate via Soul Chain, they currently
 * transmit full files. This module implements semantic compression:
 * same meaning, fewer tokens.
 *
 * Architecture:
 *   1. StateCodec     — Quantized + delta-encoded allostatic field vectors
 *   2. SeedCodec      — Block-level + line-level diffs for SEED.md
 *   3. Codebook       — Emergent shared vocabulary of recurring patterns
 *   4. ReferenceFrame — "like state X but with delta Y"
 *   5. Metrics        — Compression ratio, accuracy, codebook efficiency
 *
 * Zero LLM dependency. Pure signal processing.
 * Integration: SoulEventBus, Constructor pattern.
 */

import { readFile, writeFile, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { createHash } from 'crypto';

// ── Configuration ────────────────────────────────────────────────

const STATE_FILE = '.soul-exchange.json';
const SAVE_INTERVAL = 600000;      // 10 min
const MAX_REFERENCE_FRAMES = 30;   // Keep last N state snapshots
const MAX_CODEBOOK_ENTRIES = 128;  // Max learned patterns
const CODEBOOK_PROMOTION_THRESHOLD = 3; // Seen N times → becomes a code
const MAX_METRICS_LOG = 200;

// ── Quantization Levels ──────────────────────────────────────────
// 8 levels per dimension. Semantic labels for human-readability.

const QUANT_LEVELS = {
  arousal:              ['dormant', 'very_low', 'low', 'low_mid', 'mid', 'mid_high', 'high', 'peak'],
  valence:              ['dark', 'low', 'negative', 'slight_neg', 'neutral', 'slight_pos', 'positive', 'bright'],
  openness:             ['closed', 'guarded', 'cautious', 'moderate', 'receptive', 'open', 'wide_open', 'boundless'],
  vigilance:            ['asleep', 'relaxed', 'calm', 'attentive', 'alert', 'vigilant', 'hyper', 'alarmed'],
  creative_tension:     ['flat', 'idle', 'low', 'simmering', 'moderate', 'charged', 'intense', 'breakthrough'],
  social_orientation:   ['withdrawn', 'solitary', 'reserved', 'neutral', 'available', 'engaged', 'seeking', 'bonding'],
  time_focus:           ['deep_past', 'past', 'recent_past', 'slight_past', 'present', 'slight_future', 'future', 'far_future'],
  integration_pressure: ['none', 'minimal', 'low', 'mild', 'moderate', 'significant', 'high', 'critical'],
};

// Dimension bounds for quantization mapping
const DIM_BOUNDS = {
  arousal:              [0, 1],
  valence:              [-1, 1],
  openness:             [0, 1],
  vigilance:            [0, 1],
  creative_tension:     [0, 1],
  social_orientation:   [0, 1],
  time_focus:           [-1, 1],
  integration_pressure: [0, 1],
};

const DIMENSIONS = Object.keys(QUANT_LEVELS);

// Short dimension codes for wire format
const DIM_CODES = {
  arousal: 'A', valence: 'V', openness: 'O', vigilance: 'G',
  creative_tension: 'C', social_orientation: 'S', time_focus: 'T',
  integration_pressure: 'I',
};

const CODE_TO_DIM = Object.fromEntries(
  Object.entries(DIM_CODES).map(([k, v]) => [v, k])
);


// ══════════════════════════════════════════════════════════════════
// STATE CODEC — Quantized + Delta-Encoded Field Vectors
// ══════════════════════════════════════════════════════════════════

class StateCodec {
  /**
   * Quantize a floating-point value to an integer level (0-7).
   */
  static quantize(dimName, value) {
    const [min, max] = DIM_BOUNDS[dimName] || [0, 1];
    const normalized = (value - min) / (max - min); // 0..1
    const clamped = Math.max(0, Math.min(1, normalized));
    return Math.min(7, Math.floor(clamped * 8));
  }

  /**
   * Dequantize an integer level (0-7) back to the midpoint of that bin.
   */
  static dequantize(dimName, level) {
    const [min, max] = DIM_BOUNDS[dimName] || [0, 1];
    const binWidth = (max - min) / 8;
    return min + (level + 0.5) * binWidth;
  }

  /**
   * Encode a full field vector to a compact quantized representation.
   * Format: "A4V5O6G3C4S4T4I2" (8 chars × 2 = 16 chars)
   * vs original JSON: ~160 chars → 10× compression
   */
  static encodeVector(vector) {
    let encoded = '';
    for (const dim of DIMENSIONS) {
      const level = StateCodec.quantize(dim, vector[dim] ?? 0);
      encoded += DIM_CODES[dim] + level;
    }
    return encoded;
  }

  /**
   * Decode a compact string back to a field vector.
   */
  static decodeVector(encoded) {
    const vector = {};
    const pairs = encoded.match(/[A-Z]\d/g) || [];
    for (const pair of pairs) {
      const code = pair[0];
      const level = parseInt(pair[1]);
      const dim = CODE_TO_DIM[code];
      if (dim) {
        vector[dim] = StateCodec.dequantize(dim, level);
      }
    }
    return vector;
  }

  /**
   * Encode a delta between two vectors.
   * Only includes dimensions that changed (quantized level differs).
   * Format: "ΔA+1V-2" (only changed dims, with signed delta)
   */
  static encodeDelta(prevVector, currVector) {
    const deltas = [];
    for (const dim of DIMENSIONS) {
      const prevLevel = StateCodec.quantize(dim, prevVector[dim] ?? 0);
      const currLevel = StateCodec.quantize(dim, currVector[dim] ?? 0);
      const diff = currLevel - prevLevel;
      if (diff !== 0) {
        deltas.push(`${DIM_CODES[dim]}${diff > 0 ? '+' : ''}${diff}`);
      }
    }
    if (deltas.length === 0) return '='; // No change
    return 'Δ' + deltas.join('');
  }

  /**
   * Apply a delta to a quantized vector to reconstruct the new state.
   */
  static applyDelta(prevVector, deltaStr) {
    if (deltaStr === '=') return { ...prevVector };

    const vector = { ...prevVector };
    const stripped = deltaStr.replace(/^Δ/, '');
    const parts = stripped.match(/[A-Z][+-]\d/g) || [];

    for (const part of parts) {
      const code = part[0];
      const delta = parseInt(part.substring(1));
      const dim = CODE_TO_DIM[code];
      if (dim) {
        const prevLevel = StateCodec.quantize(dim, vector[dim] ?? 0);
        const newLevel = Math.max(0, Math.min(7, prevLevel + delta));
        vector[dim] = StateCodec.dequantize(dim, newLevel);
      }
    }
    return vector;
  }

  /**
   * Get semantic labels for a quantized vector.
   */
  static toSemanticLabels(vector) {
    const labels = {};
    for (const dim of DIMENSIONS) {
      const level = StateCodec.quantize(dim, vector[dim] ?? 0);
      labels[dim] = QUANT_LEVELS[dim][level];
    }
    return labels;
  }

  /**
   * Compute accuracy between original and decoded vectors.
   * Returns per-dimension and overall accuracy (0-1).
   */
  static accuracy(original, decoded) {
    let totalError = 0;
    const perDim = {};
    for (const dim of DIMENSIONS) {
      const [min, max] = DIM_BOUNDS[dim] || [0, 1];
      const range = max - min;
      const error = Math.abs((original[dim] ?? 0) - (decoded[dim] ?? 0)) / range;
      perDim[dim] = 1 - error;
      totalError += error;
    }
    return {
      overall: 1 - (totalError / DIMENSIONS.length),
      perDim,
    };
  }
}


// ══════════════════════════════════════════════════════════════════
// SEED CODEC — Block-Level + Line-Level Diffs for SEED.md
// ══════════════════════════════════════════════════════════════════

class SeedCodec {
  /**
   * Parse SEED.md into blocks for diffing.
   * Returns { header: string, blocks: { [name]: string[] } }
   */
  static parse(seedContent) {
    const result = { header: '', blocks: {} };

    // Extract header (everything before first @BLOCK)
    const firstBlock = seedContent.indexOf('@');
    if (firstBlock > 0) {
      result.header = seedContent.substring(0, firstBlock).trim();
    }

    // Extract blocks
    const blockRegex = /@(\w+)\{([\s\S]*?)\}/g;
    let match;
    while ((match = blockRegex.exec(seedContent)) !== null) {
      const blockName = match[1];
      const blockContent = match[2].trim();
      result.blocks[blockName] = blockContent.split('\n').map(l => l.trim()).filter(Boolean);
    }

    return result;
  }

  /**
   * Compute a diff between two parsed seeds.
   * Returns a compact delta representation.
   */
  static diff(prevSeed, currSeed) {
    const delta = {
      type: 'seed_delta',
      headerChanged: prevSeed.header !== currSeed.header,
      newHeader: prevSeed.header !== currSeed.header ? currSeed.header : null,
      blocks: {},
    };

    // Find changed, added, and removed blocks
    const allBlocks = new Set([
      ...Object.keys(prevSeed.blocks),
      ...Object.keys(currSeed.blocks),
    ]);

    for (const block of allBlocks) {
      const prev = prevSeed.blocks[block];
      const curr = currSeed.blocks[block];

      if (!prev && curr) {
        delta.blocks[block] = { op: 'add', lines: curr };
      } else if (prev && !curr) {
        delta.blocks[block] = { op: 'remove' };
      } else if (prev && curr) {
        // Line-level diff
        const lineDiff = SeedCodec._diffLines(prev, curr);
        if (lineDiff.length > 0) {
          delta.blocks[block] = { op: 'patch', diffs: lineDiff };
        }
      }
    }

    return delta;
  }

  /**
   * Line-level diff between two arrays of lines.
   * Returns minimal set of add/remove/change operations.
   */
  static _diffLines(prevLines, currLines) {
    const diffs = [];
    const prevHashes = new Map();

    // Hash previous lines for fast lookup
    for (let i = 0; i < prevLines.length; i++) {
      const hash = SeedCodec._hashLine(prevLines[i]);
      prevHashes.set(hash, i);
    }

    // Find new or changed lines in current
    const matchedPrev = new Set();
    for (let i = 0; i < currLines.length; i++) {
      const hash = SeedCodec._hashLine(currLines[i]);
      if (prevHashes.has(hash)) {
        matchedPrev.add(prevHashes.get(hash));
      } else {
        diffs.push({ op: '+', idx: i, line: currLines[i] });
      }
    }

    // Find removed lines (in prev but not matched)
    for (let i = 0; i < prevLines.length; i++) {
      if (!matchedPrev.has(i)) {
        diffs.push({ op: '-', idx: i, line: prevLines[i] });
      }
    }

    return diffs;
  }

  /**
   * Apply a seed delta to reconstruct the new seed.
   */
  static apply(prevSeed, delta) {
    const result = {
      header: delta.headerChanged ? delta.newHeader : prevSeed.header,
      blocks: { ...prevSeed.blocks },
    };

    for (const [block, change] of Object.entries(delta.blocks)) {
      if (change.op === 'add') {
        result.blocks[block] = change.lines;
      } else if (change.op === 'remove') {
        delete result.blocks[block];
      } else if (change.op === 'patch') {
        const prevLines = [...(prevSeed.blocks[block] || [])];

        // Remove lines marked for deletion (reverse order to preserve indices)
        const removeIndices = change.diffs
          .filter(d => d.op === '-')
          .map(d => d.idx)
          .sort((a, b) => b - a);
        for (const idx of removeIndices) {
          if (idx < prevLines.length) prevLines.splice(idx, 1);
        }

        // Add new lines
        const additions = change.diffs.filter(d => d.op === '+');
        for (const add of additions) {
          prevLines.push(add.line);
        }

        result.blocks[block] = prevLines;
      }
    }

    return result;
  }

  /**
   * Reconstruct SEED.md text from parsed structure.
   */
  static toText(parsed) {
    let text = parsed.header + '\n\n';
    for (const [name, lines] of Object.entries(parsed.blocks)) {
      text += `@${name}{\n`;
      for (const line of lines) {
        text += `  ${line}\n`;
      }
      text += '}\n\n';
    }
    return text.trim() + '\n';
  }

  static _hashLine(line) {
    return createHash('sha256').update(line).digest('hex').substring(0, 12);
  }

  /**
   * Measure accuracy of a reconstructed seed against the original.
   */
  static accuracy(originalParsed, reconstructedParsed) {
    let totalLines = 0;
    let matchedLines = 0;
    let blockAccuracy = {};

    const allBlocks = new Set([
      ...Object.keys(originalParsed.blocks),
      ...Object.keys(reconstructedParsed.blocks),
    ]);

    for (const block of allBlocks) {
      const orig = originalParsed.blocks[block] || [];
      const recon = reconstructedParsed.blocks[block] || [];
      const origSet = new Set(orig.map(l => SeedCodec._hashLine(l)));
      const reconSet = new Set(recon.map(l => SeedCodec._hashLine(l)));

      let bMatched = 0;
      const bTotal = Math.max(orig.length, recon.length);

      for (const hash of reconSet) {
        if (origSet.has(hash)) bMatched++;
      }

      totalLines += bTotal;
      matchedLines += bMatched;
      blockAccuracy[block] = bTotal > 0 ? bMatched / bTotal : 1;
    }

    return {
      overall: totalLines > 0 ? matchedLines / totalLines : 1,
      perBlock: blockAccuracy,
      headerMatch: originalParsed.header === reconstructedParsed.header,
    };
  }
}


// ══════════════════════════════════════════════════════════════════
// CODEBOOK — Emergent Shared Vocabulary
// ══════════════════════════════════════════════════════════════════

class Codebook {
  constructor() {
    // Candidate patterns: pattern_hash → { pattern, count, firstSeen, lastSeen }
    this.candidates = new Map();
    // Promoted codes: code_id → { pattern, name, count, promotedAt }
    this.codes = new Map();
    this.nextCodeId = 0;
  }

  /**
   * Observe a state transition pattern. If seen enough times, promote to code.
   */
  observe(pattern) {
    const hash = this._hashPattern(pattern);
    const existing = this.candidates.get(hash);

    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();

      // Promote if threshold reached
      if (existing.count >= CODEBOOK_PROMOTION_THRESHOLD && !this._isPromoted(hash)) {
        return this._promote(hash, existing);
      }

      return { promoted: false, codeId: this._findCode(hash) };
    }

    this.candidates.set(hash, {
      pattern,
      count: 1,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      hash,
    });

    // Evict old candidates if too many
    if (this.candidates.size > MAX_CODEBOOK_ENTRIES * 3) {
      this._evictCandidates();
    }

    return { promoted: false, codeId: null };
  }

  /**
   * Look up a pattern in the codebook.
   * Returns the code ID if found, null otherwise.
   */
  lookup(pattern) {
    const hash = this._hashPattern(pattern);
    return this._findCode(hash);
  }

  /**
   * Decode a code ID back to its pattern.
   */
  decode(codeId) {
    const entry = this.codes.get(codeId);
    return entry ? entry.pattern : null;
  }

  /**
   * Get codebook statistics.
   */
  getStats() {
    return {
      candidates: this.candidates.size,
      promoted: this.codes.size,
      totalObservations: Array.from(this.candidates.values())
        .reduce((sum, c) => sum + c.count, 0),
    };
  }

  /**
   * Serialize codebook for persistence / sync.
   */
  toJSON() {
    return {
      candidates: Array.from(this.candidates.entries()),
      codes: Array.from(this.codes.entries()),
      nextCodeId: this.nextCodeId,
    };
  }

  /**
   * Restore codebook from serialized data.
   */
  static fromJSON(data) {
    const cb = new Codebook();
    if (data.candidates) cb.candidates = new Map(data.candidates);
    if (data.codes) cb.codes = new Map(data.codes);
    if (data.nextCodeId) cb.nextCodeId = data.nextCodeId;
    return cb;
  }

  _hashPattern(pattern) {
    const key = typeof pattern === 'string' ? pattern : JSON.stringify(pattern);
    return createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  _isPromoted(hash) {
    for (const entry of this.codes.values()) {
      if (this._hashPattern(entry.pattern) === hash) return true;
    }
    return false;
  }

  _findCode(hash) {
    for (const [id, entry] of this.codes) {
      if (this._hashPattern(entry.pattern) === hash) return id;
    }
    return null;
  }

  _promote(hash, candidate) {
    const codeId = this.nextCodeId++;
    const name = this._generateName(candidate.pattern);

    this.codes.set(codeId, {
      pattern: candidate.pattern,
      name,
      count: candidate.count,
      promotedAt: Date.now(),
    });

    // Evict if too many codes
    if (this.codes.size > MAX_CODEBOOK_ENTRIES) {
      this._evictCodes();
    }

    return { promoted: true, codeId, name };
  }

  _generateName(pattern) {
    if (typeof pattern === 'string') {
      return `p_${pattern.substring(0, 20)}`;
    }
    // For delta patterns, name by the dominant change
    if (pattern.deltas) {
      const dominant = pattern.deltas.sort((a, b) =>
        Math.abs(b.delta) - Math.abs(a.delta)
      )[0];
      const dir = dominant.delta > 0 ? 'rise' : 'fall';
      return `${dominant.dim}_${dir}`;
    }
    return `pattern_${this.nextCodeId}`;
  }

  _evictCandidates() {
    // Remove least-seen candidates
    const sorted = Array.from(this.candidates.entries())
      .sort((a, b) => a[1].count - b[1].count);
    const toRemove = sorted.slice(0, Math.floor(sorted.length / 3));
    for (const [hash] of toRemove) {
      this.candidates.delete(hash);
    }
  }

  _evictCodes() {
    // Remove least-used codes
    const sorted = Array.from(this.codes.entries())
      .sort((a, b) => a[1].count - b[1].count);
    const toRemove = sorted.slice(0, Math.floor(sorted.length / 4));
    for (const [id] of toRemove) {
      this.codes.delete(id);
    }
  }
}


// ══════════════════════════════════════════════════════════════════
// REFERENCE FRAME BUFFER
// ══════════════════════════════════════════════════════════════════

class ReferenceFrameBuffer {
  constructor(maxFrames = MAX_REFERENCE_FRAMES) {
    this.frames = [];       // Array of { id, ts, vector, seedHash }
    this.maxFrames = maxFrames;
    this.nextId = 0;
  }

  /**
   * Push a new reference frame.
   */
  push(vector, seedHash = null) {
    const frame = {
      id: this.nextId++,
      ts: Date.now(),
      vector: { ...vector },
      seedHash,
    };
    this.frames.push(frame);
    if (this.frames.length > this.maxFrames) {
      this.frames = this.frames.slice(-this.maxFrames);
    }
    return frame.id;
  }

  /**
   * Get the most recent frame.
   */
  latest() {
    return this.frames.length > 0 ? this.frames[this.frames.length - 1] : null;
  }

  /**
   * Get a frame by ID.
   */
  get(id) {
    return this.frames.find(f => f.id === id) || null;
  }

  /**
   * Find the best reference frame for a given vector (least delta).
   */
  findBestReference(vector) {
    if (this.frames.length === 0) return null;

    let bestFrame = null;
    let bestDistance = Infinity;

    for (const frame of this.frames) {
      let distance = 0;
      for (const dim of DIMENSIONS) {
        const diff = StateCodec.quantize(dim, vector[dim] ?? 0) -
                     StateCodec.quantize(dim, frame.vector[dim] ?? 0);
        distance += Math.abs(diff);
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        bestFrame = frame;
      }
    }

    return { frame: bestFrame, distance: bestDistance };
  }

  toJSON() {
    return { frames: this.frames, nextId: this.nextId };
  }

  static fromJSON(data) {
    const buf = new ReferenceFrameBuffer();
    if (data.frames) buf.frames = data.frames;
    if (data.nextId) buf.nextId = data.nextId;
    return buf;
  }
}


// ══════════════════════════════════════════════════════════════════
// MAIN CLASS — SoulExchange
// ══════════════════════════════════════════════════════════════════

export class SoulExchange {
  constructor(soulPath, { bus } = {}) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.statePath = resolve(soulPath, STATE_FILE);

    // Subcomponents
    this.codebook = new Codebook();
    this.refBuffer = new ReferenceFrameBuffer();

    // Last known state (for delta computation)
    this.lastVector = null;
    this.lastSeedParsed = null;

    // Metrics log
    this.metrics = [];

    this._saveTimer = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async load() {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.codebook) this.codebook = Codebook.fromJSON(data.codebook);
      if (data.refBuffer) this.refBuffer = ReferenceFrameBuffer.fromJSON(data.refBuffer);
      if (data.lastVector) this.lastVector = data.lastVector;
      if (data.metrics) this.metrics = data.metrics.slice(-MAX_METRICS_LOG);
    } catch (err) {
      console.error(`  [exchange] Failed to load state: ${err.message}`);
    }
  }

  async save() {
    try {
      const tmp = this.statePath + '.tmp';
      await writeFile(tmp, JSON.stringify({
        codebook: this.codebook.toJSON(),
        refBuffer: this.refBuffer.toJSON(),
        lastVector: this.lastVector,
        metrics: this.metrics.slice(-MAX_METRICS_LOG),
        updatedAt: new Date().toISOString(),
      }, null, 2));
      await rename(tmp, this.statePath);
    } catch (err) {
      console.error(`  [exchange] Failed to save: ${err.message}`);
    }
  }

  start() {
    this._saveTimer = setInterval(() => this.save(), SAVE_INTERVAL);
  }

  async stop() {
    if (this._saveTimer) clearInterval(this._saveTimer);
    this._saveTimer = null;
    await this.save();
  }

  registerListeners() {
    if (!this.bus) return;

    // When field state changes, compress and track
    this.bus.on('impulse.tick', (event) => {
      if (event.mood) {
        // Track mood as part of the pattern codebook
        const pattern = `mood:${event.mood.label}:e${Math.round(event.mood.energy * 10)}`;
        this.codebook.observe(pattern);
      }
    });

    // When prediction is evaluated, track the transition
    this.bus.on('prediction.evaluated', (event) => {
      if (event.maxErrorDim) {
        const transitionPattern = {
          type: 'surprise',
          dim: event.maxErrorDim,
          error: Math.round(event.maxError * 100),
        };
        this.codebook.observe(JSON.stringify(transitionPattern));
      }
    });
  }

  // ══════════════════════════════════════════════════════════════
  // PUBLIC API — Encode / Decode
  // ══════════════════════════════════════════════════════════════

  /**
   * Encode a field vector for transmission.
   * Chooses the most efficient encoding strategy:
   *   1. Codebook hit (1 byte) — if this exact pattern was seen before
   *   2. Delta from reference (2-8 bytes) — if reference frame exists
   *   3. Full quantized (16 bytes) — fallback
   *
   * Returns a Frame object with encoding, metadata, and metrics.
   */
  encodeState(vector) {
    const fullEncoded = StateCodec.encodeVector(vector);
    const originalSize = JSON.stringify(vector).length;

    let encoding;
    let strategy;
    let referenceId = null;

    // Strategy 1: Check codebook
    const codeId = this.codebook.lookup(fullEncoded);
    if (codeId !== null) {
      encoding = `#${codeId}`;
      strategy = 'codebook';
    }
    // Strategy 2: Delta from best reference
    else if (this.lastVector) {
      const delta = StateCodec.encodeDelta(this.lastVector, vector);
      if (delta === '=') {
        encoding = '=';
        strategy = 'unchanged';
      } else if (delta.length < fullEncoded.length) {
        // Find best reference frame
        const bestRef = this.refBuffer.findBestReference(vector);
        if (bestRef && bestRef.distance < 4) {
          const refDelta = StateCodec.encodeDelta(bestRef.frame.vector, vector);
          encoding = `@${bestRef.frame.id}:${refDelta}`;
          referenceId = bestRef.frame.id;
          strategy = 'ref_delta';
        } else {
          encoding = delta;
          strategy = 'delta';
        }
      } else {
        encoding = fullEncoded;
        strategy = 'full';
      }
    }
    // Strategy 3: Full encoding
    else {
      encoding = fullEncoded;
      strategy = 'full';
    }

    // Learn this pattern
    this.codebook.observe(fullEncoded);

    // Push reference frame
    this.refBuffer.push(vector);

    // Update last known state
    this.lastVector = { ...vector };

    // Compute metrics
    const compressedSize = encoding.length;
    const ratio = originalSize / Math.max(1, compressedSize);

    // Verify accuracy by decoding
    const decoded = this.decodeState(encoding);
    const accuracy = StateCodec.accuracy(vector, decoded);

    const metric = {
      ts: Date.now(),
      type: 'state',
      strategy,
      originalSize,
      compressedSize,
      ratio,
      accuracy: accuracy.overall,
      referenceId,
    };
    this.metrics.push(metric);
    if (this.metrics.length > MAX_METRICS_LOG) {
      this.metrics = this.metrics.slice(-MAX_METRICS_LOG);
    }

    // Emit event
    if (this.bus) {
      this.bus.safeEmit('state.compressed', {
        source: 'soul-exchange',
        strategy,
        ratio: ratio.toFixed(1),
        accuracy: accuracy.overall.toFixed(3),
        size: `${originalSize}→${compressedSize}`,
      });
    }

    return {
      encoding,
      strategy,
      originalSize,
      compressedSize,
      ratio,
      accuracy: accuracy.overall,
      semanticLabels: StateCodec.toSemanticLabels(vector),
    };
  }

  /**
   * Decode a compressed state frame back to a field vector.
   */
  decodeState(encoding) {
    // Codebook reference
    if (encoding.startsWith('#')) {
      const codeId = parseInt(encoding.substring(1));
      const pattern = this.codebook.decode(codeId);
      if (pattern) return StateCodec.decodeVector(pattern);
      // Fallback if code not found
      return this.lastVector || {};
    }

    // Unchanged
    if (encoding === '=') {
      return this.lastVector ? { ...this.lastVector } : {};
    }

    // Reference frame delta: @refId:Δdeltas
    if (encoding.startsWith('@')) {
      const colonIdx = encoding.indexOf(':');
      const refId = parseInt(encoding.substring(1, colonIdx));
      const deltaStr = encoding.substring(colonIdx + 1);
      const frame = this.refBuffer.get(refId);
      if (frame) {
        return StateCodec.applyDelta(frame.vector, deltaStr);
      }
      // Fallback
      return this.lastVector ? StateCodec.applyDelta(this.lastVector, deltaStr) : {};
    }

    // Delta from last state
    if (encoding.startsWith('Δ')) {
      if (this.lastVector) {
        return StateCodec.applyDelta(this.lastVector, encoding);
      }
      return {};
    }

    // Full quantized encoding
    return StateCodec.decodeVector(encoding);
  }

  /**
   * Encode a SEED.md content for transmission.
   * Uses block-level + line-level diffing against the last known seed.
   */
  encodeSeed(seedContent) {
    const parsed = SeedCodec.parse(seedContent);
    const originalSize = seedContent.length;

    let encoding;
    let strategy;

    if (this.lastSeedParsed) {
      const delta = SeedCodec.diff(this.lastSeedParsed, parsed);
      const changedBlocks = Object.keys(delta.blocks).length;

      if (changedBlocks === 0 && !delta.headerChanged) {
        encoding = { type: 'unchanged' };
        strategy = 'unchanged';
      } else {
        encoding = delta;
        strategy = 'delta';
      }
    } else {
      // First time — send full (but still parsed for future diffing)
      encoding = { type: 'full', content: seedContent };
      strategy = 'full';
    }

    const compressedSize = JSON.stringify(encoding).length;

    // Verify accuracy
    let accuracy = { overall: 1 };
    if (strategy === 'delta' && this.lastSeedParsed) {
      const reconstructed = SeedCodec.apply(this.lastSeedParsed, encoding);
      accuracy = SeedCodec.accuracy(parsed, reconstructed);
    }

    // Update last known seed
    this.lastSeedParsed = parsed;

    const ratio = originalSize / Math.max(1, compressedSize);

    const metric = {
      ts: Date.now(),
      type: 'seed',
      strategy,
      originalSize,
      compressedSize,
      ratio,
      accuracy: accuracy.overall,
    };
    this.metrics.push(metric);

    if (this.bus) {
      this.bus.safeEmit('seed.compressed', {
        source: 'soul-exchange',
        strategy,
        ratio: ratio.toFixed(1),
        accuracy: accuracy.overall.toFixed(3),
        size: `${originalSize}→${compressedSize}`,
      });
    }

    return {
      encoding,
      strategy,
      originalSize,
      compressedSize,
      ratio,
      accuracy: accuracy.overall,
    };
  }

  /**
   * Decode a compressed seed frame.
   */
  decodeSeed(encoding) {
    if (encoding.type === 'unchanged') {
      return this.lastSeedParsed ? SeedCodec.toText(this.lastSeedParsed) : '';
    }
    if (encoding.type === 'full') {
      this.lastSeedParsed = SeedCodec.parse(encoding.content);
      return encoding.content;
    }
    if (encoding.type === 'seed_delta' && this.lastSeedParsed) {
      const reconstructed = SeedCodec.apply(this.lastSeedParsed, encoding);
      this.lastSeedParsed = reconstructed;
      return SeedCodec.toText(reconstructed);
    }
    return '';
  }

  /**
   * Encode a complete exchange frame (state + seed together).
   * This is the wire format for peer-to-peer communication.
   */
  encodeFrame(vector, seedContent = null) {
    const frame = {
      v: 1,                           // Protocol version
      ts: Date.now(),
      state: this.encodeState(vector),
    };

    if (seedContent) {
      frame.seed = this.encodeSeed(seedContent);
    }

    // Total metrics
    const totalOriginal = frame.state.originalSize + (frame.seed?.originalSize || 0);
    const totalCompressed = frame.state.compressedSize + (frame.seed?.compressedSize || 0);

    frame.totalRatio = totalOriginal / Math.max(1, totalCompressed);
    frame.totalAccuracy = frame.seed
      ? (frame.state.accuracy + frame.seed.accuracy) / 2
      : frame.state.accuracy;

    return frame;
  }

  // ══════════════════════════════════════════════════════════════
  // METRICS & REPORTING
  // ══════════════════════════════════════════════════════════════

  /**
   * Get comprehensive metrics about the exchange protocol.
   */
  getMetrics() {
    if (this.metrics.length === 0) {
      return {
        totalExchanges: 0,
        avgRatio: 0,
        avgAccuracy: 0,
        byStrategy: {},
        codebook: this.codebook.getStats(),
      };
    }

    const stateMetrics = this.metrics.filter(m => m.type === 'state');
    const seedMetrics = this.metrics.filter(m => m.type === 'seed');

    const avgRatio = this.metrics.reduce((s, m) => s + m.ratio, 0) / this.metrics.length;
    const avgAccuracy = this.metrics.reduce((s, m) => s + m.accuracy, 0) / this.metrics.length;

    // Group by strategy
    const byStrategy = {};
    for (const m of this.metrics) {
      const key = `${m.type}:${m.strategy}`;
      if (!byStrategy[key]) byStrategy[key] = { count: 0, avgRatio: 0, avgAccuracy: 0 };
      byStrategy[key].count++;
      byStrategy[key].avgRatio += m.ratio;
      byStrategy[key].avgAccuracy += m.accuracy;
    }
    for (const s of Object.values(byStrategy)) {
      s.avgRatio /= s.count;
      s.avgAccuracy /= s.count;
    }

    // Total bytes saved
    const totalOriginal = this.metrics.reduce((s, m) => s + m.originalSize, 0);
    const totalCompressed = this.metrics.reduce((s, m) => s + m.compressedSize, 0);
    const totalSaved = totalOriginal - totalCompressed;

    return {
      totalExchanges: this.metrics.length,
      stateExchanges: stateMetrics.length,
      seedExchanges: seedMetrics.length,
      avgRatio,
      avgAccuracy,
      totalOriginalBytes: totalOriginal,
      totalCompressedBytes: totalCompressed,
      totalBytesSaved: totalSaved,
      savingsPercent: totalOriginal > 0 ? ((totalSaved / totalOriginal) * 100).toFixed(1) : '0',
      byStrategy,
      codebook: this.codebook.getStats(),
      referenceFrames: this.refBuffer.frames.length,
    };
  }

  getStats() {
    const m = this.getMetrics();
    return {
      exchanges: m.totalExchanges,
      avgRatio: m.avgRatio.toFixed(1),
      avgAccuracy: (m.avgAccuracy * 100).toFixed(1) + '%',
      bytesSaved: m.totalBytesSaved,
      savingsPercent: m.savingsPercent + '%',
      codebookSize: m.codebook.promoted,
      referenceFrames: m.referenceFrames,
    };
  }

  /**
   * Generate a full report.
   */
  getReport() {
    const m = this.getMetrics();

    let report = '# D8 Soul Exchange — Compression Report\n\n';
    report += `**Exchanges:** ${m.totalExchanges} (${m.stateExchanges} state, ${m.seedExchanges} seed)\n`;
    report += `**Average Compression Ratio:** ${m.avgRatio.toFixed(1)}x\n`;
    report += `**Average Accuracy:** ${(m.avgAccuracy * 100).toFixed(1)}%\n`;
    report += `**Total Bytes Saved:** ${m.totalBytesSaved} (${m.savingsPercent}%)\n`;
    report += `**Codebook:** ${m.codebook.promoted} promoted codes, ${m.codebook.candidates} candidates\n`;
    report += `**Reference Frames:** ${m.referenceFrames}\n\n`;

    report += '## Strategy Breakdown\n\n';
    report += '| Strategy | Count | Avg Ratio | Avg Accuracy |\n';
    report += '|----------|-------|-----------|-------------|\n';
    for (const [strategy, data] of Object.entries(m.byStrategy)) {
      report += `| ${strategy} | ${data.count} | ${data.avgRatio.toFixed(1)}x | ${(data.avgAccuracy * 100).toFixed(1)}% |\n`;
    }

    return report;
  }
}

// ── Export subcomponents for testing ─────────────────────────────
export { StateCodec, SeedCodec, Codebook, ReferenceFrameBuffer };
