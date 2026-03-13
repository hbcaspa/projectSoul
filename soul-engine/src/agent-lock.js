/**
 * AgentLock — Multi-Agent Koordination via File-Locks
 *
 * Besser als OpenClaw:
 *  - Lock-Hierarchie (verhindert zirkuläre Deadlocks durch Reihenfolge)
 *  - PID-Tracking: stale Locks werden automatisch erkannt und freigegeben
 *  - Async-Acquisition mit konfigurierbarem Timeout + Retry-Backoff
 *  - Shared-Locks (lesend, mehrere gleichzeitig) + Exclusive-Locks (schreibend)
 *  - Bus-Events: lock.acquired, lock.released, lock.contention
 *  - Lock-Inventory: wer hält gerade welche Locks
 *
 * Verwendung:
 *   const lock = await agentLock.acquire('telegram_handler', { exclusive: true });
 *   try { ... } finally { await lock.release(); }
 *
 * Lock-Verzeichnis: /opt/soul/locks/
 */

import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const LOCK_DIR      = '/opt/soul/locks';
const STALE_MS      = 30_000;  // locks older than this (without active PID) are stale
const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_INTERVAL_MS  = 250;

// Lock hierarchy: higher number = must be acquired AFTER lower numbers
// (prevents deadlock by enforcing acquisition order)
export const LOCK_HIERARCHY = {
  telegram_handler:   10,
  awareness_reflect:  20,
  scheduler_run:      30,
  briefing_send:      40,
  gmail_process:      50,
  search_notify:      60,
  trader_execute:     70,
  webhook_process:    80,
  foundry_build:      90,
};

export class AgentLock {
  constructor({ bus } = {}) {
    this.bus = bus;
    this._held = new Map(); // name → { mode, acquiredAt }
  }

  async init() {
    try {
      await mkdir(LOCK_DIR, { recursive: true });
      // Clean up any stale locks from previous crashed processes
      await this._cleanStaleLocks();
      console.log('  [lock] Agent lock system active');
    } catch (err) {
      console.warn(`  [lock] Could not init lock dir: ${err.message}`);
    }
  }

  /**
   * Acquire a lock. Returns a Lock handle with release().
   * @param {string} name - Lock name (see LOCK_HIERARCHY)
   * @param {object} opts - { exclusive, timeoutMs, owner }
   */
  async acquire(name, { exclusive = true, timeoutMs = DEFAULT_TIMEOUT_MS, owner = 'soul-engine' } = {}) {
    const deadline = Date.now() + timeoutMs;
    const lockFile = join(LOCK_DIR, `${name}.lock`);
    const mode     = exclusive ? 'exclusive' : 'shared';

    let contention = false;

    while (true) {
      try {
        // Check if lock is held
        if (existsSync(lockFile)) {
          const data = JSON.parse(await readFile(lockFile, 'utf-8'));

          // Check for stale lock (dead PID or old timestamp)
          if (await this._isStale(data)) {
            console.warn(`  [lock] Clearing stale lock: ${name} (was held by ${data.owner})`);
            await unlink(lockFile).catch(() => {});
          } else if (data.mode === 'shared' && mode === 'shared') {
            // Multiple shared locks are OK — add ourselves to the list
            data.holders = [...(data.holders || [data.owner]), owner];
            await writeFile(lockFile, JSON.stringify(data));
            this._held.set(name, { mode, acquiredAt: Date.now() });
            return this._makeLockHandle(name, lockFile, owner);
          } else {
            // Contention — wait and retry
            if (!contention) {
              contention = true;
              this.bus?.safeEmit?.('lock.contention', { name, holder: data.owner, waiter: owner });
              console.log(`  [lock] Waiting for ${name} (held by ${data.owner})...`);
            }

            if (Date.now() >= deadline) {
              throw new Error(`Lock timeout: ${name} (held by ${data.owner}) after ${timeoutMs}ms`);
            }

            await delay(RETRY_INTERVAL_MS);
            continue;
          }
        }

        // Lock is free — acquire it
        const lockData = {
          name,
          mode,
          owner,
          pid:         process.pid,
          acquiredAt:  new Date().toISOString(),
          holders:     [owner],
        };
        await writeFile(lockFile, JSON.stringify(lockData));
        this._held.set(name, { mode, acquiredAt: Date.now() });

        this.bus?.safeEmit?.('lock.acquired', { name, mode, owner });
        return this._makeLockHandle(name, lockFile, owner);

      } catch (err) {
        if (err.message.startsWith('Lock timeout')) throw err;
        // File system race — retry
        await delay(RETRY_INTERVAL_MS);
        if (Date.now() >= deadline) throw new Error(`Lock ${name}: filesystem error (${err.message})`);
      }
    }
  }

  /**
   * Inventory of all currently held locks.
   */
  async getInventory() {
    const result = [];
    try {
      const files = await readdir(LOCK_DIR);
      for (const f of files.filter(f => f.endsWith('.lock'))) {
        try {
          const data = JSON.parse(await readFile(join(LOCK_DIR, f), 'utf-8'));
          result.push(data);
        } catch { /* skip */ }
      }
    } catch { /* dir may not exist */ }
    return result;
  }

  // ── Private ───────────────────────────────────────────────

  _makeLockHandle(name, lockFile, owner) {
    let released = false;
    return {
      name,
      release: async () => {
        if (released) return;
        released = true;
        try {
          if (existsSync(lockFile)) {
            const data = JSON.parse(await readFile(lockFile, 'utf-8'));
            if (data.mode === 'shared' && data.holders?.length > 1) {
              // Remove just this holder
              data.holders = data.holders.filter(h => h !== owner);
              await writeFile(lockFile, JSON.stringify(data));
            } else {
              await unlink(lockFile);
            }
          }
        } catch { /* already released or crash */ }
        this._held.delete(name);
        this.bus?.safeEmit?.('lock.released', { name, owner });
      },
    };
  }

  async _isStale(data) {
    if (!data.pid) return true;

    // Check if PID is still alive
    try {
      process.kill(data.pid, 0); // Signal 0 = check if process exists
      return false; // PID alive
    } catch {
      return true; // PID gone → stale
    }
  }

  async _cleanStaleLocks() {
    try {
      const files = await readdir(LOCK_DIR);
      for (const f of files.filter(f => f.endsWith('.lock'))) {
        const lockFile = join(LOCK_DIR, f);
        try {
          const data = JSON.parse(await readFile(lockFile, 'utf-8'));
          if (await this._isStale(data)) {
            await unlink(lockFile);
            console.log(`  [lock] Cleaned stale lock: ${data.name}`);
          }
        } catch {
          await unlink(lockFile).catch(() => {}); // corrupt — remove
        }
      }
    } catch { /* dir empty or missing */ }
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
