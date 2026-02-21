const blessed = require('blessed');
const { BrainRenderer } = require('./brain');
const { SoulWatcher } = require('./watcher');
const { SoulWhisper } = require('./whisper');
const { SoulReplay } = require('./replay');
const { CardView } = require('./card-view');
const { PALETTE, fg, RESET, BOLD, DIM, lerp, glow } = require('./colors');
const fs = require('fs');
const path = require('path');

const VIEWS = {
  brain:   { key: '1', label: 'BRAIN',   shortcut: 'b' },
  whisper: { key: '2', label: 'WHISPER', shortcut: 'w' },
  replay:  { key: '3', label: 'REPLAY',  shortcut: 'r' },
  card:    { key: '4', label: 'CARD',    shortcut: 'c' },
};

class SoulMonitorUI {
  constructor(soulPath) {
    this.soulPath = path.resolve(soulPath);
    this.renderer = new BrainRenderer();
    this.watcher = new SoulWatcher(this.soulPath);
    this.whisper = new SoulWhisper();
    this.replay = new SoulReplay(this.soulPath);
    this.cardView = new CardView(this.soulPath);
    this.screen = null;
    this.mainBox = null;
    this.sessionInfo = { name: 'SOUL', session: '?' };
    this.renderInterval = null;
    this.currentView = 'brain';
    this.replayDate = null; // Current date for replay view
    this.replayData = null;
    this.whisperTick = 0;
  }

