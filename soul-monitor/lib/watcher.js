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
  { pattern: /knowledge-graph\.jsonl$/,           node: 'graph' },
];

// Activity types → which brain nodes light up
// Each type activates ONLY the nodes that are genuinely involved
const ACTIVITY_MAP = {
  // Core cognitive activities
  research:  ['interessen', 'mem'],           // Searching the web → interests + memory
  code:      ['manifest', 'evolution'],        // Writing code → creation + growth
  think:     ['kern', 'bewusstsein'],          // Deep reasoning → core + consciousness
  remember:  ['mem', 'graph'],                  // Accessing memories → memory + graph
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
  search:    ['interessen', 'mem', 'graph'],     // Web search → interests + memory + graph
  analyze:   ['kern', 'schatten'],              // Analyzing something → core + shadow
  plan:      ['manifest', 'kern'],              // Planning → creation + core
  connect:   ['bonds', 'interessen'],           // Connecting to services → bonds + interests
  heartbeat: ['heartbeat', 'bewusstsein'],      // Heartbeat check → heartbeat + consciousness
  garden:    ['garten', 'traeume'],             // Tending ideas → garden + dreams
  shadow:    ['schatten'],                       // Shadow work → shadow only
  log:       ['statelog'],                       // State logging → statelog only
};

const PULSE_FILE = '.soul-pulse';
const MOOD_FILE = '.soul-mood';
const EVENTS_FILE = '.soul-events/current.jsonl';

// Decay timing
const BRIGHT_MS = 6000;   // Full brightness phase (6 seconds)
const AFTERGLOW_MS = 15000; // Slow fade phase (15 more seconds)
const TOTAL_DECAY_MS = BRIGHT_MS + AFTERGLOW_MS; // 21 seconds total visibility
const WORKING_TIMEOUT_MS = 20000; // "Working" state: any pulse within last 20s

class SoulWatcher extends EventEmitter {
  constructor(soulPath) {
    super();
    this.soulPath = path.resolve(soulPath);
    this.watcher = null;
    this.pulseWatcher = null;
    this.activeNodes = new Map(); // node -> timestamp of last activity
    this.lastAnyPulse = 0;        // Timestamp of most recent pulse (any type)
    this.currentMood = null;      // Current mood from .soul-mood
    this.moodWatcher = null;
    this.eventsWatcher = null;
    this._lastJsonlSize = 0;      // Track file size to detect new lines
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
        this.lastAnyPulse = Date.now();
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

    // Watch .soul-mood for mood changes
    const moodFilePath = path.join(this.soulPath, MOOD_FILE);
    this.moodWatcher = watch(moodFilePath, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    });
    this.moodWatcher
      .on('change', () => this.handleMoodChange(moodFilePath))
      .on('add', () => this.handleMoodChange(moodFilePath));

    // Watch .soul-events/current.jsonl for cross-process events
    const eventsFilePath = path.join(this.soulPath, EVENTS_FILE);
    this.eventsWatcher = watch(eventsFilePath, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    });
    this.eventsWatcher
      .on('change', () => this.handleEventsChange(eventsFilePath))
      .on('add', () => this.handleEventsChange(eventsFilePath));

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

      // Emit raw pulse for whisper integration
      this.emit('rawPulse', { type: activity, label });

      const now = Date.now();
      this.lastAnyPulse = now;
      for (const node of nodes) {
        this.activeNodes.set(node, now);
        this.emit('activity', { node, file: `.soul-pulse [${label}]`, event: 'pulse' });
      }
    } catch {
      // Ignore read errors
    }
  }

  handleMoodChange(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (!content) return;
      const mood = JSON.parse(content);
      this.currentMood = mood;
      this.emit('moodChange', mood);
    } catch {
      // Ignore parse errors
    }
  }

  handleEventsChange(filePath) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size <= this._lastJsonlSize) {
        this._lastJsonlSize = stat.size;
        return;
      }
      this._lastJsonlSize = stat.size;

      // Read last few lines for new events
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const lines = content.split('\n').filter(Boolean);
      const last = lines.slice(-3); // Process last 3 events max

      for (const line of last) {
        try {
          const event = JSON.parse(line);
          this.emit('busEvent', event);
        } catch { /* skip malformed lines */ }
      }
    } catch {
      // File may not exist yet
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

  /**
   * Returns activity level 0..1 for a node with two-phase decay:
   * - Phase 1 (0 to BRIGHT_MS): Full brightness → 1.0
   * - Phase 2 (BRIGHT_MS to TOTAL_DECAY_MS): Slow fade from 0.5 → 0.0 (afterglow)
   */
  getActivity(nodeId) {
    const lastActive = this.activeNodes.get(nodeId);
    if (!lastActive) return 0;
    const elapsed = Date.now() - lastActive;

    if (elapsed < BRIGHT_MS) {
      // Phase 1: full brightness
      return 1.0;
    } else if (elapsed < TOTAL_DECAY_MS) {
      // Phase 2: afterglow — fade from 0.5 to 0.0
      const afterglowElapsed = elapsed - BRIGHT_MS;
      const t = afterglowElapsed / AFTERGLOW_MS;
      return 0.5 * (1 - t);
    }
    return 0;
  }

  /**
   * Returns true if the soul is actively working (any pulse in last WORKING_TIMEOUT_MS)
   */
  isWorking() {
    return (Date.now() - this.lastAnyPulse) < WORKING_TIMEOUT_MS;
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
    if (this.moodWatcher) this.moodWatcher.close();
    if (this.eventsWatcher) this.eventsWatcher.close();
  }
}

module.exports = { SoulWatcher, ACTIVITY_MAP };
