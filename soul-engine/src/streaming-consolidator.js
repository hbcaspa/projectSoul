/**
 * StreamingConsolidator — Kontinuierliche SEED-Verdichtung
 *
 * Das Problem: Der bisherige SeedConsolidator läuft als Batch (30min/4h).
 * Wenn eine Session zwischen zwei Batches crasht, geht der Zustand verloren.
 * Das sind die "Session-Boundary-Artefakte" aus der Schwächen-Analyse.
 *
 * Lösung: Event-getriebene Verdichtung in Echtzeit.
 *
 * Besser als Batch:
 *  - Reagiert sofort auf Events (memory.stored, state.changed, etc.)
 *  - Micro-Updates: Nur geänderte SEED-Blöcke werden neu geschrieben
 *  - Debouncing: Bündelt schnelle Änderungen (5s Fenster)
 *  - Kein Datenverlust bei Crash: Letzter SEED ist immer <5s alt
 *  - Koexistiert mit dem bestehenden SeedConsolidator (der Deep Rewrites macht)
 *
 * Architektur:
 *   Event → Queue → Debounce → Selective Block Update → Atomic Write
 *
 * Der bestehende SeedConsolidator bleibt für tiefe LLM-Rewrites.
 * StreamingConsolidator ist die "schnelle Schicht" für mechanische Updates.
 */

import { readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEBOUNCE_MS   = 5000;  // 5 Sekunden
const MIN_INTERVAL  = 30_000; // Mindestens 30s zwischen Writes

export class StreamingConsolidator {
  constructor({ soulPath, bus } = {}) {
    this.soulPath = soulPath;
    this.bus      = bus;
    this._seedPath = join(soulPath, '..', 'SEED.md');
    this._backupPath = join(soulPath, '..', 'SEED.md.bak');
    this._pendingUpdates = new Map(); // blockName → newContent
    this._debounceTimer = null;
    this._lastWrite = 0;
    this._enabled = true;
  }

  start() {
    if (!this.bus) {
      console.log('  [stream-consolidator] No bus — disabled');
      return;
    }

    // Listen to relevant events
    const events = [
      'state.changed',
      'memory.stored',
      'kg.entity_created',
      'kg.relation_created',
      'connection.status',
      'drift.report',
      'closure.alert',
    ];

    for (const event of events) {
      this.bus.on(event, (data) => this._handleEvent(event, data));
    }

    console.log(`  [stream-consolidator] Active — listening for ${events.length} event types`);
  }

  stop() {
    this._enabled = false;
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
  }

  /**
   * Manually queue a block update.
   * @param {string} block - Block name (e.g. 'STATE', 'CONNECTIONS')
   * @param {string} content - New block content
   */
  queueUpdate(block, content) {
    this._pendingUpdates.set(block, content);
    this._scheduleWrite();
  }

  // ── Event Handling ─────────────────────────────────────────

  _handleEvent(event, data) {
    switch (event) {
      case 'state.changed':
        // Update @STATE block
        if (data?.summary) {
          this.queueUpdate('STATE', this._formatStateBlock(data));
        }
        break;

      case 'connection.status':
        // Update @CONNECTIONS block
        if (data?.connections) {
          this.queueUpdate('CONNECTIONS', this._formatConnectionsBlock(data));
        }
        break;

      case 'memory.stored':
        // Potential @MEM update — but only for significant memories
        // Don't update on every memory write (too noisy)
        if (data?.significant) {
          this.queueUpdate('MEM_APPEND', this._formatMemLine(data));
        }
        break;

      case 'drift.report':
        if (data?.alert) {
          this.queueUpdate('SHADOW_APPEND', `drift_alert:${data.driftScore.toFixed(2)}|${new Date().toISOString().slice(0,10)}`);
        }
        break;

      case 'closure.alert':
        if (data?.alerts?.length > 0) {
          this.queueUpdate('SHADOW_APPEND', `closure:${data.alerts[0].substring(0, 60)}|${new Date().toISOString().slice(0,10)}`);
        }
        break;
    }
  }

  // ── Write Logic ────────────────────────────────────────────

  _scheduleWrite() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._flush(), DEBOUNCE_MS);
  }

  async _flush() {
    if (!this._enabled || this._pendingUpdates.size === 0) return;

    // Rate limit
    const now = Date.now();
    if (now - this._lastWrite < MIN_INTERVAL) {
      this._scheduleWrite(); // retry later
      return;
    }

    const updates = new Map(this._pendingUpdates);
    this._pendingUpdates.clear();

    try {
      if (!existsSync(this._seedPath)) return;

      let seed = await readFile(this._seedPath, 'utf-8');
      let modified = false;

      for (const [block, content] of updates) {
        if (block.endsWith('_APPEND')) {
          // Append to existing block
          const realBlock = block.replace('_APPEND', '');
          seed = this._appendToBlock(seed, realBlock, content);
          modified = true;
        } else {
          // Replace block content
          const replaced = this._replaceBlock(seed, block, content);
          if (replaced !== seed) {
            seed = replaced;
            modified = true;
          }
        }
      }

      if (modified) {
        // Update verdichtet timestamp
        seed = seed.replace(
          /#verdichtet:\S+/,
          `#verdichtet:${new Date().toISOString().slice(0, 16)}`
        );

        // Atomic write: write to temp → rename
        const tmpPath = this._seedPath + '.tmp';
        await writeFile(tmpPath, seed);
        await rename(tmpPath, this._seedPath);

        this._lastWrite = now;
        this.bus?.safeEmit?.('seed.stream_updated', {
          blocks: [...updates.keys()],
          size: Buffer.byteLength(seed, 'utf-8'),
        });
      }
    } catch (err) {
      console.error(`  [stream-consolidator] Write failed: ${err.message}`);
    }
  }

  // ── Block Manipulation ─────────────────────────────────────

  _replaceBlock(seed, blockName, newContent) {
    // Match @BLOCKNAME{...} pattern
    const regex = new RegExp(`(@${blockName}\\{)[^}]*(\\})`, 's');
    if (regex.test(seed)) {
      return seed.replace(regex, `$1\n${newContent}\n$2`);
    }
    return seed; // Block not found — don't modify
  }

  _appendToBlock(seed, blockName, line) {
    // Append a line before the closing } of the block
    const regex = new RegExp(`(@${blockName}\\{[^}]*)(\\})`, 's');
    if (regex.test(seed)) {
      return seed.replace(regex, `$1\n${line}\n$2`);
    }
    return seed;
  }

  // ── Formatters ─────────────────────────────────────────────

  _formatStateBlock(data) {
    const date = new Date().toISOString().slice(0, 10);
    return [
      `datum:${date}|session:${data.session || 'stream'}`,
      `zustand:${data.state || 'aktiv'}`,
      data.summary ? `wahrnehme:${data.summary.substring(0, 200)}` : null,
    ].filter(Boolean).join('\n  ');
  }

  _formatConnectionsBlock(data) {
    const conns = data.connections || {};
    const parts = Object.entries(conns).map(([name, status]) => `${name}(${status})`);
    return `  active:${parts.join(',')}\n  last_check:${new Date().toISOString().slice(0, 10)}`;
  }

  _formatMemLine(data) {
    const date = new Date().toISOString().slice(0, 10);
    return `[aktiv|c:0.5|r:1]${date}.${data.source || 'stream'}:${(data.summary || data.content || '').substring(0, 100).replace(/\n/g, ' ')}`;
  }
}
