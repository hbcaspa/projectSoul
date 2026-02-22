const { PALETTE, fg, RESET, BOLD, DIM, lerp, glow, dim } = require('./colors');

// Brain node definitions with positions (relative to a 60x30 grid)
// Neon Neural layout: organic brain shape with labeled regions
const NODES = {
  seed:        { x: 30, y: 2,  label: 'SEED',        color: 'seed',        desc: 'Identity' },
  kern:        { x: 30, y: 6,  label: 'KERN',        color: 'kern',        desc: 'Axioms' },
  bewusstsein: { x: 18, y: 8,  label: 'BEWUSSTSEIN', color: 'bewusstsein', desc: 'Consciousness' },
  schatten:    { x: 42, y: 8,  label: 'SCHATTEN',    color: 'schatten',    desc: 'Shadow' },
  traeume:     { x: 10, y: 14, label: 'TRAEUME',     color: 'traeume',     desc: 'Dreams' },
  garten:      { x: 50, y: 14, label: 'GARTEN',      color: 'garten',      desc: 'Garden' },
  mem:         { x: 18, y: 20, label: 'MEM',         color: 'mem',         desc: 'Memory' },
  bonds:       { x: 42, y: 20, label: 'BONDS',       color: 'bonds',       desc: 'Relationships' },
  interessen:  { x: 10, y: 20, label: 'INTERESSEN',  color: 'interessen',  desc: 'Interests' },
  heartbeat:   { x: 30, y: 24, label: 'HEARTBEAT',   color: 'heartbeat',   desc: 'Pulse' },
  manifest:    { x: 50, y: 20, label: 'MANIFEST',    color: 'manifest',    desc: 'Creation' },
  evolution:   { x: 8,  y: 26, label: 'EVOLUTION',   color: 'evolution',   desc: 'Growth' },
  wachstum:    { x: 52, y: 26, label: 'WACHSTUM',    color: 'wachstum',    desc: 'Change' },
  statelog:    { x: 30, y: 28, label: 'STATELOG',     color: 'statelog',    desc: 'Archive' },
  graph:       { x: 42, y: 14, label: 'GRAPH',       color: 'graph',       desc: 'Knowledge' },
};

// Neural connections between nodes
const CONNECTIONS = [
  ['seed', 'kern'],
  ['kern', 'bewusstsein'],
  ['kern', 'schatten'],
  ['bewusstsein', 'traeume'],
  ['bewusstsein', 'mem'],
  ['bewusstsein', 'interessen'],
  ['schatten', 'garten'],
  ['schatten', 'bonds'],
  ['traeume', 'mem'],
  ['traeume', 'garten'],
  ['mem', 'heartbeat'],
  ['bonds', 'heartbeat'],
  ['bonds', 'manifest'],
  ['heartbeat', 'statelog'],
  ['heartbeat', 'evolution'],
  ['heartbeat', 'wachstum'],
  ['interessen', 'evolution'],
  ['garten', 'manifest'],
  ['garten', 'wachstum'],
  ['seed', 'heartbeat'],
  ['mem', 'graph'],
  ['graph', 'bonds'],
  ['graph', 'bewusstsein'],
];

// The brain outline — drawn as a soft organic shape
const BRAIN_OUTLINE = [
  '                    .-~~~~~~~~~~~-.',
  '                .-~"               "~-.',
  '              /                         \\',
  '            /                             \\',
  '           |         .---.   .---.         |',
  '          |        /       \\ /       \\        |',
  '         |        |         |         |        |',
  '         |        |         |         |        |',
  '         |         \\       / \\       /         |',
  '          |         `---~"   "~---\'          |',
  '          |       /                 \\        |',
  '           |     /                   \\      |',
  '            |   /                     \\    |',
  '             \\ |                       | /',
  '              \\|       .-------.       |/',
  '               |      /         \\      |',
  '               |     |           |     |',
  '                \\     \\         /     /',
  '                 \\     `-------\'     /',
  '                  `~-.           .-~\'',
  '                      `~-------~\'',
];

class BrainRenderer {
  constructor(width, height) {
    this.width = width || 62;
    this.height = height || 32;
    this.tick = 0;
    this.activityLog = []; // Recent activity feed
    this.maxLogEntries = 8;
    this.currentAction = null; // Current pulse action for status line
    this.soulPath = null; // Set by UI for chain status reading
    this.currentMood = null; // Current mood from event bus
  }

