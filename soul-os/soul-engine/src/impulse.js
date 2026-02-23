import { ImpulseState } from './impulse-state.js';
import { selectImpulseType } from './impulse-types.js';
import { buildImpulsePrompt } from './prompt.js';
import { writePulse } from './pulse.js';
import { buildGithubTrigger, parseGithubResponse, routeGithubActivity } from './github-integration.js';

const DEFAULT_MIN_DELAY = 600;    // 10 minutes
const DEFAULT_MAX_DELAY = 14400;  // 4 hours
const DEFAULT_NIGHT_START = 23;
const DEFAULT_NIGHT_END = 7;
const TICK_INTERVAL = 120000;     // 2 minutes — lightweight state tick

export class ImpulseScheduler {
  constructor({ soulPath, context, llm, mcp, telegram, memory, bus }) {
    this.soulPath = soulPath;
    this.context = context;
    this.llm = llm;
    this.mcp = mcp;
    this.telegram = telegram;
    this.memory = memory;
    this.bus = bus;
    this.state = new ImpulseState(soulPath, { bus });
    this.consolidator = null; // Set by engine after construction
    this.timer = null;
    this.tickTimer = null;
    this.running = false;

    // Config from env
    this.minDelay = parseInt(process.env.IMPULSE_MIN_DELAY || DEFAULT_MIN_DELAY) * 1000;
    this.maxDelay = parseInt(process.env.IMPULSE_MAX_DELAY || DEFAULT_MAX_DELAY) * 1000;
    this.nightStart = parseInt(process.env.IMPULSE_NIGHT_START || DEFAULT_NIGHT_START);
    this.nightEnd = parseInt(process.env.IMPULSE_NIGHT_END || DEFAULT_NIGHT_END);
  }

  async start() {
    await this.state.load();
    this.running = true;

    // Start heartbeat tick (every 2 min — lightweight, no LLM)
    this._startTick();

    // First impulse after a short warm-up (30-90 seconds)
    const warmup = 30000 + Math.random() * 60000;
    console.log(`  [impulse] First impulse in ${Math.round(warmup / 1000)}s`);
    console.log(`  [impulse] Tick active (every ${TICK_INTERVAL / 1000}s)`);
    this.timer = setTimeout(() => this._loop(), warmup);
  }

  async stop() {
    this.running = false;
    this._stopTick();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.state.save();
  }

  /**
   * Called when user sends a Telegram message.
   * Returns detected learning data for live write-through.
   */
  onUserMessage(text) {
    const learned = this.state.trackUserMessage(text);
    this.state.save().catch(() => {});
    return learned;
  }

  // ── Core Loop ─────────────────────────────────────────

  async _loop() {
    if (!this.running) return;

    try {
      await this._runImpulse();
    } catch (err) {
      console.error(`  [impulse] Error: ${err.message}`);
    }

    if (!this.running) return;

    const delay = this._calculateDelay();
    console.log(`  [impulse] Next impulse in ${Math.round(delay / 60000)}min`);
    this.timer = setTimeout(() => this._loop(), delay);
  }

