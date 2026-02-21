// Soul Chain View — P2P network status inside soul-monitor
// Reads .soul-chain-status written by soul-chain

const fs = require('fs');
const path = require('path');
const { PALETTE, fg, RESET, BOLD, DIM, lerp, glow, dim } = require('./colors');

class ChainView {
  constructor(soulPath) {
    this.soulPath = path.resolve(soulPath);
    this.statusPath = path.join(this.soulPath, '.soul-chain-status');
    this.configPath = path.join(this.soulPath, '.soul-chain');
    this.tick = 0;
    this.status = null;
    this.lastLoad = 0;
  }

  loadStatus() {
    const now = Date.now();
    if (this.status && now - this.lastLoad < 2000) return;

    try {
      if (fs.existsSync(this.statusPath)) {
        this.status = JSON.parse(fs.readFileSync(this.statusPath, 'utf-8'));
        this.lastLoad = now;
      } else {
        this.status = null;
      }
    } catch {
      this.status = null;
    }
  }

  hasConfig() {
    return fs.existsSync(this.configPath);
  }

  getPeerCount() {
    this.loadStatus();
    if (!this.status || !this.status.active) return 0;
    return this.status.peers ? this.status.peers.length : 0;
  }

  isActive() {
    this.loadStatus();
    return !!(this.status && this.status.active);
  }

