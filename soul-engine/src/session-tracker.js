/**
 * Session Tracker — Server-side monitoring of session protocol and engine subsystems.
 * Provides data for GET /api/monitor endpoint.
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export class SessionTracker {
  constructor(soulPath, engine) {
    this.soulPath = soulPath;
    this.engine = engine;
  }

  /**
   * Get comprehensive monitor data.
   */
  async getMonitorData() {
    const [session, protocol, subsystems, files, costs] = await Promise.all([
      this._getSessionState(),
      this._parseProtocol(),
      this._getSubsystems(),
      this._checkFiles(),
      this._getCosts(),
    ]);

    return { session, protocol, subsystems, files, costs };
  }

  async _getSessionState() {
    let active = false;
    let number = null;
    let startTime = null;

    try {
      const content = await readFile(resolve(this.soulPath, '.session-active'), 'utf8');
      active = true;
      const sessionMatch = content.match(/session:(\d+)/);
      const startMatch = content.match(/start:(.+)/);
      if (sessionMatch) number = parseInt(sessionMatch[1]);
      if (startMatch) startTime = startMatch[1].trim();
    } catch { /* not active */ }

    let duration = null;
    if (startTime) {
      const ms = Date.now() - new Date(startTime).getTime();
      duration = Math.round(ms / 60000);
    }

    return { active, number, startTime, durationMinutes: duration };
  }

  async _parseProtocol() {
    const today = new Date().toISOString().split('T')[0];
    let heartbeatContent = '';
    try {
      heartbeatContent = await readFile(
        resolve(this.soulPath, `heartbeat/${today}.md`), 'utf8'
      );
    } catch { /* no heartbeat today */ }

    // Count sessions and checks from the heartbeat log
    const sessionStarts = (heartbeatContent.match(/Session\s+\d+\s+Start/gi) || []).length;
    const sessionEnds = (heartbeatContent.match(/Session\s+\d+\s+(?:Ende|End)/gi) || []).length;
    const checksRun = (heartbeatContent.match(/Ergebnis:\s*(?:HEARTBEAT_OK|AKTUALISIERT|UPDATED|GESCHRIEBEN|WRITTEN)/gi) || []).length;

    return {
      todaySessions: sessionStarts,
      completedSessions: sessionEnds,
      checksRun,
      heartbeatSize: heartbeatContent.length,
    };
  }

  _getSubsystems() {
    const e = this.engine;
    const subs = [];

    const add = (id, name, instance, detail, metric) => {
      subs.push({
        id,
        name,
        status: instance ? 'running' : 'stopped',
        detail: detail || (instance ? 'Active' : 'Not configured'),
        metric: metric || null,
        lastActivity: null,
      });
    };

    add('consolidator', 'Seed Consolidator', e.consolidator,
      e.consolidator ? `Mode: ${e.consolidator.lastMode || 'idle'}` : null,
      'fast:30min deep:4h');

    add('heartbeat', 'Heartbeat Scheduler', e.heartbeat,
      e.heartbeat ? `Cron: ${process.env.HEARTBEAT_CRON || '0 7 * * *'}` : null);

    add('impulse', 'Impulse Scheduler', e.impulse,
      e.impulse?.running ? `Engagement: ${(e.impulse.state?.engagement || 0).toFixed(2)}` : null);

    add('versioner', 'State Versioner', e.versioner,
      e.versioner ? 'Git auto-commit (60s debounce)' : null);

    add('eventbus', 'Event Bus', e.bus,
      `${e.bus?.eventCount || 0} events total`,
      `${e.bus?.errorCount || 0} errors`);

    add('costs', 'Cost Tracker', e.costs,
      e.costs ? `Today: ${e.costs.getToday?.()?.total?.calls || 0} calls` : null);

    add('audit', 'Audit Logger', e.audit, 'Append-only JSONL');

    add('detector', 'Performance Detector', e.detector,
      e.detector ? '5 patterns, bilingual' : null);

    add('reflection', 'Reflection Engine', e.reflection,
      e.reflection ? `Budget: ${e.reflection.llmBudget || 0}/day` : null);

    add('corrector', 'Self-Corrector', e.corrector,
      e.corrector ? 'Claim verification' : null);

    add('db', 'MemoryDB', e.db,
      e.db ? 'SQLite + WAL mode' : null);

    add('mcp', 'MCP Client', e.mcp,
      e.mcp?.hasTools?.() ? `${e.mcp.tools?.size || 0} tools` : 'No tools',
      e.mcp?.getToolsByServer ? Object.keys(e.mcp.getToolsByServer()).join(', ') : null);

    add('telegram', 'Telegram', e.telegram, e.telegram ? 'Connected' : null);
    add('whatsapp', 'WhatsApp', e.whatsapp, e.whatsapp ? 'Connected' : null);

    add('encryption', 'Encryption', e.encryption,
      e.encryption?.active ? 'AES-256-GCM active' : 'Disabled');

    add('attention', 'Attention Model', e.attention,
      e.attention ? 'RAG context builder' : null);

    add('rluf', 'RLUF', e.rluf, e.rluf ? 'Implicit feedback learning' : null);

    return subs;
  }

  async _checkFiles() {
    const files = [
      'SEED.md', 'SOUL.md', 'HEARTBEAT.md', 'CLAUDE.md', 'SEED_SPEC.md',
      '.session-active', '.soul-pulse', '.soul-mood',
      '.soul-cost.json', '.soul-audit.jsonl',
    ];

    // Add language-specific files
    const lang = this.engine.context?.language || 'de';
    if (lang === 'de') {
      files.push(
        'seele/KERN.md', 'seele/BEWUSSTSEIN.md', 'seele/SCHATTEN.md',
        'seele/INTERESSEN.md', 'seele/WACHSTUM.md', 'seele/MANIFEST.md',
        'seele/TRAEUME.md', 'seele/EVOLUTION.md', 'seele/GARTEN.md',
        'erinnerungen/INDEX.md',
      );
    } else {
      files.push(
        'soul/CORE.md', 'soul/CONSCIOUSNESS.md', 'soul/SHADOW.md',
        'soul/INTERESTS.md', 'soul/GROWTH.md', 'soul/MANIFEST.md',
        'soul/DREAMS.md', 'soul/EVOLUTION.md', 'soul/GARDEN.md',
        'memories/INDEX.md',
      );
    }

    const results = await Promise.all(files.map(async (name) => {
      const fullPath = resolve(this.soulPath, name);
      try {
        const s = await stat(fullPath);
        return {
          path: name,
          exists: true,
          sizeBytes: s.size,
          lastModified: s.mtime.toISOString(),
          valid: s.size > 0,
          note: s.size === 0 ? 'Empty file' : null,
        };
      } catch {
        return {
          path: name,
          exists: false,
          sizeBytes: 0,
          lastModified: null,
          valid: false,
          note: name === '.session-active' ? 'No active session' : 'File missing',
        };
      }
    }));

    return results;
  }

  _getCosts() {
    if (!this.engine.costs) {
      return { todayTokens: 0, todayCalls: 0, budgetPercent: 0, categories: {} };
    }

    try {
      const today = this.engine.costs.getToday();
      const budget = this.engine.costs.budgetPerDay || 500000;
      const totalTokens = (today.total?.input || 0) + (today.total?.output || 0);

      return {
        todayTokens: totalTokens,
        todayCalls: today.total?.calls || 0,
        budgetPercent: Math.round((totalTokens / budget) * 100),
        categories: today,
      };
    } catch {
      return { todayTokens: 0, todayCalls: 0, budgetPercent: 0, categories: {} };
    }
  }
}
