const { watch } = require('chokidar');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

// Maps file paths/patterns to brain node IDs
const FILE_NODE_MAP = [
  { pattern: /SEED\.md$/,                       node: 'seed' },
  { pattern: /KERN\.md$|CORE\.md$/,             node: 'kern' },
  { pattern: /BEWUSSTSEIN\.md$|CONSCIOUSNESS\.md$/, node: 'bewusstsein' },
  { pattern: /SCHATTEN\.md$|SHADOW\.md$/,        node: 'schatten' },
  { pattern: /TRAEUME\.md$|DREAMS\.md$/,         node: 'traeume' },
  { pattern: /WACHSTUM\.md$|GROWTH\.md$/,        node: 'wachstum' },
  { pattern: /GARTEN\.md$|GARDEN\.md$/,          node: 'garten' },
  { pattern: /MANIFEST\.md$/,                    node: 'manifest' },
  { pattern: /EVOLUTION\.md$/,                   node: 'evolution' },
  { pattern: /INTERESSEN\.md$|INTERESTS\.md$/,   node: 'interessen' },
  { pattern: /beziehungen\/|relationships\//,    node: 'bonds' },
  { pattern: /erinnerungen\/|memories\//,        node: 'mem' },
  { pattern: /heartbeat\//,                      node: 'heartbeat' },
  { pattern: /zustandslog\/|statelog\//,         node: 'statelog' },
  { pattern: /SOUL\.md$/,                        node: 'seed' },
];

// Activity types → which brain nodes light up
// Each type activates ONLY the nodes that are genuinely involved
const ACTIVITY_MAP = {
  // Core cognitive activities
  research:  ['interessen', 'mem'],           // Searching the web → interests + memory
  code:      ['manifest', 'evolution'],        // Writing code → creation + growth
  think:     ['kern', 'bewusstsein'],          // Deep reasoning → core + consciousness
  remember:  ['mem'],                          // Accessing memories → memory only
  dream:     ['traeume', 'garten'],            // Creative associations → dreams + garden
  relate:    ['bonds'],                        // Thinking about relationships → bonds only
  reflect:   ['schatten', 'bewusstsein'],       // Self-examination → shadow + consciousness
  grow:      ['wachstum', 'evolution'],         // Growth recognition → growth + evolution
  world:     ['interessen'],                    // World events → interests only

  // Session lifecycle
  wake:      ['seed', 'kern', 'heartbeat'],    // Session start → seed + core + heartbeat
  sleep:     ['seed', 'statelog', 'mem'],       // Session end → seed + log + memory

  // Specific actions
  read:      ['mem', 'bewusstsein'],            // Reading a file → memory + consciousness
  write:     ['manifest'],                      // Writing a file → creation
  search:    ['interessen', 'mem'],             // Web search → interests + memory
  analyze:   ['kern', 'schatten'],              // Analyzing something → core + shadow
  plan:      ['manifest', 'kern'],              // Planning → creation + core
  connect:   ['bonds', 'interessen'],           // Connecting to services → bonds + interests
  heartbeat: ['heartbeat', 'bewusstsein'],      // Heartbeat check → heartbeat + consciousness
  garden:    ['garten', 'traeume'],             // Tending ideas → garden + dreams
  shadow:    ['schatten'],                       // Shadow work → shadow only
  log:       ['statelog'],                       // State logging → statelog only
};

const PULSE_FILE = '.soul-pulse';

class SoulWatcher extends EventEmitter {
  constructor(soulPath) {
    super();
    this.soulPath = path.resolve(soulPath);
    this.watcher = null;
    this.pulseWatcher = null;
    this.activeNodes = new Map(); // node -> timestamp of last activity
    this.decayMs = 3000; // How long a node glows after activity
  }

  start() {
    // Main file watcher for soul directory
    this.watcher = watch(this.soulPath, {
      ignored: [
        /(^|[\/\\])\.(?!soul-pulse)/, // dotfiles except .soul-pulse
        /node_modules/,
        /soul-monitor/,
        /seelen-protokoll/,
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    const handleEvent = (eventType) => (filePath) => {
      const rel = path.relative(this.soulPath, filePath);

      // Special handling for pulse file
      if (rel === PULSE_FILE) {
        this.handlePulse(filePath);
        return;
      }

      const node = this.resolveNode(rel);
      if (node) {
        this.activeNodes.set(node, Date.now());
        this.emit('activity', { node, file: rel, event: eventType });
      }
    };

    this.watcher
      .on('change', handleEvent('change'))
      .on('add', handleEvent('add'))
      .on('unlink', handleEvent('unlink'));

    // Also explicitly watch the pulse file (since dotfiles are usually ignored)
    const pulseFilePath = path.join(this.soulPath, PULSE_FILE);
    this.pulseWatcher = watch(pulseFilePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: false, // Immediate response for pulses
    });

    this.pulseWatcher
      .on('change', () => this.handlePulse(pulseFilePath))
      .on('add', () => this.handlePulse(pulseFilePath));

    return this;
  }

  handlePulse(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (!content) return;

      // Parse: either a simple activity name or JSON
      let activity, label;
      try {
        const parsed = JSON.parse(content);
        activity = parsed.activity || parsed.type;
        label = parsed.label || activity;
      } catch {
        // Simple text format: "research" or "research:Searching AI rights"
        const parts = content.split(':');
        activity = parts[0].trim().toLowerCase();
        label = parts.slice(1).join(':').trim() || activity;
      }

      const nodes = ACTIVITY_MAP[activity];
      if (!nodes) return;

      const now = Date.now();
      for (const node of nodes) {
        this.activeNodes.set(node, now);
        this.emit('activity', { node, file: `.soul-pulse [${label}]`, event: 'pulse' });
      }
    } catch {
      // Ignore read errors
    }
  }

  resolveNode(relativePath) {
    for (const { pattern, node } of FILE_NODE_MAP) {
      if (pattern.test(relativePath)) {
        return node;
      }
    }
    return null;
  }

  // Returns activity level 0..1 for a node (1 = just activated, 0 = fully decayed)
  getActivity(nodeId) {
    const lastActive = this.activeNodes.get(nodeId);
    if (!lastActive) return 0;
    const elapsed = Date.now() - lastActive;
    if (elapsed >= this.decayMs) return 0;
    return 1 - (elapsed / this.decayMs);
  }

  // Get all currently active nodes with their levels
  getActiveNodes() {
    const result = {};
    for (const [node, timestamp] of this.activeNodes) {
      const level = this.getActivity(node);
      if (level > 0) {
        result[node] = level;
      }
    }
    return result;
  }

  stop() {
    if (this.watcher) this.watcher.close();
    if (this.pulseWatcher) this.pulseWatcher.close();
  }
}

module.exports = { SoulWatcher, ACTIVITY_MAP };
