/**
 * SessionManager — SQLite-based session persistence for the Soul Protocol.
 *
 * Replaces .session-active files with proper database-backed sessions.
 * Inspired by Goose's SessionStorage (SQLite + WAL + migrations)
 * and Claude Code's session lifecycle management.
 *
 * Schema:
 *   sessions(id, number, state, started_at, ended_at, summary, tokens_used, metadata)
 *   session_events(id, session_id, type, data, created_at)
 *   checkpoints(id, session_id, phase, status, created_at)
 */

import Database from 'better-sqlite3';
import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';

const DB_FILENAME = '.soul-sessions.db';
const CURRENT_SCHEMA_VERSION = 2;

// Session states — formal state machine
export const SessionState = {
  BOOT: 'boot',
  LOADING: 'loading',          // Reading seed, state, context
  HEARTBEAT: 'heartbeat',      // Running heartbeat checks
  ACTIVE: 'active',            // Main conversation
  CLOSING_PHASE_A: 'closing_a', // Parallel closings
  CLOSING_PHASE_B: 'closing_b', // Seed condensation
  COMPLETED: 'completed',       // Clean exit
  CRASHED: 'crashed',           // Unclean exit (detected at next boot)
  RECOVERED: 'recovered',       // Crash recovery completed
};

// Valid state transitions
const TRANSITIONS = {
  [SessionState.BOOT]:           [SessionState.LOADING, SessionState.CRASHED],
  [SessionState.LOADING]:        [SessionState.HEARTBEAT, SessionState.ACTIVE, SessionState.CRASHED],
  [SessionState.HEARTBEAT]:      [SessionState.ACTIVE, SessionState.CRASHED],
  [SessionState.ACTIVE]:         [SessionState.CLOSING_PHASE_A, SessionState.CRASHED],
  [SessionState.CLOSING_PHASE_A]:[SessionState.CLOSING_PHASE_B, SessionState.CRASHED],
  [SessionState.CLOSING_PHASE_B]:[SessionState.COMPLETED, SessionState.CRASHED],
  [SessionState.CRASHED]:        [SessionState.RECOVERED],
  [SessionState.RECOVERED]:      [SessionState.COMPLETED],
};

export class SessionManager {
  constructor(soulPath, { bus } = {}) {
    this.soulPath = soulPath;
    this.bus = bus || null;
    this.dbPath = resolve(soulPath, DB_FILENAME);
    this.db = null;
    this.currentSession = null;
  }

  init() {
    const dir = resolve(this.soulPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this._createSchema();
    this._migrate();
    return this;
  }

  _createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'boot',
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        summary TEXT DEFAULT '',
        tokens_used INTEGER DEFAULT 0,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        UNIQUE(number)
      );

