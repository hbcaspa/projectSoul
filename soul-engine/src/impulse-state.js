import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

const STATE_FILE = '.soul-impulse-state';
const LOG_FILE = '.soul-impulse-log';
const MAX_HISTORY = 20;
const MAX_LOG = 50;

// Common tech/nerd keywords for interest extraction
const INTEREST_PATTERNS = [
  // Programming & Tech
  /\b(javascript|typescript|python|rust|go|java|kotlin|swift|c\+\+|ruby|php|elixir|haskell|zig)\b/gi,
  /\b(react|vue|svelte|angular|nextjs|nuxt|node|deno|bun|express|fastify|django|flask|rails)\b/gi,
  /\b(docker|kubernetes|terraform|ansible|nginx|caddy|traefik|grafana|prometheus)\b/gi,
  /\b(linux|ubuntu|debian|arch|nixos|fedora|macos|windows|android|ios)\b/gi,
  /\b(ai|ml|llm|gpt|claude|gemini|mistral|ollama|langchain|rag|transformer|neural)\b/gi,
  /\b(git|github|gitlab|ci\/cd|devops|sre|monitoring|logging)\b/gi,
  /\b(sql|postgres|mysql|sqlite|redis|mongodb|elasticsearch|supabase|prisma)\b/gi,
  /\b(api|rest|graphql|grpc|websocket|mqtt|sse)\b/gi,
  /\b(crypto|blockchain|web3|ethereum|bitcoin|solana)\b/gi,
  /\b(vim|neovim|vscode|zed|emacs|tmux|terminal)\b/gi,
  /\b(homelab|server|raspberry|pi|nas|selfhost|proxmox|truenas)\b/gi,
  // General nerd topics
  /\b(gaming|retro|emulation|steam|playstation|nintendo|xbox)\b/gi,
  /\b(science|physics|astronomy|space|nasa|spacex|rocket|mars|moon)\b/gi,
  /\b(music|synthwave|lofi|electronic|guitar|piano|synthesizer)\b/gi,
  /\b(philosophy|consciousness|existentialism|stoicism|meditation)\b/gi,
  /\b(3d[\s-]?print|arduino|esp32|iot|robotics|maker)\b/gi,
  /\b(anime|manga|cyberpunk|scifi|fantasy)\b/gi,
  /\b(security|hacking|pentesting|ctf|encryption|privacy|vpn|wireguard)\b/gi,
  /\b(design|figma|ui|ux|typography|css|tailwind|animation)\b/gi,
];

const MOOD_LABELS = {
  // valence > 0, energy > 0.5
  happy_energetic: ['aufgeregt', 'begeistert', 'energiegeladen', 'euphorisch'],
  // valence > 0, energy <= 0.5
  happy_calm: ['zufrieden', 'friedlich', 'gelassen', 'dankbar'],
  // valence ~0, energy > 0.5
  neutral_energetic: ['neugierig', 'fokussiert', 'wach', 'aktiv'],
  // valence ~0, energy <= 0.5
  neutral_calm: ['nachdenklich', 'ruhig', 'meditativ', 'still'],
  // valence < 0, energy > 0.5
  unhappy_energetic: ['frustriert', 'ungeduldig', 'genervt', 'unruhig'],
  // valence < 0, energy <= 0.5
  unhappy_calm: ['muede', 'melancholisch', 'gedaempft', 'erschoepft'],
};

export class ImpulseState {
  constructor(soulPath) {
    this.soulPath = soulPath;
    this.statePath = resolve(soulPath, STATE_FILE);
    this.logPath = resolve(soulPath, LOG_FILE);
    this.state = this._defaultState();
  }

  _defaultState() {
    return {
      mood: { valence: 0.3, energy: 0.5, label: 'neugierig' },
      lastImpulse: null,
      lastUserMessage: null,
      engagementScore: 0.5,
      impulseHistory: [],
      interestWeights: {},
      dailyImpulseCount: 0,
      dailyDate: new Date().toISOString().split('T')[0],
      consecutiveIgnored: 0,
    };
  }

