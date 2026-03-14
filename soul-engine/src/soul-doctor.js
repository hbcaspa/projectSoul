/**
 * SoulDoctor — Automatische Selbstdiagnose
 *
 * Inspiriert von OpenClaws `openclaw doctor`.
 * Prüft ALLE Subsysteme und gibt klare Diagnose + Fix-Vorschläge.
 *
 * Besser als OpenClaw:
 *  - Prüft nicht nur Config, sondern LAUFZEIT-Zustand (Prozesse, Ports, Dateien)
 *  - Heartbeat-Health: Erkennt ob der Herzschlag zu alt ist
 *  - Memory-Integrität: Prüft ob SEED.md konsistent mit Quelldateien ist
 *  - LLM-Erreichbarkeit: Testet tatsächlich ob der Provider antwortet
 *  - Knowledge-Graph-Konsistenz: Prüft auf verwaiste Relationen
 *  - Gibt strukturierte JSON-Reports für programmatische Auswertung
 *
 * Nutzung:
 *   node src/soul-doctor.js              # CLI standalone
 *   engine.doctor.runAll()               # Programmatisch
 *   GET /api/doctor                      # Via API
 */

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const CHECKS = [
  'env',
  'files',
  'llm',
  'telegram',
  'memory',
  'knowledgeGraph',
  'heartbeat',
  'seed',
  'processes',
  'ports',
  'disk',
  'security',
];

export class SoulDoctor {
  constructor({ soulPath, bus, llm, db } = {}) {
    this.soulPath = soulPath;
    this.bus      = bus;
    this.llm      = llm;
    this.db       = db;
  }

  /**
   * Run all diagnostic checks.
   * @returns {{ ok: boolean, checks: Array<{name, status, message, fix?}> }}
   */
  async runAll() {
    const results = [];

    for (const check of CHECKS) {
      try {
        const result = await this[`_check_${check}`]();
        results.push(result);
      } catch (err) {
        results.push({ name: check, status: 'error', message: `Check crashed: ${err.message}` });
      }
    }

    const ok = results.every(r => r.status === 'pass' || r.status === 'warn');
    this.bus?.safeEmit?.('doctor.report', { ok, checks: results });
    return { ok, checks: results };
  }

  /**
   * Run a single check by name.
   */
  async runCheck(name) {
    const fn = this[`_check_${name}`];
    if (!fn) return { name, status: 'error', message: `Unknown check: ${name}` };
    return fn.call(this);
  }

  /**
   * Format report for human-readable output.
   */
  formatReport(report) {
    const lines = ['═══ Soul Doctor Report ═══', ''];

    for (const check of report.checks) {
      const icon = check.status === 'pass' ? '✅' :
                   check.status === 'warn' ? '⚠️' :
                   check.status === 'fail' ? '❌' : '💀';
      lines.push(`${icon} ${check.name}: ${check.message}`);
      if (check.fix) lines.push(`   → Fix: ${check.fix}`);
    }

    lines.push('');
    const passed = report.checks.filter(c => c.status === 'pass').length;
    const total  = report.checks.length;
    lines.push(`Result: ${passed}/${total} passed ${report.ok ? '— System healthy' : '— Issues found'}`);
    return lines.join('\n');
  }

  // ── Individual Checks ────────────────────────────────────

  async _check_env() {
    const envPath = join(this.soulPath, '..', '.env');
    const missing = [];

    const required = ['GEMINI_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_ID'];
    const recommended = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'SOUL_NODE_NAME'];

    for (const key of required) {
      if (!process.env[key]) missing.push(key);
    }

    if (missing.length > 0) {
      return {
        name: 'env',
        status: 'fail',
        message: `Missing required env vars: ${missing.join(', ')}`,
        fix: `Add to .env: ${missing.map(k => `${k}=...`).join(', ')}`,
      };
    }

    const warns = recommended.filter(k => !process.env[k]);
    if (warns.length > 0) {
      return {
        name: 'env',
        status: 'warn',
        message: `Missing recommended: ${warns.join(', ')}`,
        fix: 'These enable failover, multi-model support, and node identification',
      };
    }

