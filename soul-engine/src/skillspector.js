/**
 * SkillSpector wrapper — runs NVIDIA SkillSpector (security scanner for agent skills)
 * as a local CLI subprocess and normalizes its output.
 *
 * This is the ONLY place coupled to the real SkillSpector CLI. Verified interface
 * (README): `skillspector scan <path> --format json`, JSON result has `risk_score`
 * (0-100), `risk_severity`, `risk_recommendation`, and `filtered_findings[]` with
 * `{severity, rule_id, message}`. No stdin support → code is scanned via a temp file.
 *
 * Defensive: if the CLI is not installed (current state — it requires a manual
 * `git clone + uv venv + make install`), every function returns { available:false }
 * instead of throwing, so the scheduler/foundry callers degrade gracefully.
 *
 * Config (.env):
 *   SKILLSPECTOR_BIN         path/name of the CLI (default "skillspector")
 *   SKILLSPECTOR_SCAN_ROOT   base dir for relative targets (default the soul root —
 *                            NOT engine soulPath, which points at seelen-protokoll/)
 *   SKILLSPECTOR_HIGH        risk-score threshold for "high" (default 70)
 *   SKILLSPECTOR_TIMEOUT_MS  per-scan timeout (default 60000)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute, resolve } from 'node:path';

const BIN          = process.env.SKILLSPECTOR_BIN || 'skillspector';
const SCAN_ROOT    = process.env.SKILLSPECTOR_SCAN_ROOT || '/Users/aalm/Projects/soul';
export const HIGH_THRESHOLD = parseInt(process.env.SKILLSPECTOR_HIGH || '70', 10);
const TIMEOUT_MS   = parseInt(process.env.SKILLSPECTOR_TIMEOUT_MS || '60000', 10);

// Default scan targets (relative to SCAN_ROOT): the actual skill surface.
export const DEFAULT_TARGETS = ['skills', '.mcp.json'];

/**
 * Scan one absolute path. Never throws.
 * @returns {Promise<{target,available,ok,risk_score,severity,findings,error?}>}
 */
export function scanPath(target) {
  const abs = isAbsolute(target) ? target : resolve(SCAN_ROOT, target);
  return new Promise((resolveP) => {
    let stdout = '';
    let stderr = '';
    let proc;
    try {
      // --no-llm: statische YARA/Pattern-Checks only — kein API-Key nötig, keine
      // Skill-Inhalte an OpenAI (Privacy). LangChain-Warnung geht auf stderr → stdout = reines JSON.
      proc = spawn(BIN, ['scan', abs, '--format', 'json', '--no-llm'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolveP({ target, available: false, ok: false, risk_score: 0, findings: [], error: err.message });
    }
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* */ } }, TIMEOUT_MS);

    proc.stdout.on('data', d => { stdout += d.toString(); if (stdout.length > 2_000_000) stdout = stdout.slice(0, 2_000_000); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('error', (err) => {
      clearTimeout(timer);
      // ENOENT = CLI not installed → mark unavailable (graceful), not a hard error.
      const unavailable = err.code === 'ENOENT';
      resolveP({ target, available: !unavailable, ok: false, risk_score: 0, findings: [], error: err.message });
    });

    proc.on('close', () => {
      clearTimeout(timer);
      let parsed = null;
      try { parsed = JSON.parse(stdout); } catch { /* non-JSON output */ }
      // Real SkillSpector v2.2.3 schema (verified against live output): score lives at
      // risk_assessment.score, findings at issues[]. (README's risk_score/filtered_findings
      // was outdated — verified by running the actual CLI.)
      const score = parsed?.risk_assessment?.score;
      if (typeof score !== 'number') {
        return resolveP({ target, available: true, ok: false, risk_score: 0, findings: [],
          error: `Unerwartete SkillSpector-Ausgabe${stderr ? ': ' + stderr.slice(0, 200) : ''}` });
      }
      // Keep only metadata per finding — NO raw message snippets (.mcp.json holds
      // plaintext tokens; raw findings could leak fragments into the Telegram log).
      const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
      const findings = issues.map(i => ({
        severity: i.severity, type: i.type || i.category || i.rule_id || i.check,
      }));
      resolveP({
        target, available: true, ok: true,
        risk_score: score,
        severity: parsed.risk_assessment.severity,
        findings,
      });
    });
  });
}

/**
 * Scan multiple targets (relative to SCAN_ROOT or absolute). Never throws.
 * @returns {Promise<{maxScore:number, results:Array}>}
 */
export async function scanTargets(targets = DEFAULT_TARGETS, root) {
  const list = Array.isArray(targets) && targets.length ? targets : DEFAULT_TARGETS;
  const results = [];
  for (const t of list) {
    const abs = root ? resolve(root, t) : (isAbsolute(t) ? t : resolve(SCAN_ROOT, t));
    results.push(await scanPath(abs));
  }
  const usable = results.filter(r => r.available && r.ok);
  const maxScore = usable.reduce((m, r) => Math.max(m, r.risk_score || 0), 0);
  return { maxScore, results };
}

/**
 * Scan a generated skill given its raw code/markdown (Foundry pre-activation gate).
 * SkillSpector has no stdin → write to a temp SKILL.md and scan it. Never throws.
 */
export async function scan({ code, path: p } = {}) {
  if (p) return scanPath(p);
  if (typeof code !== 'string') return { available: false, ok: false, risk_score: 0, findings: [], error: 'no code/path' };
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'skillspector-'));
    writeFileSync(join(dir, 'SKILL.md'), code, 'utf-8');
    return await scanPath(dir);
  } catch (err) {
    return { available: false, ok: false, risk_score: 0, findings: [], error: err.message };
  } finally {
    if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } }
  }
}
