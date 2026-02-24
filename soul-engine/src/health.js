/**
 * Soul Health Check — 6 indicators as traffic-light signals.
 *
 * Indicators:
 *   1. Seed Validity    — SEED.md exists, parseable, version current
 *   2. Chain Sync       — .soul-chain-status exists and recent
 *   3. Cost Budget      — daily token usage within budget
 *   4. Backup Age       — state versioning (git) recent
 *   5. Memory Health    — memory files exist, index maintained
 *   6. Encryption       — .env.enc exists or encryption module loaded
 *
 * Each indicator: { status: 'healthy'|'warning'|'critical', detail: string }
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { resolve } from 'path';
import { parseSeed } from './seed-parser.js';
import { CURRENT_VERSION } from './seed-migration.js';

// ── Status helpers ──────────────────────────────────────────

function healthy(detail) { return { status: 'healthy', detail }; }
function warning(detail) { return { status: 'warning', detail }; }
function critical(detail) { return { status: 'critical', detail }; }

// ── Individual checks ───────────────────────────────────────

function checkSeedValidity(soulPath) {
  const seedPath = resolve(soulPath, 'SEED.md');
  if (!existsSync(seedPath)) return critical('SEED.md not found');

  try {
    const content = readFileSync(seedPath, 'utf-8');
    if (content.length < 50) return critical('SEED.md too small — likely corrupted');

    const soul = parseSeed(content);
    if (!soul.born) return warning('Missing #geboren/#born in seed');
    if (!soul.sessions) return warning('Missing #sessions in seed');

    if (soul.version !== CURRENT_VERSION) {
      return warning(`Seed version ${soul.version || '?'} — current is ${CURRENT_VERSION}`);
    }

    const size = Buffer.byteLength(content, 'utf-8');
    if (size > 8192) return warning(`Seed is ${(size / 1024).toFixed(1)}KB — exceeds 8KB limit`);
    if (size > 5120) return warning(`Seed is ${(size / 1024).toFixed(1)}KB — approaching 5KB target`);

    return healthy(`v${soul.version}, ${soul.sessions} sessions, ${(size / 1024).toFixed(1)}KB`);
  } catch (err) {
    return critical(`Parse error: ${err.message}`);
  }
}

function checkChainSync(soulPath) {
  const statusPath = resolve(soulPath, '.soul-chain-status');
  if (!existsSync(statusPath)) return warning('Chain not configured');

  try {
    const raw = readFileSync(statusPath, 'utf-8');
    const status = JSON.parse(raw);

    if (status.error) return critical(`Chain error: ${status.error}`);
    if (!status.lastSync) return warning('Chain configured but never synced');

    const lastSync = new Date(status.lastSync);
    const ageHours = (Date.now() - lastSync.getTime()) / 3600000;

    if (ageHours > 24) return warning(`Last sync ${Math.floor(ageHours)}h ago`);
    return healthy(`Synced ${Math.floor(ageHours)}h ago, ${status.peers || 0} peers`);
  } catch {
    return warning('Chain status unreadable');
  }
}

function checkCostBudget(soulPath, costs) {
  if (!costs) return warning('Cost tracking not initialized');

  const today = costs.getToday();
  const totalTokens = today.total.input + today.total.output;

  if (totalTokens === 0) return healthy('No API calls today');

  // Default budget: 500K tokens/day
  const budget = costs.budgetPerDay || 500000;
  const usage = totalTokens / budget;

  if (usage > 1.0) return critical(`Over budget: ${(totalTokens / 1000).toFixed(0)}K / ${(budget / 1000).toFixed(0)}K tokens`);
  if (usage > 0.8) return warning(`${Math.round(usage * 100)}% of daily budget used`);
  return healthy(`${(totalTokens / 1000).toFixed(0)}K tokens today (${today.total.calls} calls)`);
}

function checkBackupAge(soulPath) {
  const gitDir = resolve(soulPath, '.git');
  if (!existsSync(gitDir)) return warning('No git repository — state versioning disabled');

  try {
    // Check HEAD ref for last commit time
    const headPath = resolve(gitDir, 'HEAD');
    const headStat = statSync(headPath);
    const ageHours = (Date.now() - headStat.mtimeMs) / 3600000;

    if (ageHours > 48) return warning(`Last commit ${Math.floor(ageHours)}h ago`);
    if (ageHours > 168) return critical(`No commit in ${Math.floor(ageHours / 24)} days`);
    return healthy(`Last activity ${ageHours < 1 ? 'just now' : Math.floor(ageHours) + 'h ago'}`);
  } catch {
    return warning('Cannot read git status');
  }
}

async function checkMemoryHealth(soulPath, language) {
  const memDir = language === 'en' ? 'memories' : 'erinnerungen';
  const memPath = resolve(soulPath, memDir);

  if (!existsSync(memPath)) return warning('Memory directory not found');

  try {
    const indexPath = resolve(memPath, 'INDEX.md');
    const hasIndex = existsSync(indexPath);

    const subdirs = language === 'en'
      ? ['episodic', 'emotional', 'semantic', 'core', 'archive']
      : ['episodisch', 'emotional', 'semantisch', 'kern', 'archiv'];

    let totalFiles = 0;
    let populatedDirs = 0;
    for (const sub of subdirs) {
      const dir = resolve(memPath, sub);
      if (!existsSync(dir)) continue;
      const files = await readdir(dir);
      const mdFiles = files.filter(f => f.endsWith('.md'));
      if (mdFiles.length > 0) populatedDirs++;
      totalFiles += mdFiles.length;
    }

    if (totalFiles === 0) return warning('No memory files yet');
    if (!hasIndex) return warning(`${totalFiles} memory files but no INDEX.md`);
    if (populatedDirs < 2) return warning(`Only ${populatedDirs} memory type(s) populated`);

    return healthy(`${totalFiles} memories across ${populatedDirs} types, index maintained`);
  } catch (err) {
    return warning(`Memory check failed: ${err.message}`);
  }
}

function checkEncryption(soulPath) {
  const encPath = resolve(soulPath, '.env.enc');
  const envPath = resolve(soulPath, '.env');
  const keyPath = resolve(soulPath, '.soul-key');

  if (existsSync(encPath)) {
    return healthy('Secrets encrypted (.env.enc)');
  }

  if (existsSync(envPath) && existsSync(keyPath)) {
    return warning('Encryption key exists but .env not yet encrypted');
  }

  if (existsSync(envPath)) {
    return warning('.env exists in plaintext — run encrypt-env');
  }

  return healthy('No secrets to encrypt');
}

// ── Public API ──────────────────────────────────────────────

/**
 * Run all health checks.
 *
 * @param {string} soulPath
 * @param {object} options — { language?: string, costs?: CostTracker }
 * @returns {{ indicators: Record<string, {status, detail}>, summary: string, overall: string }}
 */
export async function checkHealth(soulPath, options = {}) {
  const language = options.language || 'de';
  const costs = options.costs || null;

  const indicators = {
    seedValidity:  checkSeedValidity(soulPath),
    chainSync:     checkChainSync(soulPath),
    costBudget:    checkCostBudget(soulPath, costs),
    backupAge:     checkBackupAge(soulPath),
    memoryHealth:  await checkMemoryHealth(soulPath, language),
    encryption:    checkEncryption(soulPath),
  };

  // Overall status: worst of all indicators
  const statuses = Object.values(indicators).map(i => i.status);
  let overall = 'healthy';
  if (statuses.includes('warning')) overall = 'warning';
  if (statuses.includes('critical')) overall = 'critical';

  const summaryMap = {
    healthy: 'Soul is healthy',
    warning: 'Soul needs attention',
    critical: 'Critical issues detected',
  };

  return {
    indicators,
    overall,
    summary: summaryMap[overall],
  };
}