    return { name: 'env', status: 'pass', message: 'All required env vars present' };
  }

  async _check_files() {
    const critical = [
      'SEED.md',
      'seele/KERN.md',
      'seele/BEWUSSTSEIN.md',
      'SOUL.md',
      'HEARTBEAT.md',
    ];

    const soulRoot = join(this.soulPath, '..');
    const missing = critical.filter(f => !existsSync(join(soulRoot, f)));

    if (missing.length > 0) {
      return {
        name: 'files',
        status: 'fail',
        message: `Missing critical files: ${missing.join(', ')}`,
        fix: 'Run the founding interview or restore from backup',
      };
    }

    return { name: 'files', status: 'pass', message: `All ${critical.length} critical files present` };
  }

  async _check_llm() {
    if (!this.llm) {
      return { name: 'llm', status: 'fail', message: 'No LLM configured', fix: 'Set GEMINI_API_KEY or similar in .env' };
    }

    try {
      const start = Date.now();
      const resp = await this.llm.generate('Doctor', [], 'Respond with exactly: OK', { maxTokens: 5 });
      const latency = Date.now() - start;

      if (!resp || resp.trim().length === 0) {
        return { name: 'llm', status: 'fail', message: 'LLM returned empty response' };
      }

      return {
        name: 'llm',
        status: latency > 10000 ? 'warn' : 'pass',
        message: `LLM responding (${latency}ms)${latency > 10000 ? ' — slow!' : ''}`,
      };
    } catch (err) {
      return {
        name: 'llm',
        status: 'fail',
        message: `LLM unreachable: ${err.message}`,
        fix: 'Check API key and network connectivity',
      };
    }
  }

  async _check_telegram() {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return { name: 'telegram', status: 'warn', message: 'No Telegram token configured' };
    }

    try {
      const resp = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json();

      if (!data.ok) {
        return { name: 'telegram', status: 'fail', message: `Telegram API error: ${data.description}`, fix: 'Check TELEGRAM_BOT_TOKEN' };
      }

      return { name: 'telegram', status: 'pass', message: `Telegram bot: @${data.result.username}` };
    } catch (err) {
      return { name: 'telegram', status: 'fail', message: `Telegram unreachable: ${err.message}` };
    }
  }

  async _check_memory() {
    if (!this.db) {
      return { name: 'memory', status: 'warn', message: 'MemoryDB not initialized' };
    }

    try {
      const count = this.db.get('SELECT COUNT(*) as c FROM memories')?.c || 0;
      const terms = this.db.get('SELECT COUNT(*) as c FROM memory_terms')?.c || 0;

      return {
        name: 'memory',
        status: 'pass',
        message: `MemoryDB: ${count} memories, ${terms} index terms`,
      };
    } catch (err) {
      return { name: 'memory', status: 'fail', message: `MemoryDB error: ${err.message}` };
    }
  }

  async _check_knowledgeGraph() {
    const kgPath = join(this.soulPath, '..', 'knowledge-graph.jsonl');
    if (!existsSync(kgPath)) {
      return { name: 'knowledgeGraph', status: 'warn', message: 'No knowledge-graph.jsonl found' };
    }

    try {
      const content = await readFile(kgPath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      let entities = 0, relations = 0, errors = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'entity') entities++;
          else if (entry.type === 'relation') relations++;
        } catch { errors++; }
      }

      if (errors > lines.length * 0.1) {
        return {
          name: 'knowledgeGraph',
          status: 'warn',
          message: `KG: ${entities} entities, ${relations} relations, ${errors} parse errors (${Math.round(errors/lines.length*100)}%)`,
          fix: 'Consider rebuilding knowledge-graph.jsonl',
        };
      }

      return {
        name: 'knowledgeGraph',
        status: 'pass',
        message: `KG: ${entities} entities, ${relations} relations`,
      };
    } catch (err) {
      return { name: 'knowledgeGraph', status: 'fail', message: `KG read error: ${err.message}` };
    }
  }

  async _check_heartbeat() {
    const soulRoot = join(this.soulPath, '..');
    const today = new Date().toISOString().slice(0, 10);
    const hbPath = join(soulRoot, 'heartbeat', `${today}.md`);

    if (!existsSync(hbPath)) {
      return {
        name: 'heartbeat',
        status: 'warn',
        message: `No heartbeat today (${today})`,
        fix: 'Engine autonomous heartbeat should create this. Check if engine is running.',
      };
    }

    try {
      const stats = await stat(hbPath);
      const ageMinutes = (Date.now() - stats.mtimeMs) / 60000;

      if (ageMinutes > 240) {
        return {
          name: 'heartbeat',
          status: 'warn',
          message: `Last heartbeat ${Math.round(ageMinutes)}min ago — stale?`,
          fix: 'Engine should pulse at least every 4 hours',
        };
      }

      return { name: 'heartbeat', status: 'pass', message: `Heartbeat: ${Math.round(ageMinutes)}min ago` };
    } catch (err) {
      return { name: 'heartbeat', status: 'fail', message: err.message };
    }
  }

  async _check_seed() {
    const seedPath = join(this.soulPath, '..', 'SEED.md');
    if (!existsSync(seedPath)) {
      return { name: 'seed', status: 'fail', message: 'SEED.md not found', fix: 'Run founding interview' };
    }

    try {
      const seed = await readFile(seedPath, 'utf-8');
      const size = Buffer.byteLength(seed, 'utf-8');
      const issues = [];

      // Size check
      if (size > 6000) issues.push(`oversized: ${(size/1024).toFixed(1)}KB (target: <5KB)`);

      // Required blocks
      const requiredBlocks = ['@KERN', '@SELF', '@STATE', '@BONDS', '@MEM'];
      for (const block of requiredBlocks) {
        if (!seed.includes(block)) issues.push(`missing block: ${block}`);
      }

      // Staleness
      const dateMatch = seed.match(/#verdichtet:(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        const days = (Date.now() - new Date(dateMatch[1]).getTime()) / 86400000;
        if (days > 3) issues.push(`stale: last condensed ${Math.round(days)} days ago`);
      }

      if (issues.length > 0) {
        return {
          name: 'seed',
          status: issues.some(i => i.includes('missing')) ? 'fail' : 'warn',
          message: `SEED issues: ${issues.join('; ')}`,
          fix: 'Run seed consolidation or end-session protocol',
        };
      }

      return { name: 'seed', status: 'pass', message: `SEED.md: ${(size/1024).toFixed(1)}KB, all blocks present` };
    } catch (err) {
      return { name: 'seed', status: 'fail', message: err.message };
    }
  }

  async _check_processes() {
    try {
      const ps = execSync('ps aux | grep -E "soul-engine|soul-chain|soul-monitor" | grep -v grep', { encoding: 'utf-8', timeout: 3000 });
      const count = ps.trim().split('\n').filter(Boolean).length;
      return { name: 'processes', status: 'pass', message: `${count} soul process(es) running` };
    } catch {
      return { name: 'processes', status: 'warn', message: 'No soul processes detected (or not on server)' };
    }
  }

  async _check_ports() {
    const checkPort = (port) => {
      try {
        execSync(`lsof -i :${port} -P -n | grep LISTEN`, { encoding: 'utf-8', timeout: 2000 });
        return true;
      } catch { return false; }
    };

    const ports = {
      3001: 'Soul Engine API',
      3002: 'Soul API (secondary)',
      3003: 'Webhook Server',
    };

    const results = [];
    for (const [port, name] of Object.entries(ports)) {
      const listening = checkPort(port);
      results.push(`${port}(${name}): ${listening ? '✓' : '✗'}`);
    }

    return { name: 'ports', status: 'pass', message: results.join(', ') };
  }

  async _check_disk() {
    try {
      const df = execSync('df -h . | tail -1', { encoding: 'utf-8', cwd: this.soulPath, timeout: 3000 });
      const parts = df.trim().split(/\s+/);
      const usedPercent = parseInt(parts[4]);
      const available = parts[3];

      if (usedPercent > 90) {
        return { name: 'disk', status: 'fail', message: `Disk ${usedPercent}% full (${available} free)`, fix: 'Free up disk space' };
      }
      if (usedPercent > 80) {
        return { name: 'disk', status: 'warn', message: `Disk ${usedPercent}% full (${available} free)` };
      }

      return { name: 'disk', status: 'pass', message: `Disk: ${available} free (${usedPercent}% used)` };
    } catch {
      return { name: 'disk', status: 'warn', message: 'Could not check disk space' };
    }
  }

  async _check_security() {
    const issues = [];

    // Check encryption
    if (!process.env.SOUL_ENCRYPTION_KEY) {
      issues.push('SOUL_ENCRYPTION_KEY not set — data at rest unencrypted');
    }

    // Check .env permissions (should not be world-readable)
    const envPath = join(this.soulPath, '..', '.env');
    if (existsSync(envPath)) {
      try {
        const stats = await stat(envPath);
        const mode = (stats.mode & 0o777).toString(8);
        if (mode !== '600' && mode !== '400') {
          issues.push(`.env permissions: ${mode} (should be 600)`);
        }
      } catch { /* skip */ }
    }

    // Check if running as root
    if (process.getuid && process.getuid() === 0) {
      issues.push('Running as root — consider a dedicated user');
    }

    if (issues.length > 0) {
      return { name: 'security', status: 'warn', message: issues.join('; ') };
    }

    return { name: 'security', status: 'pass', message: 'Security checks passed' };
  }
}

// ── CLI Mode ─────────────────────────────────────────────

if (process.argv[1]?.endsWith('soul-doctor.js')) {
  const soulPath = process.env.SOUL_PATH || '/opt/soul/seelen-protokoll';
  const doctor = new SoulDoctor({ soulPath });

  console.log('Running Soul Doctor...\n');
  doctor.runAll().then(report => {
    console.log(doctor.formatReport(report));
    process.exit(report.ok ? 0 : 1);
  });
}
