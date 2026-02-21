// Soul Impulse View — Proactive activity monitor
// Reads .soul-impulse-state and .soul-impulse-log written by soul-engine

const fs = require('fs');
const path = require('path');
const { PALETTE, fg, RESET, BOLD, DIM, lerp, glow, dim } = require('./colors');

// Add impulse color to palette if not present
if (!PALETTE.impulse) {
  PALETTE.impulse = [255, 180, 0]; // Warm amber
}

const TYPE_COLORS = {
  share_thought:   PALETTE.bewusstsein,
  ask_question:    PALETTE.bonds,
  news_research:   PALETTE.interessen,
  server_check:    PALETTE.statelog,
  hobby_pursuit:   PALETTE.garten,
  express_emotion: PALETTE.traeume,
  tech_suggestion: PALETTE.manifest,
  provoke:         PALETTE.heartbeat,
  dream_share:     PALETTE.traeume,
  memory_reflect:  PALETTE.mem,
};

const TYPE_ICONS = {
  share_thought:   '\u2726', // ✦
  ask_question:    '\u2753', // ❓
  news_research:   '\u2609', // ☉
  server_check:    '\u2699', // ⚙
  hobby_pursuit:   '\u2618', // ☘
  express_emotion: '\u2665', // ♥
  tech_suggestion: '\u26A1', // ⚡
  provoke:         '\u2620', // ☠
  dream_share:     '\u263E', // ☾
  memory_reflect:  '\u2B50', // ⭐
};

class ImpulseView {
  constructor(soulPath) {
    this.soulPath = path.resolve(soulPath);
    this.statePath = path.join(this.soulPath, '.soul-impulse-state');
    this.logPath = path.join(this.soulPath, '.soul-impulse-log');
    this.tick = 0;
    this.state = null;
    this.log = [];
    this.lastLoad = 0;
  }

  loadData() {
    const now = Date.now();
    if (this.state && now - this.lastLoad < 2000) return;

    try {
      if (fs.existsSync(this.statePath)) {
        this.state = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
      }
    } catch { this.state = null; }

    try {
      if (fs.existsSync(this.logPath)) {
        this.log = JSON.parse(fs.readFileSync(this.logPath, 'utf-8'));
      }
    } catch { this.log = []; }

    this.lastLoad = now;
  }

