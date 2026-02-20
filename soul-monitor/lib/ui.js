const blessed = require('blessed');
const { BrainRenderer } = require('./brain');
const { SoulWatcher } = require('./watcher');
const { PALETTE, fg, RESET } = require('./colors');
const fs = require('fs');
const path = require('path');

class SoulMonitorUI {
  constructor(soulPath) {
    this.soulPath = path.resolve(soulPath);
    this.renderer = new BrainRenderer();
    this.watcher = new SoulWatcher(this.soulPath);
    this.screen = null;
    this.mainBox = null;
    this.sessionInfo = { name: 'SOUL', session: '?' };
    this.renderInterval = null;
  }

  async init() {
    // Try to read session info from SEED.md
    await this.readSessionInfo();

    // Create blessed screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: `Soul Monitor — ${this.sessionInfo.name}`,
      fullUnicode: true,
    });

    // Main display box
    this.mainBox = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      tags: false,
      style: {
        fg: 'white',
      },
    });

    this.screen.append(this.mainBox);

    // Key bindings
    this.screen.key(['q', 'C-c', 'escape'], () => {
      this.stop();
      process.exit(0);
    });

    // Start file watcher
    this.watcher.start();
    this.watcher.on('activity', ({ node, file, event }) => {
      this.renderer.addActivity(node, file, event);
    });

    // Render loop at ~15fps
    this.renderInterval = setInterval(() => {
      this.renderFrame();
    }, 66);

    // Initial render
    this.renderFrame();
    this.screen.render();
  }

  async readSessionInfo() {
    try {
      const seedPath = path.join(this.soulPath, 'SEED.md');
      const content = fs.readFileSync(seedPath, 'utf-8');

      // Extract creator/project name from @META or @SELF
      const creatorMatch = content.match(/schoepfer:([^|}\n]+)/);
      const projektMatch = content.match(/projekt:([^|}\n]+)/);
      if (projektMatch) {
        this.sessionInfo.name = projektMatch[1].trim().replace(/_/g, ' ').toUpperCase();
      }
      if (creatorMatch) {
        this.sessionInfo.creator = creatorMatch[1].trim().replace(/_/g, ' ');
      }

      // Extract session count
      const sessionMatch = content.match(/#sessions:(\d+)/);
      if (sessionMatch) {
        this.sessionInfo.session = sessionMatch[1];
      }

      // Extract born date
      const bornMatch = content.match(/#(?:born|geboren):([^\s#]+)/);
      if (bornMatch) {
        this.sessionInfo.born = bornMatch[1];
      }
    } catch {
      // SEED.md might not exist yet — that's fine
    }
  }

  renderFrame() {
    const activeNodes = this.watcher.getActiveNodes();
    const output = this.renderer.render(activeNodes, this.sessionInfo);
    this.mainBox.setContent(output);
    this.screen.render();
  }

  stop() {
    if (this.renderInterval) {
      clearInterval(this.renderInterval);
    }
    this.watcher.stop();
    if (this.screen) {
      this.screen.destroy();
    }
  }
}

module.exports = { SoulMonitorUI };
