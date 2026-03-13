/**
 * UptimeMonitor — Service & Website Availability Monitor
 *
 * Prüft URLs alle 5 Minuten, sendet Telegram-Alert wenn:
 *  - Service nicht erreichbar (mit Aktion-Vorschlag)
 *  - Service wieder erreichbar ist
 *  - SSL-Zertifikat in < 30 Tagen abläuft
 *
 * Konfiguration via .env:
 *   UPTIME_ENABLED=true
 *   UPTIME_URLS=https://example.com,https://app.example.com
 *   UPTIME_INTERVAL_MIN=5
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const INTERVAL_MS = (parseInt(process.env.UPTIME_INTERVAL_MIN) || 5) * 60 * 1000;

export class UptimeMonitor {
  constructor({ bus, telegram }) {
    this.bus       = bus;
    this.telegram  = telegram;
    this.enabled   = process.env.UPTIME_ENABLED === 'true';
    this._urls     = (process.env.UPTIME_URLS || '').split(',').map(u => u.trim()).filter(Boolean);
    this._status   = {};  // url -> { up: bool, downSince: Date|null, sslDaysLeft: number|null }
    this._timer    = null;
    this._sslCheck = {};  // url -> last ssl check date
  }

  start() {
    if (!this.enabled) {
      console.log('  [uptime] Disabled (UPTIME_ENABLED != true)');
      return;
    }
    if (!this._urls.length) {
      console.log('  [uptime] No URLs configured (set UPTIME_URLS in .env)');
      return;
    }

    console.log(`  [uptime] Monitoring ${this._urls.length} URL(s) every ${INTERVAL_MS / 60000} min`);
    this._tick();
  }

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  async _tick() {
    try {
      await Promise.all(this._urls.map(url => this._checkUrl(url)));
    } catch (err) {
      console.error(`  [uptime] Tick error: ${err.message}`);
    } finally {
      this._timer = setTimeout(() => this._tick(), INTERVAL_MS);
    }
  }

  async _checkUrl(url) {
    const wasUp = this._status[url]?.up ?? true;
    let isUp = false;
    let statusCode = 0;
    let responseMs = 0;

    try {
      const start = Date.now();
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
      });
      responseMs = Date.now() - start;
      statusCode = res.status;
      isUp = statusCode < 500;
    } catch {
      isUp = false;
    }

    const prev = this._status[url] || { up: true, downSince: null, sslDaysLeft: null };

    if (!isUp && wasUp) {
      // Just went down
      this._status[url] = { up: false, downSince: new Date(), sslDaysLeft: prev.sslDaysLeft };
      const hostname = new URL(url).hostname;
      const msg = `🔴 ${hostname} ist nicht erreichbar!\nURL: ${url}\nStatus: ${statusCode || 'keine Antwort'}\n\nSoll ich:\n1. Container-Status prüfen\n2. Nginx-Logs ansehen\n3. Ignorieren`;
      await this._notify(msg);
      this.bus?.safeEmit?.('uptime.down', { url, statusCode, timestamp: new Date().toISOString() });
      console.log(`  [uptime] DOWN: ${url}`);

    } else if (isUp && !wasUp) {
      // Came back up
      const downSince = prev.downSince;
      const downMin = downSince ? Math.round((Date.now() - downSince.getTime()) / 60000) : '?';
      this._status[url] = { up: true, downSince: null, sslDaysLeft: prev.sslDaysLeft };
      const hostname = new URL(url).hostname;
      const msg = `🟢 ${hostname} ist wieder erreichbar\nAusfallzeit: ${downMin} Min | Response: ${responseMs}ms`;
      await this._notify(msg);
      this.bus?.safeEmit?.('uptime.up', { url, downMinutes: downMin, timestamp: new Date().toISOString() });
      console.log(`  [uptime] RECOVERED: ${url}`);

    } else {
      this._status[url] = { ...prev, up: isUp };
    }

    // SSL check: once per day per URL
    if (isUp && url.startsWith('https://')) {
      const today = new Date().toISOString().slice(0, 10);
      if (this._sslCheck[url] !== today) {
        this._sslCheck[url] = today;
        await this._checkSSL(url);
      }
    }
  }

  async _checkSSL(url) {
    try {
      const hostname = new URL(url).hostname;
      const { stdout } = await execFileAsync('openssl', [
        's_client', '-connect', `${hostname}:443`, '-servername', hostname,
      ], { timeout: 8000, input: '' }).catch(async () => {
        // fallback: use curl
        const r = await execFileAsync('curl', [
          '-vI', '--max-time', '8', url,
        ], { timeout: 10000 });
        return { stdout: r.stderr }; // curl puts SSL info in stderr
      });

      const match = stdout.match(/notAfter=(.*)/i) || stdout.match(/expire date:\s*(.*)/i);
      if (!match) return;

      const expiry = new Date(match[1].trim());
      const daysLeft = Math.floor((expiry - Date.now()) / 86400000);

      const prev = this._status[url] || {};
      this._status[url] = { ...prev, sslDaysLeft: daysLeft };

      if (daysLeft <= 7) {
        const hostname2 = new URL(url).hostname;
        await this._notify(`🔐 SSL-Zertifikat läuft bald ab!\n${hostname2}\nNoch ${daysLeft} Tage (bis ${expiry.toLocaleDateString('de')})\n\nSoll ich den Renewal-Befehl vorbereiten?`);
        this.bus?.safeEmit?.('ssl.expiring', { url, daysLeft, expiry: expiry.toISOString() });
      } else if (daysLeft <= 30) {
        console.log(`  [uptime] SSL warning: ${hostname} expires in ${daysLeft} days`);
        // Silent log — will alert again when <= 7
      }
    } catch { /* openssl/curl not available or failed */ }
  }

  async _notify(text) {
    if (!this.telegram) return;
    try { await this.telegram.sendToOwner(text); }
    catch (err) { console.warn(`  [uptime] Telegram notify failed: ${err.message}`); }
  }

  getStatus() {
    return Object.entries(this._status).map(([url, s]) => ({ url, ...s }));
  }
}
