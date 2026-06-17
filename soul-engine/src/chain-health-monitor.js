/**
 * ChainHealthMonitor — alarmiert den Owner (Telegram), wenn die verteilte Soul-Infra
 * still degradiert. Gebaut 2026-06-17, nachdem der Mac<->alm-Chain-Sync seit ~April
 * TOT war, ohne dass jemand es merkte — genau dieses lautlose Verfallen verhindert er.
 *
 * Läuft auf ALLEN Nodes (NICHT server-gated). Liest jeden Tick .soul-chain-status und
 * edge-triggert: gesund->degradiert => Alarm; degradiert->gesund => Recovery-Meldung.
 * Re-Notify gedrosselt (kein Spam). Plain-Text (telegram.sendToOwner hat kein parse_mode).
 *
 * Config (.env): CHAIN_MONITOR_ENABLED(true), CHAIN_MONITOR_INTERVAL_MIN(5),
 *   CHAIN_MONITOR_STATUS_STALE_MIN(5), CHAIN_MONITOR_RENOTIFY_HOURS(6),
 *   SOUL_EXPECTED_PEER (optionaler Peer-Name für die Meldung).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class ChainHealthMonitor {
  constructor({ soulPath, telegram, bus, nodeName } = {}) {
    this.soulPath = soulPath;
    this.telegram = telegram;
    this.bus = bus || null;
    this.nodeName = nodeName || 'unknown';
    this.statusPath = join(soulPath, '.soul-chain-status');
    this.enabled = (process.env.CHAIN_MONITOR_ENABLED || 'true') !== 'false';
    this.intervalMs = parseInt(process.env.CHAIN_MONITOR_INTERVAL_MIN || '5', 10) * 60000;
    this.staleMs = parseInt(process.env.CHAIN_MONITOR_STATUS_STALE_MIN || '5', 10) * 60000;
    this.renotifyMs = parseInt(process.env.CHAIN_MONITOR_RENOTIFY_HOURS || '6', 10) * 3600000;
    this._timer = null;
    this._degraded = false;
    this._lastAlert = 0;
  }

  start() {
    if (!this.enabled) { console.log('  ChainHealth: disabled (CHAIN_MONITOR_ENABLED=false)'); return; }
    console.log(`  ChainHealth: monitoring .soul-chain-status (alle ${this.intervalMs / 60000}min)`);
    this._timer = setInterval(() => this._tick().catch(() => {}), this.intervalMs);
    if (this._timer.unref) this._timer.unref();
    setTimeout(() => this._tick().catch(() => {}), 30000); // erster Check kurz nach Boot
  }

  stop() { if (this._timer) clearInterval(this._timer); this._timer = null; }

  _evaluate() {
    if (!existsSync(this.statusPath)) return { degraded: true, reason: 'Chain-Status-Datei fehlt — Chain läuft nicht.' };
    let status;
    try { status = JSON.parse(readFileSync(this.statusPath, 'utf-8')); }
    catch { return { degraded: true, reason: 'Chain-Status unlesbar.' }; }

    if (status.active === false) return { degraded: true, reason: 'Chain inaktiv (active=false).' };
    const lastUpdate = status.lastUpdate ? new Date(status.lastUpdate).getTime() : 0;
    const ageMs = Date.now() - lastUpdate;
    if (!lastUpdate || ageMs > this.staleMs) {
      return { degraded: true, reason: `Chain-Status veraltet (${Math.floor(ageMs / 60000)}min) — Chain-Prozess vermutlich tot.` };
    }
    const peers = Array.isArray(status.peers) ? status.peers.length : 0;
    if (status.health === 'offline' || peers === 0) {
      return { degraded: true, reason: `Chain ohne Peer (health=${status.health}). Sync mit ${process.env.SOUL_EXPECTED_PEER || 'dem anderen Node'} steht nicht.` };
    }
    if (status.health === 'stale') return { degraded: true, reason: `Chain-Sync stale (${peers} peers).` };
    return { degraded: false, reason: `Chain ${status.health}, ${peers} peer(s), ${status.totalSynced ?? 0} synced.` };
  }

  async _tick() {
    const { degraded, reason } = this._evaluate();
    const now = Date.now();
    if (degraded) {
      const firstOrRenotify = !this._degraded || (now - this._lastAlert) > this.renotifyMs;
      this._degraded = true;
      this.bus?.safeEmit?.('chain.degraded', { source: 'chain-health', node: this.nodeName, reason });
      if (firstOrRenotify) {
        this._lastAlert = now;
        await this._notify(`⚠️ Soul-Infra degradiert (Node ${this.nodeName})\n\n${reason}\n\nPruefen: soul-chain auf beiden Nodes + .soul-chain-status.`);
      }
    } else if (this._degraded) {
      this._degraded = false;
      this.bus?.safeEmit?.('chain.recovered', { source: 'chain-health', node: this.nodeName, reason });
      await this._notify(`✅ Soul-Infra wieder gesund (Node ${this.nodeName})\n\n${reason}`);
    }
  }

  async _notify(msg) {
    try { await this.telegram?.sendToOwner?.(msg); }
    catch (err) { console.error(`  [chain-health] notify failed: ${err.message}`); }
  }
}
