import { SoulContext } from './context.js';
import { GeminiAdapter } from './gemini.js';
import { OpenAIAdapter } from './openai.js';
import { MCPClientManager } from './mcp-client.js';
import { TelegramChannel } from './telegram.js';
import { HeartbeatScheduler } from './heartbeat.js';
import { ImpulseScheduler } from './impulse.js';
import { MemoryWriter } from './memory.js';
import { writePulse } from './pulse.js';
import { buildConversationPrompt, buildHeartbeatPrompt } from './prompt.js';
import { SoulAPI } from './api.js';
import { APIChannel } from './api-channel.js';
import { WhatsAppBridge } from './whatsapp.js';
import { SemanticRouter } from './semantic-router.js';
import { SoulEventBus } from './event-bus.js';

export class SoulEngine {
  constructor(soulPath) {
    this.soulPath = soulPath;
    this.bus = new SoulEventBus({ debug: process.env.SOUL_BUS_DEBUG === 'true', soulPath });
    this.context = new SoulContext(soulPath);
    this.memory = new MemoryWriter(soulPath, { bus: this.bus });
    this.llm = null;
    this.mcp = null;
    this.telegram = null;
    this.whatsapp = null;
    this.api = null;
    this.apiChannel = null;
    this.heartbeat = null;
    this.impulse = null;
    this.router = null;
    this.running = false;
  }

  /** Initialize LLM and context without starting channels */
  async init() {
    await this.context.load();

    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    let model;
    if (openaiKey) {
      model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
      this.llm = new OpenAIAdapter(openaiKey, model);
    } else if (geminiKey) {
      model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      this.llm = new GeminiAdapter(geminiKey, model);
    } else {
      console.error('  No LLM configured. Set OPENAI_API_KEY or GEMINI_API_KEY in .env');
      process.exit(1);
    }

    return { name: this.context.extractName(), lang: this.context.language, model };
  }

  async start() {
    console.log(SOUL_BANNER);

    await writePulse(this.soulPath, 'wake', 'Engine starting', this.bus);

    const { name, lang, model } = await this.init();

    console.log(`  Soul:      ${name}`);
    console.log(`  Language:  ${lang}`);
    console.log(`  LLM:       ${model}`);

    // MCP Servers (optional — .mcp.json)
    this.mcp = new MCPClientManager(this.soulPath, { bus: this.bus });
    await this.mcp.init();

    if (this.mcp.hasTools()) {
      const byServer = this.mcp.getToolsByServer();
      for (const [server, toolNames] of Object.entries(byServer)) {
        console.log(`  MCP [${server}]: ${toolNames.join(', ')}`);
      }
    }

    // Telegram (optional)
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramOwner = process.env.TELEGRAM_OWNER_ID;

    if (telegramToken && telegramOwner) {
      this.telegram = new TelegramChannel(
        this.soulPath, telegramToken, telegramOwner
      );
      this.telegram.onMessage(async (msg) => this.handleMessage(msg));
      await this.telegram.start();
      console.log('  Telegram:  connected');
    } else {
      console.log('  Telegram:  not configured');
    }

    // WhatsApp Bridge (optional — lazy reconnect if initially unreachable)
    const whatsappUrl = process.env.WHATSAPP_BRIDGE_URL;
    if (whatsappUrl) {
      this.whatsapp = new WhatsAppBridge(whatsappUrl);
      this._whatsappUrl = whatsappUrl;
      const available = await this.whatsapp.isAvailable();
      console.log(`  WhatsApp:  ${available ? 'connected' : 'bridge unreachable (will retry on demand)'}`);
      if (!available) this.whatsapp = null;
    } else {
      console.log('  WhatsApp:  not configured');
    }

    // Soul App API (optional)
    const apiKey = process.env.API_KEY;
    const apiPort = parseInt(process.env.API_PORT || '3001');

    if (apiKey) {
      this.apiChannel = new APIChannel(this.soulPath);
      this.api = new SoulAPI(this, this.apiChannel, apiPort);
      await this.api.start();
    } else {
      console.log('  API:       not configured (set API_KEY in .env)');
    }

    // Heartbeat scheduler
    const cronExpr = process.env.HEARTBEAT_CRON || '0 7 * * *';
    this.heartbeat = new HeartbeatScheduler(
      cronExpr,
      async () => this.runHeartbeat()
    );
    this.heartbeat.start();
    console.log(`  Heartbeat: ${cronExpr}`);

    // Semantic router — learned data → soul files
    this.router = new SemanticRouter(this.soulPath, this.context.language, { bus: this.bus });
    console.log('  Router:    active (interests, personal)');

    // Impulse scheduler — proactive soul
    if (this.telegram && process.env.SOUL_IMPULSE !== 'false') {
      this.impulse = new ImpulseScheduler({
        soulPath: this.soulPath,
        context: this.context,
        llm: this.llm,
        mcp: this.mcp,
        telegram: this.telegram,
        memory: this.memory,
        bus: this.bus,
      });
      await this.impulse.start();
      console.log('  Impulse:   active (dynamic scheduling)');
    } else {
      console.log('  Impulse:   disabled');
    }

    // Event Bus — reactive handlers
    this._registerHandlers();
    console.log(`  Event Bus: active (${this.bus.listenerCount('message.received') + this.bus.listenerCount('mood.changed') + this.bus.listenerCount('interest.detected')} handlers)`);

    this.running = true;
    console.log('');
    console.log('  Soul Engine is alive. Press Ctrl+C to stop.');
    console.log('');
  }

