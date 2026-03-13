/**
 * Security Agent — Autonomer IT-Sicherheits-Monitor
 *
 * Prüft wöchentlich:
 *  - Laufende Docker Container + Image-Alter
 *  - Ausstehende System-Updates (Security-Patches)
 *  - Offene Ports + Firewall-Status
 *  - Fehlgeschlagene SSH-Logins (Brute-Force-Versuche)
 *  - Recherchiert aktuelle CVEs für erkannte Software via Web-Search
 *  - Schickt priorisierten Report per Telegram
 *
 * Konfiguration via .env:
 *   SECURITY_AGENT_ENABLED=true
 *   SECURITY_CRON=0 9 * * 1   (montags 09:00 UTC, default)
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import cron from 'node-cron';

const execAsync = promisify(exec);

export class SecurityAgent {
  constructor({ bus, telegram, llm, mcp }) {
    this.bus      = bus;
    this.telegram = telegram;
    this.llm      = llm;
    this.mcp      = mcp;
    this.task     = null;
    this.enabled  = process.env.SECURITY_AGENT_ENABLED === 'true';
    this.cronExpr = process.env.SECURITY_CRON || '0 9 * * 1'; // Montag 09:00 UTC
  }

  start() {
    if (!this.enabled) {
      console.log('  [security] Disabled (SECURITY_AGENT_ENABLED != true)');
      return;
    }

    this.task = cron.schedule(this.cronExpr, async () => {
      try {
        await this.runCheck();
      } catch (err) {
        console.error(`  [security] Cron error: ${err.message}`);
      }
    });

    // Manueller Trigger via Event Bus
    this.bus?.on('security.check', async () => {
      console.log('  [security] Manual check triggered via event bus');
      await this.runCheck();
    });

    console.log(`  [security] Agent scheduled — cron: ${this.cronExpr}`);
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  async runCheck() {
    console.log('  [security] Running security check...');

    const [docker, system, auth] = await Promise.all([
      this.checkDocker(),
      this.checkSystem(),
      this.checkAuth(),
    ]);

    const snapshot = this.buildSnapshot(docker, system, auth);
    console.log('  [security] Snapshot gathered, analysing with LLM...');

    const report = await this.analyzeWithLLM(snapshot, docker, system, auth);

    if (report && this.telegram) {
      const chunks = chunkMessage(report, 3800);
      for (const chunk of chunks) {
        await this.telegram.sendToOwner(chunk);
        await new Promise(r => setTimeout(r, 500)); // Telegram rate limit
      }
    }

    console.log('  [security] Check complete.');
    this.bus?.safeEmit?.('security.check.complete', { timestamp: new Date().toISOString() });
    return report;
  }

  // ── Data Gathering ─────────────────────────────────────────

  async checkDocker() {
    const result = { containers: [], images: [], compose: '' };

    try {
      const { stdout } = await execAsync(
        'docker ps --format "{{.Names}}|{{.Image}}|{{.Status}}|{{.RunningFor}}"',
        { timeout: 15_000 }
      );
      result.containers = stdout.trim().split('\n').filter(Boolean).map(line => {
        const [name, image, status, age] = line.split('|');
        return { name, image, status, age };
      });
    } catch { /* docker not accessible or not running */ }

    try {
      // Image age: CreatedAt timestamp für Vergleich
      const { stdout } = await execAsync(
        'docker images --format "{{.Repository}}:{{.Tag}}|{{.CreatedSince}}|{{.Size}}"',
        { timeout: 15_000 }
      );
      result.images = stdout.trim().split('\n').filter(Boolean)
        .filter(l => !l.startsWith('<none>'))
        .map(line => {
          const [name, age, size] = line.split('|');
          return { name, age, size };
        });
    } catch { /* skip */ }

    // Docker Compose check (welche Stacks laufen)
    try {
      const { stdout } = await execAsync(
        'docker compose ls 2>/dev/null || docker-compose ls 2>/dev/null || echo ""',
        { timeout: 10_000 }
      );
      result.compose = stdout.trim();
    } catch { /* skip */ }

    return result;
  }

  async checkSystem() {
    const result = {
      securityUpdates: [],
      totalPending: 0,
      openPorts: '',
      diskUsage: '',
      uptime: '',
      nodeVersion: '',
      dockerVersion: '',
      kernelVersion: '',
    };

    // Ausstehende Security-Updates
    try {
      const { stdout } = await execAsync(
        'apt list --upgradable 2>/dev/null | grep -i "security" | head -30',
        { timeout: 30_000 }
      );
      result.securityUpdates = stdout.trim().split('\n').filter(Boolean);
    } catch { /* skip */ }

    // Gesamtzahl ausstehender Updates
    try {
      const { stdout } = await execAsync(
        'apt list --upgradable 2>/dev/null | grep -v "Listing" | wc -l',
        { timeout: 30_000 }
      );
      result.totalPending = parseInt(stdout.trim()) || 0;
    } catch { /* skip */ }

    // Offene Ports (nur LISTEN)
    try {
      const { stdout } = await execAsync(
        'ss -tlnp | grep LISTEN | awk \'{print $4, $6}\'',
        { timeout: 10_000 }
      );
      result.openPorts = stdout.trim();
    } catch { /* skip */ }

    // Disk
    try {
      const { stdout } = await execAsync('df -h / | tail -1', { timeout: 10_000 });
      result.diskUsage = stdout.trim();
    } catch { /* skip */ }

    // Uptime
    try {
      const { stdout } = await execAsync('uptime -p', { timeout: 5_000 });
      result.uptime = stdout.trim();
    } catch { /* skip */ }

    // Versionen
    try {
      const [n, d, k] = await Promise.all([
        execAsync('node --version').then(r => r.stdout.trim()).catch(() => '?'),
        execAsync('docker --version').then(r => r.stdout.trim()).catch(() => '?'),
        execAsync('uname -r').then(r => r.stdout.trim()).catch(() => '?'),
      ]);
      result.nodeVersion   = n;
      result.dockerVersion = d;
      result.kernelVersion = k;
    } catch { /* skip */ }

    return result;
  }

  async checkAuth() {
    const result = {
      failedLogins7d: 0,
      uniqueAttackerIPs: 0,
      lastFailedIP: '',
      firewallStatus: 'unbekannt',
    };

    // Fehlgeschlagene SSH-Logins (letzte 7 Tage)
    try {
      const { stdout } = await execAsync(
        'journalctl -u ssh --since "7 days ago" 2>/dev/null | grep "Failed password" | wc -l',
        { timeout: 20_000 }
      );
      result.failedLogins7d = parseInt(stdout.trim()) || 0;
    } catch { /* skip */ }

    // Unique Angreifer-IPs
    try {
      const { stdout } = await execAsync(
        'journalctl -u ssh --since "7 days ago" 2>/dev/null | grep "Failed password" | grep -oP \'from \\K[\\d.]+\' | sort -u | wc -l',
        { timeout: 20_000 }
      );
      result.uniqueAttackerIPs = parseInt(stdout.trim()) || 0;
    } catch { /* skip */ }

    // Letzter Angreifer
    try {
      const { stdout } = await execAsync(
        'journalctl -u ssh --since "7 days ago" 2>/dev/null | grep "Failed password" | grep -oP \'from \\K[\\d.]+\' | tail -1',
        { timeout: 15_000 }
      );
      result.lastFailedIP = stdout.trim();
    } catch { /* skip */ }

    // Firewall
    try {
      const { stdout } = await execAsync('ufw status 2>/dev/null | head -1', { timeout: 10_000 });
      result.firewallStatus = stdout.trim() || 'nicht konfiguriert';
    } catch { /* skip */ }

    return result;
  }

  // ── Context Builder ────────────────────────────────────────

  buildSnapshot(docker, system, auth) {
    const date = new Date().toISOString().slice(0, 10);
    const lines = [
      `=== Server Security Snapshot ${date} ===`,
      '',
      `DOCKER CONTAINER (${docker.containers.length} laufend):`,
      ...docker.containers.map(c => `  ${c.name}: ${c.image} | ${c.status} | läuft seit ${c.age}`),
      docker.containers.length === 0 ? '  (keine)' : '',
      '',
      `DOCKER IMAGES (Alter):`,
      ...docker.images.slice(0, 15).map(i => `  ${i.name}: ${i.age}, ${i.size}`),
      '',
      `SYSTEM:`,
      `  Node.js:  ${system.nodeVersion}`,
      `  Docker:   ${system.dockerVersion}`,
      `  Kernel:   ${system.kernelVersion}`,
      `  Uptime:   ${system.uptime}`,
      `  Disk (/): ${system.diskUsage}`,
      '',
      `UPDATES:`,
      `  Gesamt ausstehend: ${system.totalPending}`,
      `  Security-Updates:  ${system.securityUpdates.length > 0 ? system.securityUpdates.length + ' gefunden' : 'keine'}`,
      system.securityUpdates.length > 0
        ? '  ' + system.securityUpdates.slice(0, 5).join('\n  ')
        : '',
      '',
      `OFFENE PORTS:`,
      `  ${system.openPorts || '(nicht abrufbar)'}`,
      '',
      `AUTH / SSH (letzte 7 Tage):`,
      `  Fehlgeschlagene Logins: ${auth.failedLogins7d}`,
      `  Einzigartige Angreifer-IPs: ${auth.uniqueAttackerIPs}`,
      auth.lastFailedIP ? `  Letzter Versuch von: ${auth.lastFailedIP}` : '',
      `  Firewall: ${auth.firewallStatus}`,
    ];

    return lines.filter(l => l !== undefined).join('\n');
  }

  // ── LLM Analysis ──────────────────────────────────────────

  async analyzeWithLLM(snapshot, docker, system, auth) {
    if (!this.llm) {
      return `🔒 Security Check\n\n${snapshot}`;
    }

    const mcpTools = this.mcp?.hasTools() ? this.mcp.getTools() : [];
    const hasWebSearch = mcpTools.some(t =>
      t.name?.toLowerCase().includes('search') ||
      t.name?.toLowerCase().includes('web') ||
      t.name?.toLowerCase().includes('fetch')
    );

    const prompt = `Du bist ein IT-Security-Agent. Du hast folgende Server-Daten:

${snapshot}

Deine Aufgaben:
1. Bewerte den Status: was ist sicher, was ist ein Risiko
2. ${hasWebSearch
      ? 'Suche im Web nach aktuellen CVEs/Sicherheitslücken für: Node.js ' + system.nodeVersion + ', Docker ' + system.dockerVersion.split(',')[0] + ', Ubuntu/Debian Kernel ' + system.kernelVersion
      : 'Bewerte ob Node.js ' + system.nodeVersion + ' und Docker ' + system.dockerVersion.split(',')[0] + ' noch aktuell wirken'}
3. Schaue ob die Docker-Images veraltet sind (>60 Tage = Risiko)
4. Bewerte die SSH-Angriffslage (${auth.failedLogins7d} Versuche von ${auth.uniqueAttackerIPs} IPs in 7 Tagen)
5. Gib 3-5 konkrete Empfehlungen, priorisiert nach Dringlichkeit

Format für Telegram (kein Markdown-Bold mit *, nutze Emojis):
🔒 Security Report — [Datum]
[Kurze Gesamtbewertung in 1-2 Sätzen]

🔴 KRITISCH / 🟡 MITTEL / 🟢 OK:
[Je ein Punkt pro Zeile]

📋 Empfehlungen:
1. [Dringlichste Maßnahme]
2. ...

Halte es unter 600 Wörter. Konkret, kein Marketing-Sprech.`;

    try {
      const options = {
        tools: mcpTools.length > 0 ? mcpTools : undefined,
        maxTokens: 2000,
      };
      const result = await this.llm.generate(prompt, [], 'Erstelle Security-Report', options);
      return result || snapshot;
    } catch (err) {
      console.error(`  [security] LLM analysis failed: ${err.message}`);
      // Fallback: strukturierter Report ohne LLM
      return this.buildFallbackReport(docker, system, auth);
    }
  }

  buildFallbackReport(docker, system, auth) {
    const date = new Date().toLocaleDateString('de');
    const criticals = [];
    const warnings  = [];
    const ok        = [];

    if (system.securityUpdates.length > 0)
      criticals.push(`${system.securityUpdates.length} Security-Updates ausstehend`);
    else
      ok.push(`Keine Security-Updates ausstehend`);

    if (system.totalPending > 20)
      warnings.push(`${system.totalPending} Updates insgesamt ausstehend`);

    if (auth.failedLogins7d > 500)
      criticals.push(`${auth.failedLogins7d} fehlgeschlagene SSH-Logins (${auth.uniqueAttackerIPs} IPs)`);
    else if (auth.failedLogins7d > 100)
      warnings.push(`${auth.failedLogins7d} SSH-Brute-Force-Versuche erkannt`);
    else
      ok.push(`SSH-Angriffslage normal (${auth.failedLogins7d} Versuche)`);

    if (auth.firewallStatus.toLowerCase().includes('inactive'))
      criticals.push('Firewall inaktiv!');
    else
      ok.push(`Firewall: ${auth.firewallStatus}`);

    const oldImages = docker.images.filter(i =>
      i.age?.includes('month') || (i.age?.includes('week') && parseInt(i.age) > 8)
    );
    if (oldImages.length > 0)
      warnings.push(`${oldImages.length} Docker-Images möglicherweise veraltet`);

    let msg = `🔒 Security Check — ${date}\n\n`;
    if (criticals.length) msg += criticals.map(c => `🔴 ${c}`).join('\n') + '\n';
    if (warnings.length)  msg += warnings.map(w => `🟡 ${w}`).join('\n') + '\n';
    if (ok.length)        msg += ok.map(o => `🟢 ${o}`).join('\n') + '\n';
    msg += `\n📊 ${docker.containers.length} Container laufend | ${system.totalPending} Updates ausstehend`;

    return msg;
  }
}

// ── Helpers ──────────────────────────────────────────────────

function chunkMessage(text, maxLen = 3800) {
  const chunks = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen / 2) cut = maxLen;
    chunks.push(rest.substring(0, cut));
    rest = rest.substring(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
