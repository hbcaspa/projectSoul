/**
 * CheapHeartbeat — Pre-check with cheap scripts before calling LLM.
 *
 * Inspired by OpenClaw's two-tier heartbeat:
 * 1. Cheap checks first (no LLM cost): new emails? calendar? system alerts?
 * 2. Only if something relevant found → call LLM for interpretation
 *
 * This wraps the existing HeartbeatScheduler and adds a pre-filter
 * that runs fast, deterministic checks before expensive LLM calls.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { exec } from 'child_process';

export class CheapHeartbeat {
  constructor({ soulPath, bus, mcp, llm, heartbeat } = {}) {
    this.soulPath = soulPath;
    this.bus = bus || null;
    this.mcp = mcp || null;
    this.llm = llm || null;
    this.heartbeat = heartbeat || null; // Original HeartbeatScheduler
    this.checks = [];
    this.stats = { cheapRuns: 0, llmEscalations: 0, saved: 0 };

    this._registerDefaultChecks();
  }

  /**
   * Register a cheap check (no LLM, fast, deterministic).
   *
   * @param {string} id - Check identifier
   * @param {object} check
   * @param {string} check.name - Display name
   * @param {Function} check.run - () => Promise<{ relevant: boolean, summary: string }>
   * @param {number} check.intervalMin - Minimum minutes between runs
   */
  registerCheck(id, check) {
    this.checks.push({
      id,
      name: check.name,
      run: check.run,
      intervalMin: check.intervalMin || 30,
      lastRun: 0,
    });
  }

  /**
   * Run all cheap checks. Returns findings that warrant LLM attention.
   */
  async runCheapChecks() {
    this.stats.cheapRuns++;
    const findings = [];
    const now = Date.now();

    for (const check of this.checks) {
      // Respect interval
      if (now - check.lastRun < check.intervalMin * 60000) continue;
      check.lastRun = now;

      try {
        const result = await check.run();
        if (result && result.relevant) {
          findings.push({
            check: check.id,
            name: check.name,
            summary: result.summary,
          });
        }
      } catch (err) {
        console.error(`  [cheap-hb] Check ${check.id} failed: ${err.message}`);
      }
    }

    if (findings.length > 0) {
      this.stats.llmEscalations++;
      if (this.bus) {
        this.bus.safeEmit('heartbeat.cheap_findings', {
          source: 'cheap-heartbeat',
          count: findings.length,
          checks: findings.map(f => f.check),
        });
      }
    } else {
      this.stats.saved++;
    }

    return findings;
  }

  /**
   * Two-tier heartbeat: cheap checks first, LLM only if needed.
   * Replaces direct LLM heartbeat calls.
   */
  async runTwoTier() {
    const findings = await this.runCheapChecks();

    if (findings.length === 0) {
      // Nothing interesting → skip LLM call (save tokens!)
      console.log('  [cheap-hb] No findings — skipping LLM heartbeat');
      if (this.bus) {
        this.bus.safeEmit('heartbeat.skipped', {
          source: 'cheap-heartbeat',
          reason: 'no_findings',
        });
      }
      return { skipped: true, reason: 'no_findings' };
    }

    // Build context for LLM from findings
    const findingsSummary = findings
      .map(f => `- ${f.name}: ${f.summary}`)
      .join('\n');

    console.log(`  [cheap-hb] ${findings.length} findings → escalating to LLM`);

    return {
      skipped: false,
      findings,
      findingsSummary,
    };
  }

  /**
   * Register default cheap checks.
   */
  _registerDefaultChecks() {
    // Check 1: New files in relay/ (incoming messages from other nodes)
    this.registerCheck('relay_inbox', {
      name: 'Relay Inbox',
      intervalMin: 5,
      run: async () => {
        const relayDir = resolve(this.soulPath, 'relay', 'inbox');
        if (!existsSync(relayDir)) return { relevant: false };
        try {
          const { readdirSync } = await import('fs');
          const files = readdirSync(relayDir).filter(f => f.endsWith('.json'));
          return {
            relevant: files.length > 0,
            summary: `${files.length} unprocessed relay message(s)`,
          };
        } catch { return { relevant: false }; }
      },
    });

    // Check 2: Seed changed since last heartbeat
    this.registerCheck('seed_changed', {
      name: 'Seed Modified',
      intervalMin: 15,
      run: async () => {
        const seedPath = resolve(this.soulPath, 'SEED.md');
        if (!existsSync(seedPath)) return { relevant: false };
        try {
          const stat = statSync(seedPath);
          const ageMin = (Date.now() - stat.mtimeMs) / 60000;
          return {
            relevant: ageMin < 30, // Modified in last 30 min
            summary: `SEED.md modified ${Math.round(ageMin)}min ago`,
          };
        } catch { return { relevant: false }; }
      },
    });

    // Check 3: .soul-pulse activity (is someone using the soul?)
    this.registerCheck('pulse_activity', {
      name: 'Recent Activity',
      intervalMin: 10,
      run: async () => {
        const pulsePath = resolve(this.soulPath, '.soul-pulse');
        if (!existsSync(pulsePath)) return { relevant: false };
        try {
          const stat = statSync(pulsePath);
          const ageMin = (Date.now() - stat.mtimeMs) / 60000;
          return {
            relevant: ageMin < 15,
            summary: `Activity pulse ${Math.round(ageMin)}min ago`,
          };
        } catch { return { relevant: false }; }
      },
    });

    // Check 4: Disk space on server
    this.registerCheck('disk_space', {
      name: 'Disk Space',
      intervalMin: 60,
      run: () => new Promise((resolve) => {
        exec('df -h / | tail -1', { timeout: 5000 }, (err, stdout) => {
          if (err) return resolve({ relevant: false });
          const match = stdout.match(/(\d+)%/);
          if (!match) return resolve({ relevant: false });
          const usage = parseInt(match[1]);
          resolve({
            relevant: usage > 85,
            summary: `Disk usage at ${usage}%`,
          });
        });
      }),
    });

    // Check 5: Engine uptime (detect restarts)
    this.registerCheck('uptime', {
      name: 'Engine Uptime',
      intervalMin: 60,
      run: async () => {
        const uptimeMin = process.uptime() / 60;
        return {
          relevant: uptimeMin < 5, // Restarted recently
          summary: `Engine uptime: ${Math.round(uptimeMin)}min (recent restart)`,
        };
      },
    });
  }

  getStats() {
    return {
      ...this.stats,
      checks: this.checks.map(c => ({
        id: c.id,
        name: c.name,
        lastRun: c.lastRun ? new Date(c.lastRun).toISOString() : null,
      })),
    };
  }
}