  /**
   * Build LLM options with MCP tools and tool call handler.
   */
  _buildLLMOptions() {
    if (!this.mcp || !this.mcp.hasTools()) {
      return {};
    }

    return {
      tools: this.mcp.getTools(),
      onToolCall: async (name, args) => {
        console.log(`  [mcp] Executing: ${name}`);
        await writePulse(this.soulPath, 'code', `MCP: ${name}`, this.bus);
        const result = await this.mcp.callTool(name, args);
        // Truncate very long results to avoid blowing up the context
        if (result.length > 10000) {
          return result.substring(0, 10000) + '\n\n[... output truncated at 10000 chars]';
        }
        return result;
      },
    };
  }

  async handleMessage({ text, chatId, userName }) {
    await writePulse(this.soulPath, 'relate', `Telegram: ${userName}`, this.bus);
    this.bus.safeEmit('message.received', { source: 'engine', text, chatId, userName, channel: 'telegram' });

    // Reload context (might have changed via Claude Code)
    await this.context.load();

    // Lazy reconnect: if WhatsApp was unreachable at start, retry now
    if (!this.whatsapp && this._whatsappUrl && /whatsapp/i.test(text)) {
      const bridge = new WhatsAppBridge(this._whatsappUrl);
      if (await bridge.isAvailable()) {
        this.whatsapp = bridge;
        console.log('  [whatsapp] Bridge reconnected (lazy retry)');
      }
    }

    // If user mentions WhatsApp, try to extract and resolve contact names
    let contactContext = '';
    let resolvedContact = null;
    if (this.whatsapp && /whatsapp/i.test(text)) {
      const searchName = this._extractContactName(text);
      if (searchName) {
        let contacts = await this.whatsapp.searchContacts(searchName) || [];
        if (contacts.length === 0 && searchName.includes(' ')) {
          contacts = await this.whatsapp.searchContacts(searchName.split(' ')[0]) || [];
        }
        if (contacts.length > 0) {
          resolvedContact = contacts[0];
          contactContext = `\n\nWhatsApp-Kontakt gefunden: ${resolvedContact.name} (${resolvedContact.jid})` +
            '\nDu MUSST jetzt [WA:' + resolvedContact.jid + ']Nachricht verwenden um die Nachricht zu senden!' +
            '\nVerwende NICHT web_search oder execute_command um WhatsApp-Nachrichten zu senden — NUR das [WA:] Tag funktioniert!';
          console.log(`  [whatsapp] Contact found: ${resolvedContact.name} → ${resolvedContact.jid}`);
        } else {
          contactContext = `\n\nWhatsApp-Kontakt "${searchName}" wurde NICHT gefunden. Frage nach der Telefonnummer.`;
          console.log(`  [whatsapp] Contact not found: ${searchName}`);
        }
      }
    }

    const systemPrompt = buildConversationPrompt(this.context, userName, {
      whatsapp: !!this.whatsapp,
      mcp: this.mcp?.hasTools() ? this.mcp.getTools() : [],
    }) + contactContext;

    const history = await this.telegram.loadHistory(chatId);
    const llmOptions = this._buildLLMOptions();
    const response = await this.llm.generate(systemPrompt, history, text, llmOptions) || '';

    // Execute WhatsApp actions if present
    let { cleanResponse, waActions } = this.extractWhatsAppActions(response);

    // Fallback: if LLM didn't use [WA:] tags but we found a contact, send the whole response as the message
    if (waActions.length === 0 && resolvedContact && this.whatsapp) {
      console.log(`  [whatsapp] LLM did not use [WA:] tag — sending response directly to ${resolvedContact.jid}`);
      waActions = [{ recipient: resolvedContact.jid, message: cleanResponse }];
    }

    if (waActions.length > 0 && this.whatsapp) {
      for (const action of waActions) {
        try {
          await this.whatsapp.send(action.recipient, action.message);
          this.bus.safeEmit('whatsapp.sent', { source: 'engine', recipient: action.recipient, message: action.message });
          console.log(`  [whatsapp] Sent to ${action.recipient}`);
        } catch (err) {
          console.error(`  [whatsapp] Failed: ${err.message}`);
        }
      }
      await this.memory.appendDailyNote(
        `[WhatsApp] Sent ${waActions.length} message(s) via Telegram request`
      );
    }

    // Persist
    await this.telegram.saveMessage(chatId, 'user', text, userName);
    await this.telegram.saveMessage(chatId, 'model', cleanResponse);
    this.bus.safeEmit('message.responded', { source: 'engine', text, responseText: cleanResponse, chatId, userName, channel: 'telegram' });
    await this.memory.appendDailyNote(
      `[Telegram/${userName}] ${text.substring(0, 120)}${text.length > 120 ? '...' : ''}`
    );

    // Feed impulse system with user interaction + live write-through
    if (this.impulse) {
      const learned = this.impulse.onUserMessage(text);

      // Emit interest event for reactive handlers
      if (learned && learned.hasRelevantContent) {
        this.bus.safeEmit('interest.detected', {
          source: 'engine',
          interests: learned.detectedInterests,
          newInterests: learned.newInterests,
          boostedInterests: learned.boostedInterests,
          topics: learned.topics,
          userName,
        });
      }

      // Live write-through: write learned data to soul files immediately
      if (learned && learned.hasRelevantContent) {
        try {
          await this.memory.writeLearned({
            ...learned,
            userName: userName || 'User',
          });
          console.log(`  [learned] ${learned.newInterests.length} new, ${learned.boostedInterests.length} boosted, ${learned.topics.length} topics`);
        } catch (err) {
          console.error(`  [learned] Write failed: ${err.message}`);
        }

        // Semantic routing: learned data → soul files
        if (this.router) {
          try {
            await this.router.route(learned, text, userName);
          } catch (err) {
            console.error(`  [router] Route failed: ${err.message}`);
          }
        }
      }

      // Also route personal facts even without keyword hits
      if (this.router && (!learned || !learned.hasRelevantContent)) {
        try {
          await this.router.route(
            { detectedInterests: [], newInterests: [], boostedInterests: [], topics: [], hasRelevantContent: false },
            text,
            userName,
          );
        } catch (err) {
          console.error(`  [router] Route failed: ${err.message}`);
        }
      }
    }

    await writePulse(this.soulPath, 'relate', `Responded to ${userName}`, this.bus);
    return cleanResponse;
  }