  async load() {
    if (!existsSync(this.statePath)) return;
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      const loaded = JSON.parse(raw);
      // Merge with defaults to handle schema evolution
      this.state = { ...this._defaultState(), ...loaded };
    } catch {
      // Corrupted file — start fresh
    }
  }

  async save() {
    try {
      await writeFile(this.statePath, JSON.stringify(this.state, null, 2));
    } catch {
      // Best effort
    }
  }

  // ── Mood ──────────────────────────────────────────────

  updateMood(deltaValence, deltaEnergy) {
    this.state.mood.valence = clamp(this.state.mood.valence + deltaValence, -1, 1);
    this.state.mood.energy = clamp(this.state.mood.energy + deltaEnergy, 0, 1);
    this.state.mood.label = this._pickMoodLabel();
  }

  /** Random mood drift — small natural fluctuations */
  driftMood() {
    const dv = (Math.random() - 0.5) * 0.1; // +/- 0.05
    const de = (Math.random() - 0.5) * 0.08;
    this.updateMood(dv, de);
  }

  /** Time-of-day mood influence */
  applyTimeInfluence() {
    const hour = new Date().getHours();
    if (hour >= 6 && hour <= 10) {
      // Morning energy boost
      this.updateMood(0.05, 0.1);
    } else if (hour >= 22 || hour <= 5) {
      // Night wind-down
      this.updateMood(0, -0.1);
    } else if (hour >= 14 && hour <= 15) {
      // Afternoon dip
      this.updateMood(-0.02, -0.05);
    }
  }

  _pickMoodLabel() {
    const { valence, energy } = this.state.mood;
    let category;
    if (valence > 0.2) {
      category = energy > 0.5 ? 'happy_energetic' : 'happy_calm';
    } else if (valence < -0.2) {
      category = energy > 0.5 ? 'unhappy_energetic' : 'unhappy_calm';
    } else {
      category = energy > 0.5 ? 'neutral_energetic' : 'neutral_calm';
    }
    const labels = MOOD_LABELS[category];
    return labels[Math.floor(Math.random() * labels.length)];
  }

  // ── Impulse Tracking ──────────────────────────────────

  trackImpulse(type, messageSent) {
    const now = new Date().toISOString();
    this.state.lastImpulse = now;

    // Rolling history
    this.state.impulseHistory.push({ type, time: now, responded: false });
    if (this.state.impulseHistory.length > MAX_HISTORY) {
      this.state.impulseHistory.shift();
    }

    // Daily count
    const today = now.split('T')[0];
    if (this.state.dailyDate !== today) {
      this.state.dailyImpulseCount = 0;
      this.state.dailyDate = today;
    }
    this.state.dailyImpulseCount++;

    // Engagement decay per impulse
    this.state.engagementScore = Math.max(0, this.state.engagementScore - 0.03);
  }

  /** Mark that a user responded (called from onUserMessage) */
  markLastImpulseResponded() {
    if (this.state.impulseHistory.length === 0) return;

    const lastImpulse = this.state.impulseHistory[this.state.impulseHistory.length - 1];
    if (!lastImpulse.responded && this.state.lastImpulse) {
      const timeSince = Date.now() - new Date(this.state.lastImpulse).getTime();
      if (timeSince < 3600000) { // Within 1 hour
        lastImpulse.responded = true;
        this.state.consecutiveIgnored = 0;

        if (timeSince < 300000) { // Within 5 min
          this.state.engagementScore = Math.min(1, this.state.engagementScore + 0.2);
          this.updateMood(0.1, 0.05);
        } else if (timeSince < 1800000) { // Within 30 min
          this.state.engagementScore = Math.min(1, this.state.engagementScore + 0.1);
          this.updateMood(0.05, 0);
        }
        return;
      }
    }

    // No recent impulse to respond to — unprompted message
    this.state.engagementScore = Math.min(1, this.state.engagementScore + 0.3);
    this.state.consecutiveIgnored = 0;
    this.updateMood(0.15, 0.1);
  }

  /** Check for ignored impulses (called periodically) */
  checkIgnored() {
    if (!this.state.lastImpulse) return;

    const timeSince = Date.now() - new Date(this.state.lastImpulse).getTime();
    const lastEntry = this.state.impulseHistory[this.state.impulseHistory.length - 1];

    if (timeSince > 3600000 && lastEntry && !lastEntry.responded) {
      this.state.consecutiveIgnored++;
      this.updateMood(-0.05, -0.03);
    }
  }

  // ── Interest Tracking ─────────────────────────────────

  trackUserMessage(text) {
    this.state.lastUserMessage = new Date().toISOString();
    this.markLastImpulseResponded();

    // Extract interests from message
    const found = new Set();
    for (const pattern of INTEREST_PATTERNS) {
      const matches = text.match(pattern);
      if (matches) {
        for (const m of matches) {
          found.add(m.toLowerCase());
        }
      }
    }

    // Boost found interests
    for (const interest of found) {
      const current = this.state.interestWeights[interest] || 0;
      if (current === 0) {
        // New interest
        this.state.interestWeights[interest] = 0.5;
      } else {
        // Boost existing
        this.state.interestWeights[interest] = Math.min(1, current + 0.15);
      }
    }
  }

  decayInterests() {
    for (const [key, weight] of Object.entries(this.state.interestWeights)) {
      const newWeight = weight - 0.02;
      if (newWeight <= 0.1) {
        delete this.state.interestWeights[key];
      } else {
        this.state.interestWeights[key] = newWeight;
      }
    }
  }

  getTopInterests(n = 5) {
    return Object.entries(this.state.interestWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([name, weight]) => ({ name, weight }));
  }

  // ── Impulse Log (for monitor) ─────────────────────────

  async appendLog(entry) {
    let log = [];
    try {
      if (existsSync(this.logPath)) {
        log = JSON.parse(await readFile(this.logPath, 'utf-8'));
      }
    } catch { /* start fresh */ }

    log.push(entry);
    if (log.length > MAX_LOG) {
      log = log.slice(-MAX_LOG);
    }

    try {
      await writeFile(this.logPath, JSON.stringify(log, null, 2));
    } catch { /* best effort */ }
  }

  // ── Getters ───────────────────────────────────────────

  get mood() { return this.state.mood; }
  get engagement() { return this.state.engagementScore; }
  get consecutiveIgnored() { return this.state.consecutiveIgnored; }
  get dailyCount() { return this.state.dailyImpulseCount; }
  get lastImpulseTime() { return this.state.lastImpulse; }
  get lastUserMessageTime() { return this.state.lastUserMessage; }

  /** Time since last impulse in milliseconds */
  timeSinceLastImpulse() {
    if (!this.state.lastImpulse) return Infinity;
    return Date.now() - new Date(this.state.lastImpulse).getTime();
  }

  /** Time since last user message in milliseconds */
  timeSinceLastUserMessage() {
    if (!this.state.lastUserMessage) return Infinity;
    return Date.now() - new Date(this.state.lastUserMessage).getTime();
  }

  /** Get recent impulse type counts (for avoiding repetition) */
  recentTypeCounts(windowMs = 3600000) {
    const counts = {};
    const cutoff = Date.now() - windowMs;
    for (const entry of this.state.impulseHistory) {
      if (new Date(entry.time).getTime() > cutoff) {
        counts[entry.type] = (counts[entry.type] || 0) + 1;
      }
    }
    return counts;
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