      CREATE TABLE IF NOT EXISTS session_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        phase TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
      CREATE INDEX IF NOT EXISTS idx_sessions_number ON sessions(number);
      CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
    `);

    // Initialize schema version if empty
    const row = this.db.prepare('SELECT version FROM schema_version LIMIT 1').get();
    if (!row) {
      this.db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_SCHEMA_VERSION);
    }
  }

  _migrate() {
    const row = this.db.prepare('SELECT version FROM schema_version LIMIT 1').get();
    const currentVersion = row?.version || 0;

    if (currentVersion < 2) {
      // v2: FTS5 full-text search over session events
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS session_events_fts USING fts5(
          type, data,
          content=session_events,
          content_rowid=id
        );

        CREATE TRIGGER IF NOT EXISTS session_events_fts_ai AFTER INSERT ON session_events BEGIN
          INSERT INTO session_events_fts(rowid, type, data) VALUES (new.id, new.type, new.data);
        END;
      `);

      // Index existing events
      const existing = this.db.prepare('SELECT id, type, data FROM session_events').all();
      if (existing.length > 0) {
        const stmt = this.db.prepare('INSERT OR IGNORE INTO session_events_fts(rowid, type, data) VALUES (?, ?, ?)');
        const tx = this.db.transaction(() => {
          for (const e of existing) stmt.run(e.id, e.type, e.data);
        });
        tx();
        console.log(`  [sessions] FTS5: indexed ${existing.length} existing events`);
      }
    }

    if (currentVersion < CURRENT_SCHEMA_VERSION) {
      this.db.prepare('UPDATE schema_version SET version = ?').run(CURRENT_SCHEMA_VERSION);
    }
  }

  // --- Session Lifecycle ---

  /**
   * Get the next session number (auto-incrementing).
   */
  getNextSessionNumber() {
    const row = this.db.prepare('SELECT MAX(number) as max_num FROM sessions').get();
    return (row?.max_num || 0) + 1;
  }

  /**
   * Check for crashed sessions (state not completed/recovered).
   * Returns the crashed session or null.
   */
  findCrashedSession() {
    return this.db.prepare(`
      SELECT * FROM sessions
      WHERE state NOT IN ('completed', 'recovered', 'crashed')
      ORDER BY number DESC LIMIT 1
    `).get() || null;
  }

  /**
   * Start a new session. Returns the session object.
   */
  startSession(description = '') {
    const number = this.getNextSessionNumber();

    const info = this.db.prepare(`
      INSERT INTO sessions (number, state, metadata)
      VALUES (?, ?, ?)
    `).run(number, SessionState.BOOT, JSON.stringify({ description }));

    this.currentSession = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid);

    this._createCheckpoints(this.currentSession.id);
    this._logEvent('session.started', { number, description });

    if (this.bus) {
      this.bus.safeEmit('session.started', {
        sessionId: this.currentSession.id,
        number,
        source: 'session-manager'
      });
    }

    return this.currentSession;
  }

  /**
   * Transition the current session to a new state.
   * Enforces the state machine — invalid transitions throw.
   */
  transition(newState) {
    if (!this.currentSession) {
      throw new Error('No active session');
    }

    const currentState = this.currentSession.state;
    const allowed = TRANSITIONS[currentState];

    if (!allowed || !allowed.includes(newState)) {
      throw new Error(
        `Invalid session transition: ${currentState} → ${newState}. ` +
        `Allowed: ${(allowed || []).join(', ')}`
      );
    }

    const updates = { state: newState };
    if (newState === SessionState.COMPLETED || newState === SessionState.RECOVERED) {
      updates.ended_at = new Date().toISOString();
    }

    this.db.prepare(`
      UPDATE sessions SET state = ?, ended_at = COALESCE(?, ended_at)
      WHERE id = ?
    `).run(newState, updates.ended_at || null, this.currentSession.id);

    const oldState = this.currentSession.state;
    this.currentSession.state = newState;

    this._logEvent('session.transition', { from: oldState, to: newState });

    if (this.bus) {
      this.bus.safeEmit('session.transition', {
        sessionId: this.currentSession.id,
        from: oldState,
        to: newState,
        source: 'session-manager'
      });
    }

    return this.currentSession;
  }

  /**
   * Mark a crashed session as recovered.
   */
  recoverSession(sessionId) {
    const session = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    this.db.prepare(`
      UPDATE sessions SET state = 'crashed' WHERE id = ? AND state NOT IN ('completed', 'recovered')
    `).run(sessionId);

    this.db.prepare(`
      UPDATE sessions SET state = 'recovered', ended_at = datetime('now') WHERE id = ?
    `).run(sessionId);

    this._logEvent('session.recovered', { sessionId, originalState: session.state });
  }

  // --- Checkpoints (Phase A/B tracking) ---

  _createCheckpoints(sessionId) {
    const phases = [
      'state_log', 'evolution', 'heartbeat', 'memories', 'index',  // Phase A
      'seed_condensation',  // Phase B
      'guard_cleanup'       // Phase C
    ];

    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (session_id, phase, status) VALUES (?, ?, 'pending')
    `);

    const tx = this.db.transaction(() => {
      for (const phase of phases) {
        stmt.run(sessionId, phase);
      }
    });
    tx();
  }

  /**
   * Mark a checkpoint phase as started/completed.
   */
  updateCheckpoint(phase, status) {
    if (!this.currentSession) return;

    const timeField = status === 'completed' ? 'completed_at' : 'started_at';
    this.db.prepare(`
      UPDATE checkpoints SET status = ?, ${timeField} = datetime('now')
      WHERE session_id = ? AND phase = ?
    `).run(status, this.currentSession.id, phase);

    this._logEvent('checkpoint.updated', { phase, status });
  }

  /**
   * Get all checkpoints for the current session.
   */
  getCheckpoints(sessionId = null) {
    const id = sessionId || this.currentSession?.id;
    if (!id) return [];
    return this.db.prepare('SELECT * FROM checkpoints WHERE session_id = ? ORDER BY id').all(id);
  }

  /**
   * Check if all Phase A checkpoints are complete.
   */
  isPhaseAComplete() {
    if (!this.currentSession) return false;
    const phaseA = ['state_log', 'evolution', 'heartbeat', 'memories', 'index'];
    const pending = this.db.prepare(`
      SELECT COUNT(*) as count FROM checkpoints
      WHERE session_id = ? AND phase IN (${phaseA.map(() => '?').join(',')}) AND status != 'completed'
    `).get(this.currentSession.id, ...phaseA);
    return pending.count === 0;
  }

  // --- Event Logging ---

  _logEvent(type, data = {}) {
    if (!this.currentSession) return;
    this.db.prepare(`
      INSERT INTO session_events (session_id, type, data) VALUES (?, ?, ?)
    `).run(this.currentSession.id, type, JSON.stringify(data));
  }

  /**
   * Log a custom event for the current session.
   */
  logEvent(type, data = {}) {
    this._logEvent(type, data);
  }

  /**
   * Update token usage for the current session.
   */
  addTokenUsage(input = 0, output = 0) {
    if (!this.currentSession) return;
    this.db.prepare(`
      UPDATE sessions SET
        tokens_used = tokens_used + ?,
        input_tokens = input_tokens + ?,
        output_tokens = output_tokens + ?
      WHERE id = ?
    `).run(input + output, input, output, this.currentSession.id);
  }

  // --- Queries ---

  /**
   * Get the current active session.
   * Returns currentSession if it's in a non-terminal state,
   * otherwise queries the DB for the most recent non-terminal session.
   * Returns null if no active session exists.
   */
  getCurrentSession() {
    const terminalStates = [SessionState.COMPLETED, SessionState.CRASHED, SessionState.RECOVERED];

    if (this.currentSession && !terminalStates.includes(this.currentSession.state)) {
      return this.currentSession;
    }

    const session = this.db.prepare(`
      SELECT * FROM sessions
      WHERE state NOT IN ('completed', 'crashed', 'recovered')
      ORDER BY number DESC LIMIT 1
    `).get() || null;

    if (session) {
      this.currentSession = session;
    }

    return session;
  }

  /**
   * Get session by number.
   */
  getSession(number) {
    return this.db.prepare('SELECT * FROM sessions WHERE number = ?').get(number);
  }

  /**
   * Get recent sessions.
   */
  getRecentSessions(limit = 20) {
    return this.db.prepare('SELECT * FROM sessions ORDER BY number DESC LIMIT ?').all(limit);
  }

  /**
   * Get session events.
   */
  getEvents(sessionId, limit = 100) {
    return this.db.prepare(
      'SELECT * FROM session_events WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(sessionId, limit);
  }

  /**
   * Get aggregate stats.
   */
  getStats() {
    const total = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get();
    const completed = this.db.prepare("SELECT COUNT(*) as count FROM sessions WHERE state = 'completed'").get();
    const crashed = this.db.prepare("SELECT COUNT(*) as count FROM sessions WHERE state = 'crashed'").get();
    const tokens = this.db.prepare('SELECT SUM(tokens_used) as total FROM sessions').get();

    return {
      total: total.count,
      completed: completed.count,
      crashed: crashed.count,
      completionRate: total.count > 0 ? (completed.count / total.count * 100).toFixed(1) + '%' : '0%',
      totalTokens: tokens.total || 0,
    };
  }

  /**
   * Full-text search across all session events.
   * Returns matching events with their session context.
   */
  searchSessions(query, limit = 20) {
    if (!query || !query.trim()) return [];
    try {
      return this.db.prepare(`
        SELECT
          e.id, e.session_id, e.type, e.data, e.created_at,
          s.number as session_number, s.state as session_state, s.started_at as session_started,
          snippet(session_events_fts, 1, '>>>', '<<<', '...', 40) as snippet,
          rank
        FROM session_events_fts fts
        JOIN session_events e ON e.id = fts.rowid
        JOIN sessions s ON s.id = e.session_id
        WHERE session_events_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(query, limit);
    } catch {
      return [];
    }
  }

  /**
   * Close the database connection.
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