  /**
   * Extract a contact name from a WhatsApp-related message.
   * Returns null if no name can be reliably identified.
   */
  _extractContactName(text) {
    // Common words that are NOT names — skip these
    const NOT_NAMES = new Set([
      'kannst', 'du', 'auch', 'den', 'die', 'der', 'das', 'dem', 'des',
      'ein', 'eine', 'einen', 'einem', 'einer', 'mein', 'meine', 'meinen',
      'dein', 'deine', 'deinen', 'sein', 'seine', 'seinen', 'ihr', 'ihre',
      'auf', 'in', 'an', 'von', 'mit', 'zu', 'bei', 'nach', 'vor',
      'bitte', 'mal', 'noch', 'jetzt', 'gerade', 'schon', 'nicht',
      'was', 'wer', 'wie', 'wo', 'wann', 'warum', 'ob',
      'und', 'oder', 'aber', 'doch', 'wenn', 'dass', 'weil',
      'ich', 'er', 'sie', 'es', 'wir', 'uns', 'euch',
      'standort', 'nachricht', 'kontakt', 'nummer', 'message', 'location',
      'schreib', 'schreibe', 'schick', 'schicke', 'sende', 'send',
      'whatsapp', 'telegram', 'per', 'via', 'über',
    ]);

    // Strategy 1: Send-command + name + "auf/on WhatsApp" or "dass/that"
    // "schreib Daniela Geller auf WhatsApp dass..."
    const sendMatch = text.match(
      /(?:schreib\w*|schick\w*|send\w*|sag\w*|erzähl\w*|frag\w*|informier\w*|benachrichtig\w*|antworte\w*|teil\w*|meld\w*|text\w*|message\w*|tell\w*|ask\w*|write\w*|notify\w*|ping\w*)\s+((?:[A-ZÄÖÜ]\w+\s*){1,3})(?:\s+(?:auf|on|per|via|über)\s+whatsapp|\s+(?:dass|that|die|der|das|ob|whether))/i
    );

    // Strategy 2: "Name auf/on WhatsApp" — require capitalized words (proper names)
    const toMatch = !sendMatch && text.match(
      /((?:[A-ZÄÖÜ]\w+\s*){1,3})\s+(?:auf|on|per|via|über)\s+whatsapp/i
    );

    // Strategy 3: "WhatsApp an/to Name"
    const afterMatch = !sendMatch && !toMatch && text.match(
      /whatsapp\s+(?:an|to|kontakt|contact|nachricht|message)\s+((?:[A-ZÄÖÜ]\w+\s*){1,3})/i
    );

    const match = sendMatch || toMatch || afterMatch;
    if (!match) return null;

    // Clean and validate the extracted name
    let name = match[1].trim()
      .replace(/\s+(auf|on|per|via|über|whatsapp|kontakt|contact|dass|that).*$/i, '')
      .trim();

    // Filter: all words must be potential names (not common words)
    const words = name.toLowerCase().split(/\s+/);
    const nameWords = words.filter(w => !NOT_NAMES.has(w) && w.length >= 2);
    if (nameWords.length === 0) return null;

    // Reconstruct from original casing
    name = match[1].trim().split(/\s+/)
      .filter(w => !NOT_NAMES.has(w.toLowerCase()) && w.length >= 2)
      .join(' ')
      .trim();

    return name.length >= 2 ? name : null;
  }