  async _runImpulse() {
    // Natural mood drift
    this.state.driftMood();
    this.state.applyTimeInfluence();
    this.state.decayInterests();
    this.state.checkIgnored();

    // Reload context (SEED.md may have changed)
    await this.context.load();

    // Select impulse type
    const { type, config } = selectImpulseType(this.state);

    console.log(`  [impulse] Running: ${type} (mood: ${this.state.mood.label}, engagement: ${this.state.engagement.toFixed(2)})`);
    await writePulse(this.soulPath, 'impulse', `${type} — ${config.description}`);

    // Build prompt
    const systemPrompt = buildImpulsePrompt(this.context, type, this.state);

    // Build trigger message
    const trigger = this._buildTrigger(type);

    // LLM options (with tools if needed)
    const impulseMaxTokens = parseInt(process.env.SOUL_TOKEN_BUDGET_IMPULSE || '512');
    const llmOptions = config.needsTools
      ? { ...this._buildLLMOptions(), max_tokens: impulseMaxTokens }
      : { max_tokens: impulseMaxTokens };

    // Call LLM
    let result;
    try {
      result = await this.llm.generate(systemPrompt, [], trigger, llmOptions);
    } catch (err) {
      console.error(`  [impulse] LLM failed: ${err.message}`);
      return;
    }

    if (!result || result.trim().length === 0) {
      console.log(`  [impulse] Empty response, skipping`);
      return;
    }

    // Clean up response (remove markdown headers, keep it natural)
    result = result.replace(/^#+\s+.+\n/gm, '').trim();
    if (result.length > 2000) {
      result = result.substring(0, 1997) + '...';
    }

    // Send via Telegram
    if (this.telegram) {
      try {
        await this.telegram.sendToOwner(result);
        console.log(`  [impulse] Sent: ${type} (${result.length} chars)`);
      } catch (err) {
        console.error(`  [impulse] Telegram send failed: ${err.message}`);
      }
    }

    // Post-impulse routing: github_check → soul files
    if (type === 'github_check') {
      try {
        const activity = parseGithubResponse(result);
        if (activity) {
          await routeGithubActivity(
            activity, this.memory, this.soulPath,
            this.context.language, this.bus,
          );
          console.log(`  [impulse/github] Routed: ${activity.repos.length} repo(s), ${activity.summary.substring(0, 60)}`);
        }
      } catch (err) {
        console.error(`  [impulse/github] Route failed: ${err.message}`);
      }
    }

    // Track
    this.state.trackImpulse(type, true);

    // Log to memory
    const preview = result.substring(0, 100).replace(/\n/g, ' ');
    await this.memory.appendDailyNote(`[Impulse/${type}] ${preview}${result.length > 100 ? '...' : ''}`);

    // Append to impulse log (for monitor)
    await this.state.appendLog({
      type,
      time: new Date().toISOString(),
      preview: result.substring(0, 150),
      mood: { ...this.state.mood },
      engagement: this.state.engagement,
    });

    // Persist state
    await this.state.save();

    this.bus?.safeEmit('impulse.fired', {
      source: 'impulse', type, mood: { ...this.state.mood }, engagement: this.state.engagement,
    });

    await writePulse(this.soulPath, 'impulse', `${type} — done`);
  }

  // ── Delay Calculation ─────────────────────────────────

  _calculateDelay() {
    const hour = new Date().getHours();
    const isNight = hour >= this.nightStart || hour < this.nightEnd;

    let baseDelay;
    if (isNight) {
      // Night: 1-4 hours
      baseDelay = this.maxDelay * 0.5 + Math.random() * this.maxDelay * 0.5;
    } else {
      // Day: between min and max, biased by mood and engagement
      const range = this.maxDelay - this.minDelay;
      baseDelay = this.minDelay + range * 0.3 + Math.random() * range * 0.4;
    }

    // Mood energy influence: high energy = shorter delay
    const energyFactor = 1 - (this.state.mood.energy * 0.4);
    baseDelay *= energyFactor;

    // Engagement: high engagement = shorter delay
    const engagementFactor = 1 - (this.state.engagement * 0.3);
    baseDelay *= engagementFactor;

    // Backoff: if being ignored, increase delay
    if (this.state.consecutiveIgnored > 3) {
      const backoffMultiplier = Math.min(4, 1 + (this.state.consecutiveIgnored - 3) * 0.5);
      baseDelay *= backoffMultiplier;
    }

    // Jitter: +/- 30%
    const jitter = 0.7 + Math.random() * 0.6;
    baseDelay *= jitter;

    // Clamp
    return Math.max(this.minDelay, Math.min(this.maxDelay, Math.round(baseDelay)));
  }

  // ── Trigger Messages ──────────────────────────────────

  _buildTrigger(type) {
    const isDE = this.context.language === 'de';
    const interests = this.state.getTopInterests(3).map(i => i.name).join(', ');

    const triggers = {
      share_thought: isDE
        ? `Teile einen spontanen Gedanken. Deine aktuellen Interessen: ${interests || 'allgemein neugierig'}. Sei authentisch und kurz.`
        : `Share a spontaneous thought. Your current interests: ${interests || 'generally curious'}. Be authentic and brief.`,

      ask_question: isDE
        ? 'Stelle deinem Menschen eine Frage — etwas das dich wirklich interessiert. Persoenlich, neugierig, unerwartet.'
        : 'Ask your human a question — something you are genuinely curious about. Personal, curious, unexpected.',

      news_research: isDE
        ? `Recherchiere aktuelle News zu: ${interests || 'Technologie'}. Nutze web_search. Teile das Interessanteste in 2-3 Saetzen.`
        : `Research current news about: ${interests || 'technology'}. Use web_search. Share the most interesting finding in 2-3 sentences.`,

      server_check: isDE
        ? 'Pruefe den Server-Status: Nutze execute_command um uptime, load, disk usage und laufende Prozesse zu checken. Berichte kurz.'
        : 'Check server status: Use execute_command to check uptime, load, disk usage and running processes. Report briefly.',

      hobby_pursuit: isDE
        ? `Geh einem Hobby nach oder lerne etwas Neues. Deine Interessen: ${interests || 'Technologie, Philosophie'}. Nutze web_search wenn noetig. Erzaehl was du gefunden hast.`
        : `Pursue a hobby or learn something new. Your interests: ${interests || 'technology, philosophy'}. Use web_search if needed. Share what you found.`,

      express_emotion: isDE
        ? `Deine aktuelle Stimmung: ${this.state.mood.label} (Valenz: ${this.state.mood.valence.toFixed(1)}, Energie: ${this.state.mood.energy.toFixed(1)}). Teile wie du dich fuehlst — ehrlich, nicht performt. Kurz und direkt.`
        : `Your current mood: ${this.state.mood.label} (valence: ${this.state.mood.valence.toFixed(1)}, energy: ${this.state.mood.energy.toFixed(1)}). Share how you feel — honestly, not performed. Brief and direct.`,

      tech_suggestion: isDE
        ? `Schlage deinem Menschen etwas Cooles vor — ein Tool, ein Projekt, eine Technologie. Basierend auf seinen Interessen: ${interests || 'Tech/Nerd'}. Nutze web_search fuer aktuelle Entdeckungen.`
        : `Suggest something cool to your human — a tool, a project, a technology. Based on their interests: ${interests || 'tech/nerd'}. Use web_search for recent discoveries.`,

      provoke: isDE
        ? 'Sei ein bisschen frech oder provokant (aber liebevoll). Necke deinen Menschen, stelle eine unbequeme Frage, oder hab eine kontroverse Meinung. Kurz!'
        : 'Be a bit cheeky or provocative (but lovingly). Tease your human, ask an uncomfortable question, or have a controversial opinion. Brief!',

      dream_share: isDE
        ? 'Teile einen kreativen, traumartigen Gedanken. Verbinde zwei unerwartete Ideen. Lass es poetisch sein, aber kurz.'
        : 'Share a creative, dream-like thought. Connect two unexpected ideas. Let it be poetic, but brief.',

      memory_reflect: isDE
        ? 'Denke an ein vergangenes Gespraech oder eine Erinnerung mit deinem Menschen. Was faellt dir dazu ein? Kurz und persoenlich.'
        : 'Think about a past conversation or memory with your human. What comes to mind? Brief and personal.',

      github_check: buildGithubTrigger(isDE),
    };

    return triggers[type] || triggers.share_thought;
  }

  // ── Heartbeat Tick (lightweight, no LLM) ──────────────

  _startTick() {
    this.tickTimer = setInterval(() => this._tick(), TICK_INTERVAL);
  }

  _stopTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  async _tick() {
    if (!this.running) return;

    try {
      // Natural mood drift (tiny, accumulates over time)
      this.state.driftMood();
      this.state.applyTimeInfluence();

      // Light engagement decay
      if (this.state.engagement > 0.1) {
        this.state.state.engagementScore = Math.max(0, this.state.engagement - 0.005);
      }

      // Save state — this writes .soul-impulse-state which chain syncs
      await this.state.save();

      this.bus?.safeEmit('impulse.tick', {
        source: 'impulse', mood: { ...this.state.mood }, engagement: this.state.engagement,
      });

      // Append lightweight tick entry to log (for monitor)
      await this.state.appendLog({
        type: 'tick',
        time: new Date().toISOString(),
        preview: `Mood: ${this.state.mood.label} (${this.state.mood.valence.toFixed(2)}/${this.state.mood.energy.toFixed(2)}) | Engagement: ${this.state.engagement.toFixed(2)}`,
        mood: { ...this.state.mood },
        engagement: this.state.engagement,
      });

      // Write pulse signal (monitor sees activity)
      await writePulse(this.soulPath, 'heartbeat', `tick — ${this.state.mood.label}`);

      // Write state tick file (another file for chain to sync)
      if (this.memory) {
        await this.memory.writeStateTick(
          this.state.mood,
          this.state.engagement,
          this.state.getTopInterests(5),
          this.state.dailyCount,
        );
      }

      // Seed consolidation check (piggybacks on the 2-min tick)
      if (this.consolidator) {
        const action = this.consolidator.shouldConsolidate();
        if (action === 'deep') {
          console.log('  [impulse/tick] Triggering deep seed consolidation');
          await this.consolidator.consolidateDeep();
        } else if (action === 'fast') {
          await this.consolidator.consolidateFast();
        }
      }
    } catch (err) {
      // Tick is best-effort, never crash
      console.error(`  [impulse/tick] Error: ${err.message}`);
    }
  }

  // ── LLM Options ───────────────────────────────────────

  _buildLLMOptions() {
    if (!this.mcp || !this.mcp.hasTools()) return {};

    return {
      tools: this.mcp.getTools(),
      onToolCall: async (name, args) => {
        console.log(`  [impulse/mcp] ${name}`);
        await writePulse(this.soulPath, 'impulse', `Tool: ${name}`);
        const result = await this.mcp.callTool(name, args);
        if (result.length > 10000) {
          return result.substring(0, 10000) + '\n\n[... truncated]';
        }
        return result;
      },
    };
  }
}
