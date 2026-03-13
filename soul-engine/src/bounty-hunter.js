/**
 * BountyHunter — Autonomer Bug Bounty Recon-Agent
 *
 * Läuft 24/7 auf dem Server. Prüft Bug Bounty Targets auf:
 *  - Exposed .git / .env / backup files
 *  - API endpoints ohne Auth (IDOR, data leak)
 *  - HTTP Security Headers (fehlende Headers = Finding)
 *  - JavaScript-Dateien mit hardcodierten Keys/Tokens
 *  - Exposed admin/staging panels
 *  - S3 / Cloud storage misconfigurations
 *
 * Sendet echte Findings sofort per Telegram mit Beweis + Report-Template.
 *
 * Aktivieren: BOUNTY_HUNTER_ENABLED=true in .env
 * Interval: BOUNTY_HUNTER_INTERVAL_MIN=60 (default: stündlich)
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const INTERVAL_MS  = (parseInt(process.env.BOUNTY_HUNTER_INTERVAL_MIN) || 60) * 60_000;
const STATE_FILE   = '/opt/soul/connections/bounty-hunter-state.json';

// Bug Bounty Targets — alle verifiziert auf Intigriti/HackerOne
// Scope: nur öffentliche Domains (kein aktiver Angriff, nur passive Recon)
const TARGETS = [
  {
    program:  'AS Watson / ICI Paris XL',
    platform: 'Intigriti',
    maxPayout: 8500,
    domains: [
      'https://www.iciparisxl.nl',
      'https://www.iciparisxl.be',
      'https://api.iciparisxl.nl',
    ],
  },
  {
    program:  'Exoscale',
    platform: 'Intigriti',
    maxPayout: 5000,
    domains: [
      'https://portal.exoscale.com',
      'https://www.exoscale.com',
      'https://api-ch-gva-2.exoscale.com',
    ],
  },
  {
    program:  'Coveo',
    platform: 'Intigriti',
    maxPayout: 5500,
    domains: [
      'https://www.coveo.com',
      'https://platform.cloud.coveo.com',
    ],
  },
];

// Paths to probe on every domain
const PROBE_PATHS = [
  '/.git/HEAD',
  '/.git/config',
  '/.env',
  '/.env.backup',
  '/.env.local',
  '/.env.production',
  '/config.json',
  '/config.yml',
  '/api/v1/users',
  '/api/v1/admin',
  '/api/users',
  '/api/config',
  '/admin',
  '/admin/',
  '/staging',
  '/backup',
  '/wp-config.php',
  '/server-status',
  '/phpinfo.php',
  '/.DS_Store',
  '/package.json',
  '/composer.json',
  '/swagger.json',
  '/openapi.json',
  '/api-docs',
  '/graphql',
  '/__debug__',
  '/actuator',
  '/actuator/env',
  '/actuator/health',
  '/metrics',
  '/healthz',
];

// Security headers that should be present
const REQUIRED_HEADERS = [
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'strict-transport-security',
];

export class BountyHunter {
  constructor({ bus, telegram, soulPath }) {
    this.bus      = bus;
    this.telegram = telegram;
    this.soulPath = soulPath;
    this.enabled  = process.env.BOUNTY_HUNTER_ENABLED === 'true';
    this._timer   = null;
    this._state   = { findings: [], reported: [], lastScan: null };
  }

  async start() {
    if (!this.enabled) {
      console.log('  [bounty] Disabled (BOUNTY_HUNTER_ENABLED != true)');
      return;
    }

    this._state = await this._load();
    console.log(`  [bounty] Hunter active — ${TARGETS.length} targets, ${PROBE_PATHS.length} probes each`);

    // First scan after 2 minutes
    this._timer = setTimeout(() => this._tick(), 2 * 60_000);
  }

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  async runNow() {
    await this._tick();
  }

  // ── Main scan loop ────────────────────────────────────────

  async _tick() {
    console.log('  [bounty] Starting recon scan...');
    this._state.lastScan = new Date().toISOString();
    const findings = [];

    for (const target of TARGETS) {
      for (const domain of target.domains) {
        try {
          const domainFindings = await this._scanDomain(domain, target);
          findings.push(...domainFindings);
        } catch (err) {
          // domain unreachable — skip silently
        }

        // Rate limiting — be a good citizen
        await delay(1500);
      }
    }

    // Filter out already reported findings
    const newFindings = findings.filter(f => !this._state.reported.includes(f.id));

    if (newFindings.length > 0) {
      console.log(`  [bounty] ${newFindings.length} new finding(s)!`);

      for (const finding of newFindings) {
        await this._report(finding);
        this._state.reported.push(finding.id);
        await delay(1000);
      }
    } else {
      console.log('  [bounty] Scan complete — no new findings');
    }

    this._state.findings = [...this._state.findings, ...newFindings].slice(-100);
    await this._save();

    this._timer = setTimeout(() => this._tick(), INTERVAL_MS);
  }

  // ── Domain Scanner ────────────────────────────────────────

  async _scanDomain(domain, target) {
    const findings = [];

    // 1. Check security headers on main domain
    const headerFindings = await this._checkHeaders(domain, target);
    findings.push(...headerFindings);

    // 2. Probe sensitive paths
    for (const path of PROBE_PATHS) {
      const url = domain.replace(/\/$/, '') + path;
      const finding = await this._probePath(url, target);
      if (finding) findings.push(finding);
      await delay(300); // be polite
    }

    // 3. Check for JS files with exposed secrets
    const jsFindings = await this._checkJSFiles(domain, target);
    findings.push(...jsFindings);

    return findings;
  }

  // ── Probe a specific path ─────────────────────────────────

  async _probePath(url, target) {
    try {
      const res = await fetch(url, {
        method:  'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; security-research)' },
        signal:  AbortSignal.timeout(8000),
        redirect: 'manual',
      });

      // Interesting status codes
      if (res.status === 200) {
        const body        = await res.text();
        const path        = new URL(url).pathname;
        const severity    = this._assessSeverity(path, body);

        if (severity) {
          return {
            id:       `${target.program}_${url}`.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80),
            type:     'exposed_path',
            severity,
            url,
            program:  target.program,
            platform: target.platform,
            maxPayout: target.maxPayout,
            body:     body.substring(0, 500),
            evidence: `HTTP 200 on ${path}`,
            found:    new Date().toISOString(),
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  _assessSeverity(path, body) {
    // Critical: actual credentials exposed
    if (/sk_live_[a-zA-Z0-9]{20,}/.test(body)) return 'critical';
    if (/AKIA[0-9A-Z]{16}/.test(body))          return 'critical'; // AWS key
    if (/AIza[0-9A-Za-z\-_]{35}/.test(body))    return 'critical'; // Google API key
    if (/[a-z0-9]{32,}/.test(body) && path.includes('.env')) return 'high';

    // High: .git or .env accessible
    if (path === '/.git/HEAD' && body.includes('ref:'))     return 'high';
    if (path === '/.git/config' && body.includes('[core]')) return 'high';
    if (path === '/.env' && body.includes('='))             return 'high';
    if (path.includes('.env') && body.includes('PASSWORD')) return 'high';

    // Medium: config files, admin panels, debug endpoints
    if (path.includes('swagger') || path.includes('openapi')) return 'medium';
    if (path === '/actuator/env' && body.length > 100)         return 'high';
    if (path === '/actuator' && body.includes('_links'))       return 'medium';
    if (path.includes('phpinfo') && body.includes('PHP'))      return 'medium';
    if (path.includes('graphql') && body.includes('__schema')) return 'medium';

    // Low: version info, health endpoints with too much detail
    if (path.includes('metrics') && body.length > 500) return 'low';
    if (path === '/package.json' && body.includes('version')) return 'low';

    return null;
  }

  // ── Security Header Check ─────────────────────────────────

  async _checkHeaders(domain, target) {
    const findings = [];
    try {
      const res = await fetch(domain, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; security-research)' },
        signal:  AbortSignal.timeout(8000),
      });

      const missing = REQUIRED_HEADERS.filter(h => !res.headers.has(h));

      // Only report if multiple critical headers missing (otherwise too many false positives)
      if (missing.includes('strict-transport-security') && missing.includes('content-security-policy')) {
        findings.push({
          id:       `headers_${domain}`.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80),
          type:     'missing_headers',
          severity: 'low',
          url:      domain,
          program:  target.program,
          platform: target.platform,
          maxPayout: target.maxPayout,
          evidence: `Missing: ${missing.join(', ')}`,
          found:    new Date().toISOString(),
        });
      }
    } catch { /* unreachable */ }

    return findings;
  }

  // ── JS File Analysis ─────────────────────────────────────

  async _checkJSFiles(domain, target) {
    const findings = [];
    try {
      // Fetch main page, extract JS file URLs
      const res  = await fetch(domain, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal:  AbortSignal.timeout(8000),
      });
      const html = await res.text();

      // Extract JS file paths
      const jsMatches = html.matchAll(/<script[^>]+src=["']([^"']+\.js[^"']*?)["']/gi);
      const jsUrls    = [];
      for (const m of jsMatches) {
        const src = m[1];
        jsUrls.push(src.startsWith('http') ? src : domain + src);
      }

      // Check first 5 JS files for secrets
      for (const jsUrl of jsUrls.slice(0, 5)) {
        try {
          const jsRes  = await fetch(jsUrl, { signal: AbortSignal.timeout(6000) });
          const jsBody = await jsRes.text();

          // Look for hardcoded secrets
          const secretPatterns = [
            { re: /['"]sk_live_[a-zA-Z0-9]{20,}['"]/g,         type: 'Stripe Live Key' },
            { re: /['"]AKIA[0-9A-Z]{16}['"]/g,                  type: 'AWS Access Key' },
            { re: /['"]AIza[0-9A-Za-z\-_]{35}['"]/g,            type: 'Google API Key' },
            { re: /apiKey:\s*['"][a-zA-Z0-9\-_]{20,}['"]/g,     type: 'Hardcoded API Key' },
            { re: /password:\s*['"][^'"]{8,}['"]/g,              type: 'Hardcoded Password' },
            { re: /secret:\s*['"][a-zA-Z0-9\-_]{16,}['"]/g,     type: 'Hardcoded Secret' },
          ];

          for (const { re, type } of secretPatterns) {
            const matches = jsBody.match(re);
            if (matches) {
              findings.push({
                id:        `js_${jsUrl}_${type}`.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 80),
                type:      'hardcoded_secret',
                severity:  type.includes('Live') || type.includes('AWS') ? 'critical' : 'high',
                url:       jsUrl,
                program:   target.program,
                platform:  target.platform,
                maxPayout: target.maxPayout,
                evidence:  `${type}: ${matches[0].substring(0, 60)}`,
                found:     new Date().toISOString(),
              });
            }
          }

          await delay(500);
        } catch { /* skip JS file */ }
      }
    } catch { /* skip domain */ }

    return findings;
  }

  // ── Report Finding ────────────────────────────────────────

  async _report(finding) {
    const severityEmoji = {
      critical: '🔴',
      high:     '🟠',
      medium:   '🟡',
      low:      '🔵',
    }[finding.severity] || '⚪';

    const msg = [
      `${severityEmoji} *Bug Bounty Finding!*`,
      ``,
      `*Programm:* ${finding.program} (${finding.platform})`,
      `*Max. Payout:* $${finding.maxPayout}`,
      `*Typ:* ${finding.type}`,
      `*Severity:* ${finding.severity.toUpperCase()}`,
      ``,
      `*URL:* \`${finding.url}\``,
      `*Beweis:* ${finding.evidence}`,
      ``,
      `_Jetzt auf ${finding.platform} melden für Payout!_`,
    ].join('\n');

    await this.telegram?.sendToOwner(msg);

    this.bus?.safeEmit?.('bounty.finding', {
      program:  finding.program,
      severity: finding.severity,
      url:      finding.url,
      payout:   finding.maxPayout,
    });

    console.log(`  [bounty] 🎯 Finding reported: ${finding.severity} on ${finding.program}`);
  }

  // ── Persistence ───────────────────────────────────────────

  async _load() {
    if (!existsSync(STATE_FILE)) return { findings: [], reported: [], lastScan: null };
    try { return JSON.parse(await readFile(STATE_FILE, 'utf-8')); }
    catch { return { findings: [], reported: [], lastScan: null }; }
  }

  async _save() {
    await mkdir(STATE_FILE.split('/').slice(0, -1).join('/'), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(this._state, null, 2));
  }
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