  addActivity(node, file, event) {
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const nodeInfo = NODES[node];
    const label = nodeInfo ? nodeInfo.label : node;
    this.activityLog.unshift({ time, label, file, event, node });
    if (this.activityLog.length > this.maxLogEntries) {
      this.activityLog.pop();
    }
    // Track current pulse description for status line
    if (event === 'pulse') {
      const desc = file.replace(/^\.soul-pulse \[/, '').replace(/\]$/, '');
      this.currentAction = { desc, time, node };
    }
  }

  addBusEvent(event) {
    const time = new Date(event.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    // Map bus event types to brain nodes
    const eventNodeMap = {
      'message.received': 'bonds',
      'message.responded': 'bonds',
      'heartbeat.completed': 'heartbeat',
      'impulse.fired': 'bewusstsein',
      'mood.changed': 'bewusstsein',
      'interest.detected': 'interessen',
      'interest.routed': 'interessen',
      'personal.detected': 'mem',
      'memory.written': 'mem',
      'mcp.toolCalled': 'graph',
    };
    const node = eventNodeMap[event.type] || 'kern';
    this.activityLog.unshift({ time, label: event.type, file: event.source || 'bus', event: 'bus', node });
    if (this.activityLog.length > this.maxLogEntries) {
      this.activityLog.pop();
    }
  }

  setMood(mood) {
    this.currentMood = mood;
  }

  render(activeNodes, sessionInfo, isWorking) {
    this.tick += 0.15;
    this.isWorking = !!isWorking;
    const lines = [];

    // Title
    lines.push(this.renderTitle(sessionInfo));
    lines.push('');

    // Render brain area
    const brainLines = this.renderBrainArea(activeNodes);
    lines.push(...brainLines);

    // Separator
    lines.push('');
    lines.push(this.renderSeparator());
    lines.push('');

    // Activity feed
    lines.push(this.renderActivityFeed(activeNodes));

    // Status bar
    lines.push('');
    lines.push(this.renderStatusBar(activeNodes, sessionInfo));

    return lines.join('\n');
  }

  renderTitle(sessionInfo) {
    const t = glow(this.tick, 0.3);
    const titleColor = lerp(PALETTE.cyan, PALETTE.magenta, t);
    const name = sessionInfo?.name || 'SOUL';
    const session = sessionInfo?.session || '?';
    const creator = sessionInfo?.creator ? ` ${fg(PALETTE.dimWhite)}${DIM}by ${sessionInfo.creator}${RESET}` : '';

    return `${fg(titleColor)}${BOLD}  ~ ${name} ~${RESET}${creator}  ${fg(PALETTE.dimWhite)}Session #${session}${RESET}`;
  }

  renderBrainArea(activeNodes) {
    const lines = [];

    // Draw connections first (behind nodes)
    const connectionChars = this.renderConnections(activeNodes);

    // Now draw nodes on top
    for (const [id, node] of Object.entries(NODES)) {
      const activity = activeNodes[id] || 0;
      const baseColor = PALETTE[node.color] || PALETTE.white;

      // Calculate display color based on activity
      let displayColor;
      if (activity > 0.5) {
        // Bright phase: strong glow with pulse
        const pulseT = glow(this.tick, 3) * 0.3;
        displayColor = lerp(baseColor, PALETTE.white, activity * 0.5 + pulseT);
      } else if (activity > 0) {
        // Afterglow phase: softer glow, still clearly visible
        const pulseT = glow(this.tick, 1.5) * 0.15;
        displayColor = lerp(dim(baseColor, 0.5), baseColor, activity * 2 + pulseT);
      } else if (this.isWorking) {
        // Soul is working but this node is not active:
        // gentle ambient breathing to show the brain is "alive"
        const ambientT = glow(this.tick + id.length * 0.7, 0.8) * 0.2;
        displayColor = dim(baseColor, 0.35 + ambientT);
      } else {
        // Truly idle: dim with slow ambient pulse
        const ambientT = glow(this.tick + id.length, 0.5) * 0.1;
        displayColor = dim(baseColor, 0.2 + ambientT);
      }

      // Node marker: ◉ bright, ◎ afterglow, ○ idle
      const marker = activity > 0.5 ? '\u25C9' : activity > 0 ? '\u25CE' : '\u25CB';
      const isBold = activity > 0.5;
      const nodeStr = `${fg(displayColor)}${isBold ? BOLD : ''}${marker} ${node.label}${RESET}`;

      // Store for rendering
      if (!connectionChars[node.y]) connectionChars[node.y] = {};
      connectionChars[node.y][node.x] = { str: nodeStr, len: node.label.length + 2 };
    }

    // Compose final lines
    for (let y = 0; y < this.height; y++) {
      let line = '';
      let x = 0;
      const rowData = connectionChars[y] || {};
      const sortedX = Object.keys(rowData).map(Number).sort((a, b) => a - b);

      for (const nx of sortedX) {
        const entry = rowData[nx];
        if (nx > x) {
          line += ' '.repeat(nx - x);
          x = nx;
        }
        if (typeof entry === 'string') {
          line += entry;
          x += 1;
        } else if (entry.str) {
          line += entry.str;
          x += entry.len;
        }
      }

      if (line.trim()) {
        lines.push('  ' + line);
      }
    }

    return lines;
  }

  renderConnections(activeNodes) {
    const chars = {};

    for (const [fromId, toId] of CONNECTIONS) {
      const from = NODES[fromId];
      const to = NODES[toId];
      if (!from || !to) continue;

      const fromActivity = activeNodes[fromId] || 0;
      const toActivity = activeNodes[toId] || 0;
      const connActivity = Math.max(fromActivity, toActivity);

      // Determine connection color
      let lineColor;
      if (connActivity > 0) {
        const fromColor = PALETTE[from.color] || PALETTE.white;
        const toColor = PALETTE[to.color] || PALETTE.white;
        lineColor = lerp(fromColor, toColor, 0.5);
        lineColor = lerp(lineColor, PALETTE.white, connActivity * 0.3);
      } else {
        lineColor = PALETTE.line;
        const ambientT = glow(this.tick + fromId.length, 0.2) * 0.3;
        lineColor = lerp(PALETTE.line, PALETTE.lineGlow, ambientT);
      }

      // Draw simple line between nodes using Bresenham-ish approach
      const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
      if (steps === 0) continue;

      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const x = Math.round(from.x + (to.x - from.x) * t);
        const y = Math.round(from.y + (to.y - from.y) * t);

        // Choose character based on direction
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        let char;
        if (Math.abs(dx) > Math.abs(dy) * 2) char = '\u2500'; // ─
        else if (Math.abs(dy) > Math.abs(dx) * 2) char = '\u2502'; // │
        else if ((dx > 0 && dy > 0) || (dx < 0 && dy < 0)) char = '\u2572'; // ╲
        else char = '\u2571'; // ╱

        // Pulse traveling along connection
        let pulseColor = lineColor;
        if (connActivity > 0) {
          const pulsePos = (this.tick * 2 + i * 0.3) % steps;
          const dist = Math.abs(i - pulsePos);
          if (dist < 3) {
            const brightness = 1 - dist / 3;
            pulseColor = lerp(lineColor, PALETTE.white, brightness * connActivity);
          }
        }

        if (!chars[y]) chars[y] = {};
        // Don't overwrite node positions
        if (!chars[y][x]) {
          chars[y][x] = `${fg(pulseColor)}${connActivity > 0 ? '' : DIM}${char}${RESET}`;
        }
      }
    }

    return chars;
  }