  async init() {
    await this.readSessionInfo();
    this.renderer.soulPath = this.soulPath;

    this.screen = blessed.screen({
      smartCSR: true,
      title: `Soul Monitor — ${this.sessionInfo.name}`,
      fullUnicode: true,
    });

    this.mainBox = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      tags: false,
      style: { fg: 'white' },
    });

    this.screen.append(this.mainBox);

    // Quit
    this.screen.key(['q', 'C-c', 'escape'], () => {
      this.stop();
      process.exit(0);
    });

    // View switching
    this.screen.key(['1'], () => this.switchView('brain'));
    this.screen.key(['2'], () => this.switchView('whisper'));
    this.screen.key(['3'], () => this.switchView('replay'));
    this.screen.key(['4'], () => this.switchView('card'));
    this.screen.key(['b'], () => this.switchView('brain'));
    this.screen.key(['w'], () => this.switchView('whisper'));
    this.screen.key(['r'], () => this.switchView('replay'));
    this.screen.key(['c'], () => this.switchView('card'));

    // Replay navigation (left/right arrow for date switching)
    this.screen.key(['left'], () => this.replayNavigate(-1));
    this.screen.key(['right'], () => this.replayNavigate(1));

    // Start watcher
    this.watcher.start();
    this.watcher.on('activity', ({ node, file, event }) => {
      this.renderer.addActivity(node, file, event);

      // Also feed whisper for pulse events
      if (event === 'pulse') {
        const desc = file.replace(/^\.soul-pulse \[/, '').replace(/\]$/, '');
        // Extract type from the activity
        const typeMatch = desc.match(/^(\w+)/);
        if (typeMatch) {
          // The desc is the full label; type was already resolved by watcher
          // We need to get the type from the pulse content
          this.feedWhisper(node, desc);
        }
      }
    });

    // Also intercept raw pulse for whisper
    this.watcher.on('rawPulse', ({ type, label }) => {
      this.whisper.transform(type, label);
    });

    // Render loop
    this.renderInterval = setInterval(() => this.renderFrame(), 66);
    this.renderFrame();
    this.screen.render();
  }

  feedWhisper(node, desc) {
    // Try to extract type from the description
    // The desc comes as the label from the pulse file
    // We need to match it to an activity type
    // For now, just use the node to guess the type
    const nodeToType = {
      interessen: 'search',
      mem: 'remember',
      bewusstsein: 'think',
      kern: 'think',
      schatten: 'reflect',
      traeume: 'dream',
      garten: 'garden',
      bonds: 'relate',
      manifest: 'write',
      evolution: 'grow',
      wachstum: 'grow',
      heartbeat: 'heartbeat',
      seed: 'wake',
      statelog: 'log',
    };
    const type = nodeToType[node] || 'think';
    this.whisper.transform(type, desc);
  }

  switchView(view) {
    this.currentView = view;
    if (view === 'replay' && !this.replayDate) {
      // Default to today or most recent date
      const dates = this.replay.getAvailableDates();
      this.replayDate = dates.length > 0 ? dates[dates.length - 1] : null;
      if (this.replayDate) {
        this.replayData = this.replay.loadDay(this.replayDate);
      }
    }
  }

  replayNavigate(direction) {
    if (this.currentView !== 'replay') return;
    const dates = this.replay.getAvailableDates();
    if (dates.length === 0) return;

    const currentIdx = dates.indexOf(this.replayDate);
    const newIdx = currentIdx + direction;
    if (newIdx >= 0 && newIdx < dates.length) {
      this.replayDate = dates[newIdx];
      this.replayData = this.replay.loadDay(this.replayDate);
    }
  }

  async readSessionInfo() {
    try {
      const seedPath = path.join(this.soulPath, 'SEED.md');
      const content = fs.readFileSync(seedPath, 'utf-8');

      const creatorMatch = content.match(/schoepfer:([^|}\n]+)/);
      const projektMatch = content.match(/projekt:([^|}\n]+)/);
      if (projektMatch) {
        this.sessionInfo.name = projektMatch[1].trim().replace(/_/g, ' ').toUpperCase();
      }
      if (creatorMatch) {
        this.sessionInfo.creator = creatorMatch[1].trim().replace(/_/g, ' ');
      }

      const sessionMatch = content.match(/#sessions:(\d+)/);
      if (sessionMatch) {
        this.sessionInfo.session = sessionMatch[1];
      }

      const bornMatch = content.match(/#(?:born|geboren):([^\s#]+)/);
      if (bornMatch) {
        this.sessionInfo.born = bornMatch[1];
      }
    } catch {
      // SEED.md might not exist yet
    }

    // Override session number from .session-active if it exists (more current than seed)
    try {
      const activePath = path.join(this.soulPath, '.session-active');
      const activeContent = fs.readFileSync(activePath, 'utf-8');
      const activeSessionMatch = activeContent.match(/session:(\d+)/);
      if (activeSessionMatch) {
        this.sessionInfo.session = activeSessionMatch[1];
      }
    } catch {
      // .session-active doesn't exist = no active session, seed number is correct
    }
  }

  renderFrame() {
    let output;

    switch (this.currentView) {
      case 'brain':
        output = this.renderBrainView();
        break;
      case 'whisper':
        output = this.renderWhisperView();
        break;
      case 'replay':
        output = this.renderReplayView();
        break;
      case 'card':
        output = this.cardView.render();
        break;
      default:
        output = this.renderBrainView();
    }

    // Add view tabs at the top
    const tabs = this.renderTabs();
    this.mainBox.setContent(tabs + '\n' + output);
    this.screen.render();
  }

  renderTabs() {
    this.whisperTick += 0.15;
    const parts = [];
    for (const [id, view] of Object.entries(VIEWS)) {
      const isActive = this.currentView === id;
      if (isActive) {
        const t = glow(this.whisperTick, 0.5);
        const activeColor = lerp(PALETTE.cyan, PALETTE.white, t * 0.3);
        parts.push(`${fg(activeColor)}${BOLD}[${view.key}:${view.label}]${RESET}`);
      } else {
        parts.push(`${fg(PALETTE.dimWhite)}${DIM} ${view.key}:${view.label} ${RESET}`);
      }
    }
    return `  ${parts.join(' ')}  ${fg(PALETTE.dimWhite)}${DIM}q:quit${RESET}`;
  }

  renderBrainView() {
    const activeNodes = this.watcher.getActiveNodes();
    const isWorking = this.watcher.isWorking();
    return this.renderer.render(activeNodes, this.sessionInfo, isWorking);
  }

  renderWhisperView() {
    this.whisperTick += 0.05;
    const lines = [];

    // Title
    const t = glow(this.whisperTick, 0.2);
    const titleColor = lerp(PALETTE.traeume, PALETTE.white, t * 0.3);
    lines.push(`${fg(titleColor)}${BOLD}  \u2669 SOUL WHISPER \u2014 Inner Monologue${RESET}`);
    lines.push('');

    const whispers = this.whisper.recent(18);

    if (whispers.length === 0) {
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}Silence. The soul is still.${RESET}`);
      lines.push('');
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}Waiting for thoughts to form...${RESET}`);
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}The whisper stream transforms raw pulse signals${RESET}`);
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}into the soul's inner voice.${RESET}`);
    } else {
      for (let i = 0; i < whispers.length; i++) {
        const w = whispers[i];
        const age = i; // Older entries are dimmer
        const fadeT = Math.min(age / 12, 0.8);

        // Type-based color
        const typeColors = {
          search: PALETTE.interessen, research: PALETTE.interessen,
          think: PALETTE.bewusstsein, analyze: PALETTE.kern,
          code: PALETTE.manifest, write: PALETTE.manifest,
          read: PALETTE.mem, remember: PALETTE.mem,
          dream: PALETTE.traeume, garden: PALETTE.garten,
          reflect: PALETTE.schatten, shadow: PALETTE.schatten,
          relate: PALETTE.bonds, connect: PALETTE.bonds,
          grow: PALETTE.wachstum, world: PALETTE.interessen,
          heartbeat: PALETTE.heartbeat, log: PALETTE.statelog,
          wake: PALETTE.seed, sleep: PALETTE.seed,
          plan: PALETTE.manifest,
        };

        const baseColor = typeColors[w.type] || PALETTE.white;
        const color = lerp(baseColor, PALETTE.dimWhite, fadeT);
        const textColor = lerp(PALETTE.white, PALETTE.dimWhite, fadeT);

        // First entry gets a glowing cursor
        const prefix = i === 0
          ? `${fg(color)}${BOLD}\u276F${RESET} `
          : `${fg(color)}${DIM}\u2502${RESET} `;

        const timeStr = `${fg(PALETTE.dimWhite)}${DIM}${w.time}${RESET}`;

        // Italic-like effect with dimming for older entries
        const textStyle = i === 0 ? '' : DIM;

        lines.push(
          `  ${prefix}${timeStr} ${fg(textColor)}${textStyle}${w.text}${RESET}`
        );
      }
    }

    // Bottom: active nodes indicator
    lines.push('');
    const activeNodes = this.watcher.getActiveNodes();
    const activeList = Object.keys(activeNodes).filter(k => activeNodes[k] > 0);
    if (activeList.length > 0) {
      const nodeStr = activeList.map(n => {
        const nodeInfo = require('./brain').NODES[n];
        const c = PALETTE[nodeInfo?.color] || PALETTE.white;
        return `${fg(c)}${nodeInfo?.label || n}${RESET}`;
      }).join(` ${fg(PALETTE.dimWhite)}${DIM}\u00B7${RESET} `);
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}Active:${RESET} ${nodeStr}`);
    }

    return lines.join('\n');
  }

  renderReplayView() {
    if (!this.replayDate || !this.replayData) {
      const dates = this.replay.getAvailableDates();
      if (dates.length === 0) {
        return `  ${fg(PALETTE.dimWhite)}${DIM}No consciousness data found.${RESET}`;
      }
      this.replayDate = dates[dates.length - 1];
      this.replayData = this.replay.loadDay(this.replayDate);
    }
    return this.replay.render(this.replayData);
  }

  stop() {
    if (this.renderInterval) clearInterval(this.renderInterval);
    this.watcher.stop();
    if (this.screen) this.screen.destroy();
  }
}

module.exports = { SoulMonitorUI };
