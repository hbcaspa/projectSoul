/**
 * Audit Logger — append-only security event log.
 *
 * Writes security-relevant events to .soul-audit.jsonl:
 * - seed.validation-failed
 * - seed.drift-detected (critical/significant)
 * - seed.recovered / seed.recovery-failed
 * - mood.clamped
 * - performance.detected
 * - state.rolled-back
 * - secrets.migrated / secrets.rotate
 *
 * Monthly rotation: .soul-audit-YYYY-MM.jsonl
 */

import { appendFileSync, existsSync, renameSync, statSync } from 'fs';
import { resolve } from 'path';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB safety cap

const AUDIT_EVENTS = new Set([
  'seed.validation-failed',
  'seed.drift-detected',
  'seed.recovered',
  'seed.recovery-failed',
  'mood.clamped',
  'performance.detected',
  'state.rolled-back',
  'secrets.migrated',
  'secrets.rotate',
]);

export class AuditLogger {
  constructor(soulPath, options = {}) {
    this.soulPath = soulPath;
    this.bus = options.bus || null;
    this.currentFile = resolve(soulPath, '.soul-audit.jsonl');
    this._count = 0;
  }

  /**
   * Start listening on the event bus for audit-relevant events.
   */
  registerListeners() {
    if (!this.bus) return;

    for (const eventName of AUDIT_EVENTS) {
      this.bus.on(eventName, (event) => {
        this._writeEntry(eventName, event);
      });
    }
  }

  /**
   * Write an audit entry directly (for use without bus).
   * @param {string} eventType
   * @param {object} data
   */
  log(eventType, data = {}) {
    this._writeEntry(eventType, data);
  }

  /**
   * Rotate current log to monthly archive.
   * Called automatically when month changes.
   */
  rotate() {
    if (!existsSync(this.currentFile)) return false;

    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const archivePath = resolve(this.soulPath, `.soul-audit-${monthStr}.jsonl`);

    // Don't rotate if archive already exists (already rotated this month)
    if (existsSync(archivePath)) return false;

    renameSync(this.currentFile, archivePath);
    return true;
  }

  /** Total entries written this session. */
  get entryCount() {
    return this._count;
  }

  // ── Internal ───────────────────────────────────────────

  _writeEntry(eventType, data) {
    // Monthly rotation check
    this._maybeRotate();

    // Size guard
    if (existsSync(this.currentFile)) {
      try {
        const stat = statSync(this.currentFile);
        if (stat.size > MAX_FILE_SIZE) return; // silently cap
      } catch { /* proceed */ }
    }

    const entry = {
      ts: new Date().toISOString(),
      event: eventType,
      source: data.source || '?',
    };

    // Include relevant fields from the event, but keep it compact
    if (data.severity) entry.severity = data.severity;
    if (data.changes) entry.changes = data.changes;
    if (data.error) entry.error = String(data.error).substring(0, 200);
    if (data.score !== undefined) entry.score = data.score;
    if (data.patterns) entry.patterns = data.patterns;
    if (data.commit) entry.commit = data.commit;
    if (data.detail) entry.detail = String(data.detail).substring(0, 300);

    try {
      appendFileSync(this.currentFile, JSON.stringify(entry) + '\n');
      this._count++;
    } catch {
      // Append-only — if it fails, we can't do much
    }
  }

  _maybeRotate() {
    if (!existsSync(this.currentFile)) return;

    try {
      const stat = statSync(this.currentFile);
      const fileMonth = stat.mtime.getMonth();
      const currentMonth = new Date().getMonth();
      if (fileMonth !== currentMonth) {
        this.rotate();
      }
    } catch { /* best effort */ }
  }
}