  render() {
    this.tick += 0.15;
    this.loadStatus();

    const lines = [];

    // Title
    const t = glow(this.tick, 0.3);
    const titleColor = lerp(PALETTE.chain, PALETTE.white, t * 0.3);
    lines.push(`${fg(titleColor)}${BOLD}  \u2B21 SOUL CHAIN \u2014 P2P Network${RESET}`);
    lines.push('');

    // No config
    if (!this.hasConfig()) {
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}No chain configured.${RESET}`);
      lines.push('');
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}Run "soul-chain init" to create a chain,${RESET}`);
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}or "soul-chain join" to join an existing one.${RESET}`);
      lines.push('');
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}b:brain  w:whisper  r:replay  c:card${RESET}`);
      return lines.join('\n');
    }

    // No status file (chain not running)
    if (!this.status) {
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}Chain configured but not running.${RESET}`);
      lines.push('');
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}Run "soul-chain start" to connect.${RESET}`);
      lines.push('');
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}b:brain  w:whisper  r:replay  c:card${RESET}`);
      return lines.join('\n');
    }

    // Status indicator with health
    const active = this.status.active;
    const health = this.status.health || (active ? 'unknown' : 'offline');

    if (active) {
      const healthDisplay = {
        syncing: { symbol: '\u21C5', label: 'SYNCING',  desc: 'files transferring' },
        synced:  { symbol: '\u2713', label: 'SYNCED',   desc: 'all files match' },
        idle:    { symbol: '\u223C', label: 'IDLE',     desc: 'no recent activity' },
        stale:   { symbol: '\u26A0', label: 'STALE',    desc: 'no manifest exchange in 30+ min' },
        unknown: { symbol: '\u25C9', label: 'ACTIVE',   desc: 'status unknown' },
      };
      const h = healthDisplay[health] || healthDisplay.unknown;
      const pulseT = glow(this.tick, health === 'syncing' ? 3 : 2);
      const dotColor = health === 'stale'
        ? lerp(PALETTE.heartbeat, PALETTE.white, pulseT * 0.3)
        : lerp(PALETTE.chain, PALETTE.white, pulseT * 0.5);
      lines.push(
        `  ${fg(dotColor)}${BOLD}${h.symbol} ${h.label}${RESET}  ` +
        `${fg(PALETTE.dimWhite)}${h.desc} \u2014 since ${this.formatDate(this.status.since)}${RESET}`
      );
    } else {
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}\u25CB OFFLINE${RESET}  ${fg(PALETTE.dimWhite)}${DIM}last active ${this.formatDate(this.status.lastUpdate)}${RESET}`);
    }

    lines.push('');

    // Peers
    const peers = this.status.peers || [];
    const peerCount = peers.length;

    if (peerCount === 0 && active) {
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}Listening for peers...${RESET}`);
      lines.push('');
      const waitT = glow(this.tick, 0.5);
      const dots = '.'.repeat(Math.floor(waitT * 3) + 1);
      lines.push(`  ${fg(PALETTE.chain)}${DIM}\u2B21 Scanning${dots}${RESET}`);
    } else if (peerCount > 0) {
      const peerLabel = peerCount === 1 ? 'PEER' : 'PEERS';
      lines.push(`  ${fg(PALETTE.chain)}${BOLD}${peerCount} ${peerLabel} CONNECTED${RESET}`);
      lines.push('');

      // Peer table header
      lines.push(
        `  ${fg(PALETTE.dimWhite)}${DIM}` +
        'ID'.padEnd(12) +
        'Connected'.padEnd(14) +
        '\u2193 Recv'.padEnd(8) +
        '\u2191 Sent'.padEnd(8) +
        'Last Sync'.padEnd(12) +
        `Manifest${RESET}`
      );

      const sep = '\u2500'.repeat(62);
      lines.push(`  ${fg(PALETTE.line)}${DIM}${sep}${RESET}`);

      for (const peer of peers) {
        const peerT = glow(this.tick + peer.id.charCodeAt(0) * 0.1, 1.5);
        const peerColor = lerp(PALETTE.chain, PALETTE.white, peerT * 0.2);

        const id = peer.id.padEnd(12);
        const connected = this.formatDuration(peer.connectedAt).padEnd(14);
        const recv = String(peer.filesReceived || 0).padEnd(8);
        const sent = String(peer.filesSent || 0).padEnd(8);
        const lastSync = (peer.lastSync ? this.formatTime(peer.lastSync) : '-').padEnd(12);
        const manifest = peer.lastManifestExchange ? this.formatTime(peer.lastManifestExchange) : '-';

        lines.push(
          `  ${fg(peerColor)}${BOLD}\u2B22${RESET} ` +
          `${fg(PALETTE.white)}${id}${RESET}` +
          `${fg(PALETTE.dimWhite)}${connected}${RESET}` +
          `${fg(PALETTE.wachstum)}${recv}${RESET}` +
          `${fg(PALETTE.interessen)}${sent}${RESET}` +
          `${fg(PALETTE.dimWhite)}${lastSync}${RESET}` +
          `${fg(PALETTE.chain)}${manifest}${RESET}`
        );
      }
    }

    // Total synced
    lines.push('');
    const totalSep = '\u2500'.repeat(56);
    lines.push(`  ${fg(PALETTE.line)}${DIM}${totalSep}${RESET}`);
    lines.push('');

    const total = this.status.totalSynced || 0;
    const totalColor = total > 0 ? PALETTE.gold : PALETTE.dimWhite;
    lines.push(`  ${fg(PALETTE.dimWhite)}Total files synced:${RESET}  ${fg(totalColor)}${BOLD}${total}${RESET}`);

    // Last update
    if (this.status.lastUpdate) {
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}Last update: ${this.formatTime(this.status.lastUpdate)}${RESET}`);
    }

    // Navigation
    lines.push('');
    lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}b:brain  w:whisper  r:replay  c:card${RESET}`);

    return lines.join('\n');
  }

  formatDate(isoStr) {
    if (!isoStr) return '?';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } catch { return '?'; }
  }

  formatTime(isoStr) {
    if (!isoStr) return '?';
    try {
      return new Date(isoStr).toLocaleTimeString('de-DE', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch { return '?'; }
  }

  formatDuration(isoStr) {
    if (!isoStr) return '?';
    try {
      const ms = Date.now() - new Date(isoStr).getTime();
      const sec = Math.floor(ms / 1000);
      if (sec < 60) return `${sec}s`;
      const min = Math.floor(sec / 60);
      if (min < 60) return `${min}m`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr}h ${min % 60}m`;
      const days = Math.floor(hr / 24);
      return `${days}d ${hr % 24}h`;
    } catch { return '?'; }
  }
}

module.exports = { ChainView };