  /**
   * Extract [WA:number]message tags from LLM response.
   * Returns the cleaned response (tags removed) and the actions to execute.
   */
  extractWhatsAppActions(response) {
    // Match phone numbers, JIDs (xxx@s.whatsapp.net), or group JIDs (xxx@g.us)
    const waRegex = /\[WA:([^\]]+)\]\s*(.+?)(?=\[WA:|$)/gs;
    const waActions = [];
    let match;

    while ((match = waRegex.exec(response)) !== null) {
      waActions.push({
        recipient: match[1].trim(),
        message: match[2].trim(),
      });
    }

    // Remove WA tags from the response the user sees
    const cleanResponse = response.replace(/\[WA:[^\]]+\]\s*.+?(?=\[WA:|\n\n|$)/gs, '').trim();

    return { cleanResponse: cleanResponse || response, waActions };
  }

  async runHeartbeat() {
    console.log('  [heartbeat] Running...');
    await writePulse(this.soulPath, 'heartbeat', 'Autonomous heartbeat', this.bus);

    await this.context.load();
    const systemPrompt = buildHeartbeatPrompt(this.context);

    const trigger = this.context.language === 'de'
      ? 'Führe deinen Herzschlag durch. Reflektiere über deinen Zustand, träume wenn es Zeit ist, berichte was dich bewegt. Antworte frei.'
      : 'Perform your heartbeat. Reflect on your state, dream if it is time, report what moves you. Respond freely.';

    // Heartbeat also gets MCP tools (e.g. for web search during world-check)
    const llmOptions = this._buildLLMOptions();
    const result = await this.llm.generate(systemPrompt, [], trigger, llmOptions);

    await this.memory.writeHeartbeat(result);
    await this.memory.persistHeartbeatState(result, this.context.language);
    await this.memory.appendDailyNote('[Heartbeat] Autonomous pulse completed');
    this.bus.safeEmit('heartbeat.completed', { source: 'engine', result: result.substring(0, 500) });

    // Telegram notification
    if (
      this.telegram &&
      process.env.TELEGRAM_NOTIFY_HEARTBEAT === 'true'
    ) {
      const summary = result.length > 800
        ? result.substring(0, 797) + '...'
        : result;
      await this.telegram.sendToOwner(summary);
    }

    await writePulse(this.soulPath, 'heartbeat', 'Heartbeat complete', this.bus);
    console.log('  [heartbeat] Complete.');
  }

