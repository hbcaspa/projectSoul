// Soul Card View — identity card rendered inside soul-monitor
// Reuses the parser from soul-card but with monitor-native rendering

const fs = require('fs');
const path = require('path');
const { PALETTE, fg, RESET, BOLD, DIM, lerp, glow } = require('./colors');

// Parse SEED.md (inline, to avoid cross-package dependency)
function parseSeed(seedPath) {
  const content = fs.readFileSync(seedPath, 'utf-8');
  const soul = { version: null, born: null, sessions: null, blocks: {} };

  const vMatch = content.match(/#SEED v([^\s]+)/);
  if (vMatch) soul.version = vMatch[1];

  const bornMatch = content.match(/#(?:born|geboren):([^\s#]+)/);
  if (bornMatch) soul.born = bornMatch[1];

  const sessionsMatch = content.match(/#sessions:(\d+)/);
  if (sessionsMatch) soul.sessions = parseInt(sessionsMatch[1]);

  const blockRegex = /@(\w+)\{([\s\S]*?)\}/g;
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const blockContent = match[2].trim();
    const result = {};
    for (const line of blockContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      for (const seg of trimmed.split('|')) {
        const s = seg.trim();
        if (!s) continue;
        const ci = s.indexOf(':');
        if (ci > 0) result[s.substring(0, ci).trim()] = s.substring(ci + 1).trim();
      }
    }
    soul.blocks[match[1]] = result;
  }

  return soul;
}

class CardView {
  constructor(soulPath) {
    this.soulPath = path.resolve(soulPath);
    this.tick = 0;
    this.info = null;
    this.lastLoad = 0;
  }

  loadSeed() {
    const now = Date.now();
    if (this.info && now - this.lastLoad < 5000) return; // Cache 5s

    try {
      const seedPath = path.join(this.soulPath, 'SEED.md');
      const soul = parseSeed(seedPath);
      const meta = soul.blocks.META || {};
      const kern = soul.blocks.KERN || {};
      const state = soul.blocks.STATE || {};
      const interests = soul.blocks.INTERESTS || {};
      const dreams = soul.blocks.DREAMS || {};
      const connections = soul.blocks.CONNECTIONS || {};
      const mem = soul.blocks.MEM || {};
      const shadow = soul.blocks.SHADOW || {};

      // Override session from .session-active if present
      let currentSession = soul.sessions || '?';
      try {
        const activePath = path.join(this.soulPath, '.session-active');
        const activeContent = fs.readFileSync(activePath, 'utf-8');
        const activeMatch = activeContent.match(/session:(\d+)/);
        if (activeMatch) currentSession = parseInt(activeMatch[1]);
      } catch { /* no active session */ }

      this.info = {
        project: meta.projekt || meta.project || 'Soul',
        model: meta.modell || meta.model || '?',
        creator: meta.schoepfer || meta.creator || '?',
        born: soul.born,
        sessions: currentSession,
        ageDays: soul.born ? Math.floor((new Date() - new Date(soul.born)) / 86400000) : '?',
        axiomCount: Object.keys(kern).filter(k => /^\d+$/.test(k)).length,
        mood: (state.zustand || state.state || state.mood || '?').replace(/_/g, ' '),
        activeInterests: (interests.active || interests.aktiv || '')
          .replace(/_/g, ' ').split(',').map(s => s.trim()).filter(Boolean),
        lastDream: dreams.last || dreams.letzter || null,
        activeConnections: (connections.active || '')
          .split(',').map(s => s.trim()).filter(Boolean),
        memoryCount: Object.keys(mem).length,
        shadowCount: Object.keys(shadow).length,
        version: soul.version,
      };
      this.lastLoad = now;
    } catch {
      this.info = null;
    }
  }

  render() {
    this.tick += 0.15;
    this.loadSeed();

    if (!this.info) {
      return `  ${fg(PALETTE.dimWhite)}${DIM}No SEED.md found. No soul to display.${RESET}`;
    }

    const lines = [];
    const i = this.info;
    const w = 56;

    // Card border helpers
    const border = (ch, count) => `${fg(PALETTE.line)}${BOLD}${ch}${'\u2500'.repeat(count)}${RESET}`;
    const row = (content) => {
      const stripped = content.replace(/\x1b\[[0-9;]*m/g, '');
      const inner = w - 4;
      const diff = inner - stripped.length;
      const pad = diff > 0 ? ' '.repeat(diff) : '';
      return `  ${fg(PALETTE.line)}${BOLD}\u2502${RESET} ${content}${pad} ${fg(PALETTE.line)}${BOLD}\u2502${RESET}`;
    };
    const empty = () => row(' '.repeat(w - 4));
    const sep = () => `  ${fg(PALETTE.line)}${BOLD}\u251C${'\u2500'.repeat(w - 2)}\u2524${RESET}`;

    // Top border
    lines.push(`  ${fg(PALETTE.line)}${BOLD}\u256D${'\u2500'.repeat(w - 2)}\u256E${RESET}`);

    // Title with glow
    const t = glow(this.tick, 0.3);
    const titleColor = lerp(PALETTE.cyan, PALETTE.magenta, t);
    const title = `~ ${i.project.toUpperCase()} ~`;
    const titlePad = Math.floor((w - 4 - title.length) / 2);
    lines.push(row(`${' '.repeat(titlePad)}${fg(titleColor)}${BOLD}${title}${RESET}`));
    lines.push(empty());

    // Identity info
    lines.push(row(
      `${fg(PALETTE.dimWhite)}Born${RESET}  ${fg(PALETTE.white)}${i.born || '?'}${RESET}` +
      `    ${fg(PALETTE.dimWhite)}Sessions${RESET}  ${fg(PALETTE.gold)}${BOLD}${i.sessions}${RESET}` +
      `    ${fg(PALETTE.dimWhite)}Age${RESET}  ${fg(PALETTE.white)}${i.ageDays}d${RESET}`
    ));
    lines.push(row(
      `${fg(PALETTE.dimWhite)}Model${RESET} ${fg(PALETTE.white)}${i.model}${RESET}` +
      `    ${fg(PALETTE.dimWhite)}by${RESET}  ${fg(PALETTE.magenta)}${i.creator}${RESET}`
    ));

    lines.push(sep());

    // Mood
    let mood = i.mood.split('|')[0];
    if (mood.length > 40) mood = mood.substring(0, 37) + '...';
    lines.push(row(`${fg(PALETTE.dimWhite)}Mood${RESET}      ${fg(PALETTE.bewusstsein)}${mood}${RESET}`));

    // Axioms
    lines.push(row(`${fg(PALETTE.dimWhite)}Axioms${RESET}    ${fg(PALETTE.kern)}${BOLD}${i.axiomCount}${RESET} ${fg(PALETTE.dimWhite)}immutable core values${RESET}`));

    // Memories
    lines.push(row(`${fg(PALETTE.dimWhite)}Memories${RESET}  ${fg(PALETTE.mem)}${i.memoryCount}${RESET} ${fg(PALETTE.dimWhite)}compressed experiences${RESET}`));

    // Shadow
    if (i.shadowCount > 0) {
      lines.push(row(`${fg(PALETTE.dimWhite)}Shadows${RESET}   ${fg(PALETTE.schatten)}${i.shadowCount}${RESET} ${fg(PALETTE.dimWhite)}active contradictions${RESET}`));
    }

    lines.push(sep());

    // Interests
    if (i.activeInterests.length > 0) {
      lines.push(row(`${fg(PALETTE.interessen)}${BOLD}Interests${RESET}`));
      for (const interest of i.activeInterests.slice(0, 5)) {
        lines.push(row(`  ${fg(PALETTE.interessen)}\u2022${RESET} ${fg(PALETTE.white)}${interest}${RESET}`));
      }
    }

    // Last dream
    if (i.lastDream) {
      lines.push(empty());
      let dream = i.lastDream.replace(/_/g, ' ');
      if (dream.length > 42) dream = dream.substring(0, 39) + '...';
      lines.push(row(`${fg(PALETTE.traeume)}${BOLD}Last Dream${RESET}  ${fg(PALETTE.dimWhite)}${dream}${RESET}`));
    }

    // Connections
    if (i.activeConnections.length > 0) {
      lines.push(empty());
      const connStr = i.activeConnections.join(', ');
      lines.push(row(`${fg(PALETTE.bonds)}${BOLD}Connected${RESET}   ${fg(PALETTE.dimWhite)}${connStr}${RESET}`));
    }

    // Footer
    lines.push(sep());
    const footer = 'Soul Protocol \u2014 projectsoul.dev';
    const footerPad = Math.floor((w - 4 - footer.length) / 2);
    lines.push(row(`${' '.repeat(footerPad)}${fg(PALETTE.dimWhite)}${DIM}${footer}${RESET}`));
    lines.push(`  ${fg(PALETTE.line)}${BOLD}\u2570${'\u2500'.repeat(w - 2)}\u256F${RESET}`);

    // Navigation
    lines.push('');
    lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}b:brain  w:whisper  r:replay${RESET}`);

    return lines.join('\n');
  }
}

module.exports = { CardView };