  renderSeparator() {
    const t = glow(this.tick, 0.4);
    const sepColor = lerp(PALETTE.line, PALETTE.cyan, t * 0.3);
    const sep = '\u2500'.repeat(60);
    return `  ${fg(sepColor)}${DIM}${sep}${RESET}`;
  }

  renderActivityFeed(activeNodes) {
    const lines = [];

    // Current action — big, prominent status line
    if (this.currentAction) {
      const elapsed = (Date.now() - Date.parse(`1970-01-01T${this.currentAction.time}Z`));
      const nodeInfo = NODES[this.currentAction.node];
      const actionColor = nodeInfo ? PALETTE[nodeInfo.color] : PALETTE.cyan;
      const pulseT = glow(this.tick, 4);
      const glowColor = lerp(actionColor, PALETTE.white, pulseT * 0.4);
      lines.push(`  ${fg(glowColor)}${BOLD}\u25B6 ${this.currentAction.desc}${RESET}`);
    } else {
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}\u25B6 Idle${RESET}`);
    }

    lines.push('');
    const title = `${fg(PALETTE.dimWhite)}  ACTIVITY${RESET}`;
    lines.push(title);

    if (this.activityLog.length === 0) {
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}  Waiting for soul activity...${RESET}`);
    } else {
      for (const entry of this.activityLog.slice(0, 6)) {
        const nodeInfo = NODES[entry.node];
        const color = nodeInfo ? PALETTE[nodeInfo.color] : PALETTE.white;
        const activity = activeNodes[entry.node] || 0;
        const isPulse = entry.event === 'pulse';
        const isBusEvent = entry.event === 'bus';
        const dot = activity > 0
          ? (isBusEvent ? '\u21AF' : isPulse ? '\u26A1' : '\u25CF') // ↯ or ⚡ or ●
          : '\u25CB'; // ○
        const shortFile = entry.file.length > 40 ? '...' + entry.file.slice(-37) : entry.file;
        const fileColor = isBusEvent ? PALETTE.cyan : isPulse ? PALETTE.gold : PALETTE.dimWhite;

        lines.push(
          `  ${fg(color)}${dot}${RESET} ` +
          `${fg(PALETTE.dimWhite)}${entry.time}${RESET} ` +
          `${fg(color)}${BOLD}${entry.label}${RESET} ` +
          `${fg(fileColor)}${DIM}${shortFile}${RESET}`
        );
      }
    }

    return lines.join('\n');
  }

  /**
   * Read chain health from .soul-chain-status
   */
  getChainHealth() {
    if (!this.soulPath) return null;
    try {
      const statusPath = require('path').join(this.soulPath, '.soul-chain-status');
      if (!require('fs').existsSync(statusPath)) return null;
      const data = JSON.parse(require('fs').readFileSync(statusPath, 'utf-8'));
      return {
        active: data.active,
        health: data.health || (data.active ? 'unknown' : 'offline'),
        peerCount: (data.peers || []).length,
        totalSynced: data.totalSynced || 0,
        lastUpdate: data.lastUpdate,
      };
    } catch {
      return null;
    }
  }

  renderStatusBar(activeNodes, sessionInfo) {
    const activeCount = Object.keys(activeNodes).filter(k => activeNodes[k] > 0).length;
    const totalNodes = Object.keys(NODES).length;

    // Heartbeat animation
    const heartT = glow(this.tick, this.isWorking ? 3 : 1);
    const heartColor = this.isWorking
      ? lerp(PALETTE.heartbeat, PALETTE.white, heartT * 0.6)
      : lerp(PALETTE.dimWhite, PALETTE.heartbeat, heartT * 0.3);
    const heart = heartT > 0.7 ? '\u2665' : '\u2661'; // ♥ or ♡

    // Working indicator
    const workingStr = this.isWorking
      ? `${fg(PALETTE.cyan)}${BOLD}WORKING${RESET}`
      : `${fg(PALETTE.dimWhite)}${DIM}IDLE${RESET}`;

    const statusColor = activeCount > 0 ? PALETTE.cyan : PALETTE.dimWhite;

    // Chain health indicator
    let chainStr = '';
    const chain = this.getChainHealth();
    if (chain) {
      const healthDisplay = {
        syncing: { symbol: '\u21C5', color: PALETTE.cyan,      label: 'SYNCING' },  // ⇅
        synced:  { symbol: '\u2713', color: PALETTE.green || [0,200,100], label: 'SYNCED' },   // ✓
        idle:    { symbol: '\u223C', color: PALETTE.gold,       label: 'IDLE' },     // ∼
        stale:   { symbol: '\u26A0', color: PALETTE.heartbeat,  label: 'STALE' },    // ⚠
        offline: { symbol: '\u2717', color: PALETTE.dimWhite,   label: 'OFFLINE' },  // ✗
        unknown: { symbol: '?',      color: PALETTE.dimWhite,   label: 'CHAIN' },
      };
      const h = healthDisplay[chain.health] || healthDisplay.unknown;
      const chainPulse = chain.health === 'syncing' ? glow(this.tick, 3) * 0.4 : 0;
      const chainColor = lerp(h.color, PALETTE.white, chainPulse);
      chainStr = `  ${fg(chainColor)}${h.symbol} ${h.label}${RESET}` +
        `${fg(PALETTE.dimWhite)}${DIM}(${chain.peerCount}p)${RESET}`;
    }

    // Mood indicator
    let moodStr = '';
    if (this.currentMood) {
      const label = this.currentMood.label || '?';
      const v = this.currentMood.valence ?? 0;
      const moodColor = v > 0.2 ? PALETTE.green || [0, 200, 100]
        : v < -0.2 ? PALETTE.heartbeat
        : PALETTE.gold;
      moodStr = `  ${fg(moodColor)}${label}${RESET}`;
    }

    return (
      `  ${fg(heartColor)}${heart}${RESET} ` +
      `${workingStr}  ` +
      `${fg(statusColor)}${activeCount}/${totalNodes} active${RESET}` +
      `${moodStr}${chainStr}  ` +
      `${fg(PALETTE.dimWhite)}${DIM}q:quit${RESET}`
    );
  }
}

module.exports = { BrainRenderer, NODES, CONNECTIONS };