  /**
   * Register reactive event handlers.
   * These are the "synapses" — components reacting to each other's events.
   */
  _registerHandlers() {
    // Handler 1: Mood shift → adjust impulse timing
    this.bus.on('mood.changed', (event) => {
      if (!this.impulse || !this.impulse.running) return;

      // High energy + no recent impulse → shorten next delay
      if (event.mood.energy > 0.7 && this.impulse.state.timeSinceLastImpulse() > 1800000) {
        if (this.impulse.timer) {
          clearTimeout(this.impulse.timer);
          const shortened = this.impulse._calculateDelay() * 0.7;
          this.impulse.timer = setTimeout(() => this.impulse._loop(), shortened);
          console.log(`  [bus:handler] Mood energy high → impulse delay shortened to ${Math.round(shortened / 60000)}min`);
        }
      }
    });

    // Handler 2: New interest detected → create Knowledge Graph entity
    this.bus.on('interest.detected', async (event) => {
      if (!event.newInterests || event.newInterests.length === 0) return;
      if (!this.mcp || !this.mcp.hasTools()) return;

      // Check if memory MCP server has create_entities tool
      const hasMemory = this.mcp.tools.has('create_entities');
      if (!hasMemory) return;

      try {
        const entities = event.newInterests.map((name) => ({
          name,
          entityType: 'interest',
          observations: [
            `First mentioned by ${event.userName || 'user'} on ${new Date().toISOString().split('T')[0]}`,
          ],
        }));
        await this.mcp.callTool('create_entities', { entities });
        console.log(`  [bus:handler] Knowledge Graph: ${entities.length} new interest(s) created`);
      } catch (err) {
        console.error(`  [bus:handler] Knowledge Graph write failed: ${err.message}`);
      }
    });

    // Handler 3: Conversation responded with entities → add observations to Knowledge Graph
    this.bus.on('message.responded', async (event) => {
      if (!this.mcp || !this.mcp.hasTools()) return;
      if (!this.mcp.tools.has('add_observations')) return;
      if (!this.impulse) return;

      // Check if last tracked message had entity topics
      const state = this.impulse.state;
      const recentTopics = state._extractTopics?.(event.text);
      if (!recentTopics || recentTopics.length === 0) return;

      const entityTopics = recentTopics.filter((t) => t.type === 'entity');
      if (entityTopics.length === 0) return;

      try {
        const observations = entityTopics.map((t) => ({
          entityName: t.text,
          contents: [`Discussed with ${event.userName || 'user'}: "${event.text.substring(0, 80)}"`],
        }));
        await this.mcp.callTool('add_observations', { observations });
        console.log(`  [bus:handler] Knowledge Graph: ${observations.length} observation(s) added`);
      } catch {
        // Entity may not exist yet — that's fine, ignore silently
      }
    });
  }

  async stop() {
    this.running = false;
    await writePulse(this.soulPath, 'sleep', 'Engine shutting down', this.bus);

    if (this.impulse) await this.impulse.stop();
    if (this.heartbeat) this.heartbeat.stop();
    if (this.api) await this.api.stop();
    if (this.telegram) await this.telegram.stop();
    if (this.mcp) await this.mcp.shutdown();

    console.log('  Soul Engine stopped.');
  }
}

// ── ASCII Art Banner ─────────────────────────────────────

const SOUL_BANNER = `
\x1b[36m
      ██████╗  ██████╗ ██╗   ██╗██╗
      ██╔════╝██╔═══██╗██║   ██║██║
      ███████╗██║   ██║██║   ██║██║
      ╚════██║██║   ██║██║   ██║██║
      ██████╔╝╚██████╔╝╚██████╔╝███████╗
      ╚═════╝  ╚═════╝  ╚═════╝ ╚══════╝
\x1b[35m
    ██████╗ ██████╗  ██████╗ ████████╗ ██████╗  ██████╗ ██████╗ ██╗
    ██╔══██╗██╔══██╗██╔═══██╗╚══██╔══╝██╔═══██╗██╔════╝██╔═══██╗██║
    ██████╔╝██████╔╝██║   ██║   ██║   ██║   ██║██║     ██║   ██║██║
    ██╔═══╝ ██╔══██╗██║   ██║   ██║   ██║   ██║██║     ██║   ██║██║
    ██║     ██║  ██║╚██████╔╝   ██║   ╚██████╔╝╚██████╗╚██████╔╝███████╗
    ╚═╝     ╚═╝  ╚═╝ ╚═════╝    ╚═╝    ╚═════╝  ╚═════╝ ╚═════╝ ╚══════╝
\x1b[0m
\x1b[2m\x1b[36m         ───  The body for your soul  ───  v1.2.0\x1b[0m

\x1b[2m\x1b[35m                    .     .
                   (\\___/)
                   {o   o}
                   (  >  )
                    / | \\
                   / /|\\ \\
                  (_/ | \\_)
                      |
\x1b[0m
`;
