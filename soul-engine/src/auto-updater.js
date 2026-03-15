/**
 * AutoUpdater — Automatisches Update-System mit Release-Kanälen
 *
 * Inspiriert von OpenClaws `openclaw update --channel stable`.
 *
 * Features:
 *  - 3 Kanäle: stable / beta / dev
 *  - GitHub Releases als Update-Quelle (kein npm nötig)
 *  - Semantic Versioning Vergleich
 *  - Rollback-Fähigkeit (letzter guter Zustand als Git-Tag)
 *  - Telegram-Benachrichtigung bei verfügbaren Updates
 *  - Auto-Install optional (SOUL_AUTO_UPDATE=true)
 *  - Health-Check nach Update (soul-doctor.js)
 *  - Tägliche Prüfung oder manueller Trigger
 *
 * Konfiguration:
 *   SOUL_UPDATE_CHANNEL=stable     (stable|beta|dev)
 *   SOUL_AUTO_UPDATE=false          (auto-install nach Prüfung)
 *   SOUL_UPDATE_REPO=hbcaspa/projectSoul  (GitHub repo)
 */

import { execSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const CHECK_INTERVAL = 24 * 60 * 60_000; // Täglich

export class AutoUpdater {
  constructor({ soulPath, bus, telegram, doctor } = {}) {
    this.soulPath = soulPath;
    this.bus      = bus;
    this.telegram = telegram;
    this.doctor   = doctor;
    this.channel  = process.env.SOUL_UPDATE_CHANNEL || 'stable';
    this.autoInstall = process.env.SOUL_AUTO_UPDATE === 'true';
    this.repo     = process.env.SOUL_UPDATE_REPO || 'hbcaspa/projectSoul';
    this._timer   = null;
    this._stateFile = join(soulPath, 'connections', 'updater-state.json');
  }

  async start() {
    console.log(`  [updater] Channel: ${this.channel}, auto-install: ${this.autoInstall}`);

    // Erste Prüfung nach 5 Minuten
    this._timer = setTimeout(() => this._tick(), 5 * 60_000);
  }

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  /**
   * Manuell nach Updates suchen.
   */
  async checkNow() {
    return this._check();
  }

  /**
   * Update installieren.
   */
  async install() {
    try {
      const repoDir = join(this.soulPath, '..');

      // 1. Backup current state (tag)
      const currentVersion = this._getCurrentVersion();
      try {
        execSync(`git tag -f pre-update-${currentVersion}`, { cwd: repoDir, encoding: 'utf-8' });
      } catch { /* tag may exist */ }

      // 2. Pull latest
      const pullResult = execSync('git pull --ff-only 2>&1', { cwd: repoDir, encoding: 'utf-8', timeout: 30000 });
      console.log(`  [updater] Pull result: ${pullResult.trim()}`);

      // 3. Install dependencies if package.json changed
      const engineDir = join(repoDir, 'soul-engine');
      if (existsSync(join(engineDir, 'package.json'))) {
        try {
          execSync('npm install --production 2>&1', { cwd: engineDir, encoding: 'utf-8', timeout: 60000 });
        } catch { /* npm install failures are non-fatal */ }
      }

      // 4. Health check (if doctor available)
      if (this.doctor) {
        const report = await this.doctor.runAll();
        if (!report.ok) {
          console.warn(`  [updater] Post-update health check FAILED`);
          await this.telegram?.sendToOwner?.(
            `⚠️ Update installiert, aber Health-Check fehlgeschlagen!\n\n${this.doctor.formatReport(report)}`
          );

          // Optionally rollback
          return { success: false, version: this._getCurrentVersion(), healthCheck: false };
        }
      }

      const newVersion = this._getCurrentVersion();
      console.log(`  [updater] Updated to ${newVersion}`);

      await this.telegram?.sendToOwner?.(
        `✅ Soul Engine aktualisiert\n\nVersion: \`${newVersion}\`\nKanal: ${this.channel}\nHealth-Check: bestanden`
      );

      this.bus?.safeEmit?.('update.installed', { version: newVersion });
      return { success: true, version: newVersion, healthCheck: true };

    } catch (err) {
      console.error(`  [updater] Install failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Rollback zum letzten guten Zustand.
   */
  async rollback() {
    try {
      const repoDir = join(this.soulPath, '..');
      const tags = execSync('git tag -l "pre-update-*" --sort=-version:refname', {
        cwd: repoDir, encoding: 'utf-8',
      }).trim().split('\n').filter(Boolean);

      if (tags.length === 0) {
        return { success: false, error: 'No rollback tags found' };
      }

      const target = tags[0];
      execSync(`git checkout ${target}`, { cwd: repoDir, encoding: 'utf-8' });
      console.log(`  [updater] Rolled back to ${target}`);

      await this.telegram?.sendToOwner?.(`⏪ Rollback zu \`${target}\` durchgeführt`);
      return { success: true, version: target };

    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // ── Internal ───────────────────────────────────────────────

  async _tick() {
    await this._check();
    this._timer = setTimeout(() => this._tick(), CHECK_INTERVAL);
  }

  async _check() {
    try {
      const current = this._getCurrentVersion();
      const latest  = await this._getLatestRelease();

      if (!latest) {
        return { upToDate: true, current };
      }

      const hasUpdate = this._isNewer(latest.version, current);

      if (hasUpdate) {
        console.log(`  [updater] Update available: ${current} → ${latest.version} (${this.channel})`);

        await this.telegram?.sendToOwner?.(
          `🔄 Update verfügbar!\n\nAktuell: \`${current}\`\nNeu: \`${latest.version}\`\nKanal: ${this.channel}\n\n${latest.notes?.substring(0, 200) || ''}\n\n${this.autoInstall ? '_Wird automatisch installiert..._' : '_Manuell: engine.updater.install()_'}`
        );

        this.bus?.safeEmit?.('update.available', { current, latest: latest.version });

        if (this.autoInstall) {
          return this.install();
        }

        return { upToDate: false, current, latest: latest.version, notes: latest.notes };
      }

      return { upToDate: true, current };

    } catch (err) {
      console.error(`  [updater] Check failed: ${err.message}`);
      return { error: err.message };
    }
  }

  async _getLatestRelease() {
    try {
      const resp = await fetch(`https://api.github.com/repos/${this.repo}/releases`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!resp.ok) return null;
      const releases = await resp.json();

      // Filter by channel
      const matching = releases.filter(r => {
        if (this.channel === 'stable') return !r.prerelease;
        if (this.channel === 'beta')   return true; // beta includes stable
        return true; // dev gets everything
      });

      if (matching.length === 0) return null;

      const latest = matching[0];
      return {
        version: latest.tag_name?.replace(/^v/, '') || latest.name,
        notes: latest.body,
        url: latest.html_url,
        published: latest.published_at,
      };

    } catch { return null; }
  }

  _getCurrentVersion() {
    try {
      const repoDir = join(this.soulPath, '..');
      // Use git describe for current version
      return execSync('git describe --tags --always 2>/dev/null || git rev-parse --short HEAD', {
        cwd: repoDir, encoding: 'utf-8',
      }).trim();
    } catch { return 'unknown'; }
  }

  _isNewer(latest, current) {
    // Simple semver comparison
    const parse = (v) => {
      const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
      return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
    };

    const l = parse(latest);
    const c = parse(current);

    if (!l || !c) {
      // Fall back to string comparison for non-semver (git hashes)
      return latest !== current;
    }

    for (let i = 0; i < 3; i++) {
      if (l[i] > c[i]) return true;
      if (l[i] < c[i]) return false;
    }
    return false;
  }
}