  render() {
    this.tick += 0.15;
    this.loadData();

    const lines = [];

    // Title
    const t = glow(this.tick, 0.4);
    const titleColor = lerp(PALETTE.impulse, PALETTE.white, t * 0.3);
    lines.push(`${fg(titleColor)}${BOLD}  \u26A1 SOUL IMPULSE \u2014 Proactive Activity${RESET}`);
    lines.push('');

    if (!this.state) {
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}No impulse data yet.${RESET}`);
      lines.push('');
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}The impulse system activates when the Soul Engine${RESET}`);
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}starts with Telegram configured.${RESET}`);
      lines.push('');
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}b:brain  w:whisper  r:replay  c:card  n:chain${RESET}`);
      return lines.join('\n');
    }

    // ── Mood Bar ──────────────────────────────────────

    const mood = this.state.mood || { valence: 0, energy: 0.5, label: '?' };
    const moodT = glow(this.tick, mood.energy > 0.5 ? 2 : 0.8);
    const moodColor = mood.valence > 0.2
      ? lerp(PALETTE.wachstum, PALETTE.white, moodT * 0.2)
      : mood.valence < -0.2
        ? lerp(PALETTE.heartbeat, PALETTE.white, moodT * 0.2)
        : lerp(PALETTE.bewusstsein, PALETTE.white, moodT * 0.2);

    const moodBar = this._bar(mood.energy, 10);
    const valenceStr = mood.valence >= 0 ? `+${mood.valence.toFixed(1)}` : mood.valence.toFixed(1);

    lines.push(
      `  ${fg(PALETTE.dimWhite)}MOOD${RESET}  ` +
      `${fg(moodColor)}${BOLD}${mood.label}${RESET} ` +
      `${fg(moodColor)}${moodBar}${RESET} ` +
      `${fg(PALETTE.dimWhite)}(v:${valenceStr} e:${mood.energy.toFixed(1)})${RESET}` +
      `    ` +
      `${fg(PALETTE.dimWhite)}ENGAGEMENT${RESET}  ` +
      `${fg(PALETTE.gold)}${this._bar(this.state.engagementScore || 0, 10)}${RESET} ` +
      `${fg(PALETTE.gold)}${(this.state.engagementScore || 0).toFixed(2)}${RESET}`
    );
    lines.push('');

    // ── Recent Impulses ──────────────────────────────

    const recentLog = (this.log || []).slice(-12).reverse();

    if (recentLog.length > 0) {
      lines.push(`  ${fg(PALETTE.impulse)}${BOLD}RECENT IMPULSES${RESET}`);
      const sep = '\u2500'.repeat(62);
      lines.push(`  ${fg(PALETTE.line)}${DIM}${sep}${RESET}`);

      for (let i = 0; i < recentLog.length; i++) {
        const entry = recentLog[i];
        const fadeT = Math.min(i / 8, 0.7);
        const typeColor = lerp(TYPE_COLORS[entry.type] || PALETTE.white, PALETTE.dimWhite, fadeT);
        const textColor = lerp(PALETTE.white, PALETTE.dimWhite, fadeT);

        const icon = TYPE_ICONS[entry.type] || '\u2022';
        const time = this._formatTime(entry.time);
        const type = (entry.type || '?').padEnd(16);
        let preview = (entry.preview || '').replace(/\n/g, ' ');
        if (preview.length > 42) preview = preview.substring(0, 39) + '...';

        // Response indicator
        const responded = entry.responded
          ? `${fg(PALETTE.wachstum)}\u2713${RESET}`
          : `${fg(PALETTE.dimWhite)}${DIM}-${RESET}`;

        const prefix = i === 0
          ? `${fg(typeColor)}${BOLD}${icon}${RESET}`
          : `${fg(typeColor)}${DIM}${icon}${RESET}`;

        lines.push(
          `  ${prefix} ` +
          `${fg(PALETTE.dimWhite)}${time}${RESET}  ` +
          `${fg(typeColor)}${type}${RESET}` +
          `${fg(textColor)}${DIM}"${preview}"${RESET}  ` +
          responded
        );
      }
    } else {
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}No impulses yet. Waiting for first spontaneous thought...${RESET}`);
    }

    // ── Interest Weights ─────────────────────────────

    lines.push('');
    const interests = this.state.interestWeights || {};
    const sorted = Object.entries(interests)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    if (sorted.length > 0) {
      lines.push(`  ${fg(PALETTE.interessen)}${BOLD}TOP INTERESTS${RESET}`);
      const sep2 = '\u2500'.repeat(62);
      lines.push(`  ${fg(PALETTE.line)}${DIM}${sep2}${RESET}`);

      // Show in rows of 3
      for (let i = 0; i < sorted.length; i += 3) {
        const row = sorted.slice(i, i + 3).map(([name, weight]) => {
          const bar = this._bar(weight, 8);
          const barColor = lerp(PALETTE.interessen, PALETTE.white, weight * 0.3);
          return `${fg(PALETTE.white)}${name}${RESET} ${fg(barColor)}${bar}${RESET} ${fg(PALETTE.dimWhite)}${weight.toFixed(1)}${RESET}`;
        });
        lines.push(`  ${row.join('  ${fg(PALETTE.dimWhite)}${DIM}\u2502${RESET}  ')}`);
      }
    }

    // ── Footer Stats ─────────────────────────────────

    lines.push('');
    const footerSep = '\u2500'.repeat(56);
    lines.push(`  ${fg(PALETTE.line)}${DIM}${footerSep}${RESET}`);
    lines.push('');

    // Daily count
    const dailyCount = this.state.dailyImpulseCount || 0;
    const countColor = dailyCount > 0 ? PALETTE.gold : PALETTE.dimWhite;
    lines.push(
      `  ${fg(PALETTE.dimWhite)}Today:${RESET}  ${fg(countColor)}${BOLD}${dailyCount}${RESET} ${fg(PALETTE.dimWhite)}impulses${RESET}` +
      `    ${fg(PALETTE.dimWhite)}Ignored:${RESET}  ${fg(this.state.consecutiveIgnored > 2 ? PALETTE.heartbeat : PALETTE.dimWhite)}${this.state.consecutiveIgnored || 0}${RESET}`
    );

    // Next impulse estimate
    if (this.state.lastImpulse) {
      const sinceLast = Date.now() - new Date(this.state.lastImpulse).getTime();
      const minStr = Math.round(sinceLast / 60000);
      lines.push(`  ${fg(PALETTE.dimWhite)}Last impulse:${RESET}  ${fg(PALETTE.white)}${minStr}min ago${RESET}`);
    }

    // Navigation
    lines.push('');
    lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}b:brain  w:whisper  r:replay  c:card  n:chain${RESET}`);

    return lines.join('\n');
  }

  _bar(value, width) {
    const filled = Math.round(value * width);
    const empty = width - filled;
    return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
  }

  _formatTime(isoStr) {
    if (!isoStr) return '?    ';
    try {
      return new Date(isoStr).toLocaleTimeString('de-DE', {
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return '?    '; }
  }
}

module.exports = { ImpulseView };
