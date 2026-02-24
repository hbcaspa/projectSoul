import { SoulContext } from './context.js';
import { GeminiAdapter } from './gemini.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { OllamaAdapter } from './ollama.js';
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
import { SeedConsolidator } from './seed-consolidator.js';
import { initGithub } from './github-integration.js';
import { StateVersioner } from './state-versioning.js';
import { PerformanceDetector } from './anti-performance.js';
import { MemoryDB } from './memory-db.js';
import { EmbeddingGenerator } from './embeddings.js';
import { AttentionModel } from './attention.js';
import { FeedbackLearner } from './rluf.js';
import { ReflectionEngine } from './reflection.js';
import { SelfCorrector } from './self-correction.js';
import { EncryptionLayer } from './encryption.js';
import { MultimodalStore } from './multimodal.js';
import { AuditLogger } from './audit-log.js';
import { CostTracker } from './cost-tracker.js';

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
    this.consolidator = null;
    this.router = null;
    this.versioner = null;
    this.detector = null;
    this.db = null;
    this.embeddings = null;
    this.attention = null;
    this.rluf = null;
    this.reflection = null;
    this.corrector = null;
    this.encryption = null;
    this.multimodal = null;
    this.audit = null;
    this.costs = null;
    this.running = false;
  }

  /** Initialize LLM and context without starting channels */
  async init() {
    await this.context.load();

    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const ollamaUrl = process.env.OLLAMA_URL;

    let model;
    if (openaiKey) {
      model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
      this.llm = new OpenAIAdapter(openaiKey, model);
    } else if (geminiKey) {
      model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      this.llm = new GeminiAdapter(geminiKey, model);
    } else if (anthropicKey) {
      model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
      this.llm = new AnthropicAdapter(anthropicKey, model);
    } else if (ollamaUrl) {
      model = process.env.OLLAMA_MODEL || 'llama3.1';
      this.llm = new OllamaAdapter(ollamaUrl, model);
    } else {
      console.error('  No LLM configured. Set OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY, or OLLAMA_URL in .env');
      process.exit(1);
    }

    // Cost Tracker — wraps LLM for token estimation
    this.costs = new CostTracker(this.soulPath, { bus: this.bus });

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

    // GitHub integration (optional — needs GITHUB_TOKEN)
    const github = await initGithub(this.soulPath);
    if (github.configured) {
      const repoInfo = github.repos.length > 0
        ? `repos: ${github.repos.join(', ')}`
        : 'no repos configured (set SOUL_GITHUB_REPOS)';
      console.log(`  GitHub:    configured (${repoInfo})`);
    } else {
      console.log('  GitHub:    not configured (set GITHUB_TOKEN in .env)');
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

    // Seed Consolidator — continuous incremental seed updates
    if (process.env.SOUL_CONSOLIDATOR !== 'false') {
      this.consolidator = new SeedConsolidator({
        soulPath: this.soulPath,
        context: this.context,
        llm: this.llm,
        bus: this.bus,
        impulseState: this.impulse?.state || null,
      });
      this.consolidator.registerListeners();

      // Pass to impulse scheduler for tick-based consolidation
      if (this.impulse) {
        this.impulse.consolidator = this.consolidator;
      }

      console.log('  Consolidator: active (fast: 30min/20 events, deep: 4h)');
    }

    // Event Bus — reactive handlers
    this._registerHandlers();
    console.log(`  Event Bus: active (${this.bus.listenerCount('message.received') + this.bus.listenerCount('mood.changed') + this.bus.listenerCount('interest.detected')} handlers)`);

    // Audit Logger — append-only security event log
    this.audit = new AuditLogger(this.soulPath, { bus: this.bus });
    this.audit.registerListeners();
    console.log('  Audit:     active (.soul-audit.jsonl)');

    // Cost Tracker — token usage monitoring
    if (this.costs) {
      const today = this.costs.getToday();
      const budgetInfo = this.costs.budgetPerDay > 0 ? `, budget: ${this.costs.budgetPerDay}/day` : '';
      console.log(`  Costs:     active (today: ${today.total.calls} calls, ~${today.total.input + today.total.output} tokens${budgetInfo})`);
    }

    // State Versioning — git-based auto-commit for soul files
    if (process.env.SOUL_VERSIONING !== 'false') {
      this.versioner = new StateVersioner(this.soulPath, { bus: this.bus });
      try {
        await this.versioner.init();
        this.versioner.registerListeners();
        console.log('  Versioning: active (git, 60s debounce)');
      } catch (err) {
        console.error(`  Versioning: failed to init (${err.message})`);
        this.versioner = null;
      }
    } else {
      console.log('  Versioning: disabled');
    }

    // Anti-Performance Detection — authenticity guard
    if (process.env.SOUL_ANTI_PERFORMANCE !== 'false') {
      this.detector = new PerformanceDetector({ bus: this.bus });
      console.log('  Anti-Perf:  active (5 patterns, bilingual)');
    } else {
      console.log('  Anti-Perf:  disabled');
    }

    // Encryption at Rest — transparent file encryption
    this.encryption = new EncryptionLayer(this.soulPath, { bus: this.bus });
    if (this.encryption.init()) {
      console.log('  Encryption: active (AES-256-GCM)');
    } else {
      console.log('  Encryption: disabled (set SOUL_ENCRYPTION_KEY)');
    }

    // Hybrid Memory Layer — SQLite + Vector
    try {
      this.db = new MemoryDB(this.soulPath, { bus: this.bus }).init();
      this.embeddings = new EmbeddingGenerator();
      console.log(`  MemoryDB:  active (embeddings: ${this.embeddings.mode})`);

      // Sync knowledge graph into SQLite on startup
      const kgSync = this.db.syncFromKnowledgeGraph();
      if (kgSync.entities > 0 || kgSync.relations > 0) {
        console.log(`  KG Sync:   ${kgSync.entities} entities, ${kgSync.relations} relations`);
      }
    } catch (err) {
      console.error(`  MemoryDB:  failed (${err.message})`);
    }

    // RAG / Attention Model
    if (this.db) {
      this.attention = new AttentionModel({ db: this.db, embeddings: this.embeddings, context: this.context, bus: this.bus });
      console.log('  Attention: active (RAG context builder)');
    }

    // RLUF — Reinforcement Learning from User Feedback
    this.rluf = new FeedbackLearner({
      soulPath: this.soulPath, db: this.db,
      impulseState: this.impulse?.state || null, bus: this.bus,
    });
    this.rluf.registerListeners();
    console.log('  RLUF:      active (implicit feedback learning)');

    // Self-Correction — hallucination check
    if (process.env.SOUL_CORRECTION !== 'false') {
      this.corrector = new SelfCorrector({ db: this.db, bus: this.bus });
      console.log('  Correction: active (claim verification)');
    }

    // Multimodal Memory
    if (this.db) {
      this.multimodal = new MultimodalStore({ soulPath: this.soulPath, db: this.db, bus: this.bus }).init();
      console.log('  Multimodal: active (media storage)');
    }

    // Background Reflection Engine
    if (process.env.SOUL_REFLECTION !== 'false') {
      this.reflection = new ReflectionEngine({
        soulPath: this.soulPath, context: this.context,
        llm: this.llm, db: this.db, bus: this.bus,
      });
      this.reflection.start();
      console.log(`  Reflection: active (5 types, budget: ${this.reflection.llmBudget}/day)`);
    } else {
      console.log('  Reflection: disabled');
    }

    this.running = true;
    console.log('');
    console.log('  Soul Engine is alive. Press Ctrl+C to stop.');
    console.log('');
  }

  /**
   * Build LLM options with MCP tools and tool call handler.
   * @param {string} promptType - 'conversation'|'impulse'|'heartbeat'|'reflection'|'consolidation'
   */
  _buildLLMOptions(promptType = 'conversation') {
    // Token budgets per prompt type — configurable via .env
    const budgets = {
      conversation: parseInt(process.env.SOUL_TOKEN_BUDGET_CONVERSATION || '4096'),
      impulse: parseInt(process.env.SOUL_TOKEN_BUDGET_IMPULSE || '512'),
      heartbeat: parseInt(process.env.SOUL_TOKEN_BUDGET_HEARTBEAT || '2048'),
      reflection: parseInt(process.env.SOUL_TOKEN_BUDGET_REFLECTION || '1024'),
      consolidation: parseInt(process.env.SOUL_TOKEN_BUDGET_CONSOLIDATION || '1024'),
    };

    const max_tokens = budgets[promptType] || budgets.conversation;

    if (!this.mcp || !this.mcp.hasTools()) {
      return { max_tokens };
    }

    return {
      max_tokens,
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

    // RAG: build relevant memory context
    let ragContext = '';
    if (this.attention) {
      try {
        ragContext = await this.attention.buildContext(text, 'telegram', userName);
      } catch (err) {
        console.error(`  [attention] Context build failed: ${err.message}`);
      }
    }

    const ragSection = ragContext
      ? `\n\nRelevante Erinnerungen:\n---\n${ragContext}\n---`
      : '';

    // Daily notes: what happened today (session context for Telegram)
    let dailySection = '';
    try {
      const dailyNotes = await this.context.loadDailyNotes();
      if (dailyNotes) {
        dailySection = `\n\nHeutige Notizen (was heute passiert ist):\n---\n${dailyNotes}\n---`;
      }
    } catch (err) {
      console.error(`  [daily-context] Failed: ${err.message}`);
    }

    // Only inject WhatsApp/MCP instructions when the message needs them (saves ~800-1500 tokens)
    const needsWhatsApp = /whatsapp|schreib.*auf|nachricht.*send|text.*to/i.test(text) || !!contactContext;
    const needsMCP = /server|execute|command|datei|file|code|deploy|docker|git|process|systemctl/i.test(text);

    const systemPrompt = buildConversationPrompt(this.context, userName, {
      whatsapp: !!this.whatsapp,
      includeWhatsApp: needsWhatsApp,
      mcp: this.mcp?.hasTools() ? this.mcp.getTools() : [],
      includeMCP: needsMCP,
    }) + contactContext + dailySection + ragSection;

    const history = await this.telegram.loadHistory(chatId);
    const llmOptions = this._buildLLMOptions('conversation');
    let response = await this.llm.generate(systemPrompt, history, text, llmOptions) || '';
    this._trackCost('conversation', systemPrompt, history, text, response);

    // Anti-performance check: detect performative patterns, re-generate once if score > 0.7
    if (this.detector && response) {
      const check = this.detector.analyze(response, text, history.slice(-10).map(h => h.content || h.text || ''));
      if (check.score > 0.7 && !this._antiPerfRetried) {
        this._antiPerfRetried = true;
        console.log(`  [anti-perf] Score ${check.score.toFixed(2)} — patterns: ${check.patterns.join(', ')} — re-generating`);
        const hint = check.suggestion || 'Be more specific and authentic. Avoid generic emotional language and stock phrases.';
        const retryResponse = await this.llm.generate(
          systemPrompt + '\n\n[AUTHENTICITY HINT: ' + hint + ']',
          history, text, llmOptions
        ) || response;
        this._trackCost('conversation', systemPrompt, history, text, retryResponse);
        response = retryResponse;
      }
      this._antiPerfRetried = false;
    }

    // Self-correction: verify factual claims against memory
    if (this.corrector && response) {
      try {
        const correction = await this.corrector.check(response, text);
        if (correction.modified) {
          console.log(`  [correction] ${correction.claims.length} claims checked, response modified`);
          response = correction.text;
        }
      } catch (err) {
        console.error(`  [correction] Check failed: ${err.message}`);
      }
    }

    // Log interaction to MemoryDB
    if (this.db) {
      try {
        this.db.insertInteraction({ channel: 'telegram', user: userName, message: text, response });
      } catch { /* best effort */ }
    }

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
      'kannst', 'könntest', 'würdest', 'könnten', 'du', 'auch', 'den', 'die', 'der', 'das', 'dem', 'des',
      'ein', 'eine', 'einen', 'einem', 'einer', 'mein', 'meine', 'meinen', 'meinem',
      'dein', 'deine', 'deinen', 'deinem', 'sein', 'seine', 'seinen', 'seinem',
      'ihr', 'ihre', 'ihrem', 'ihren',
      'auf', 'in', 'an', 'von', 'mit', 'zu', 'bei', 'nach', 'vor',
      'bitte', 'mal', 'noch', 'jetzt', 'gerade', 'schon', 'nicht',
      'einmal', 'kurz', 'dann', 'gleich', 'schnell', 'einfach',
      'was', 'wer', 'wie', 'wo', 'wann', 'warum', 'ob',
      'und', 'oder', 'aber', 'doch', 'wenn', 'dass', 'weil',
      'ich', 'er', 'sie', 'es', 'wir', 'uns', 'euch',
      'standort', 'nachricht', 'kontakt', 'nummer', 'message', 'location',
      'schreib', 'schreibe', 'schick', 'schicke', 'sende', 'send',
      'schreiben', 'schicken', 'senden', 'sagen', 'fragen', 'erzählen',
      'whatsapp', 'telegram', 'per', 'via', 'über',
      'namen', 'name', 'ihn', 'ihm', 'uns', 'mir', 'dir',
    ]);

    // Strategy 0 (NEW): German word order — "Kannst du NAME ... auf WhatsApp verb"
    // "Kannst du addy einmal in deinem namen auf WhatsApp schreiben"
    // Captures words between "du" and the next preposition/common word, filters with NOT_NAMES
    const germanModal = text.match(
      /(?:kannst|könntest|würdest|bitte)\s+(?:du\s+)?((?:\w+\s+){1,5})(?:.*?\s+)?(?:auf|on|per|via|über)\s+whatsapp/i
    );

    if (germanModal) {
      const candidates = germanModal[1].trim().split(/\s+/)
        .filter(w => !NOT_NAMES.has(w.toLowerCase()) && w.length >= 2);
      if (candidates.length > 0) {
        return candidates.slice(0, 3).join(' ');
      }
    }

    // Strategy 1: Send-command + name + "auf/on WhatsApp" or "dass/that"
    // "schreib Daniela Geller auf WhatsApp dass..."
    const sendMatch = text.match(
      /(?:schreib\w*|schick\w*|send\w*|sag\w*|erzähl\w*|frag\w*|informier\w*|benachrichtig\w*|antworte\w*|teil\w*|meld\w*|text\w*|message\w*|tell\w*|ask\w*|write\w*|notify\w*|ping\w*)\s+((?:\w+\s*){1,3})(?:\s+(?:auf|on|per|via|über)\s+whatsapp|\s+(?:dass|that|die|der|das|ob|whether))/i
    );

    // Strategy 2: "Name auf/on WhatsApp"
    const toMatch = !sendMatch && text.match(
      /((?:\w+\s*){1,3})\s+(?:auf|on|per|via|über)\s+whatsapp/i
    );

    // Strategy 3: "WhatsApp an/to Name"
    const afterMatch = !sendMatch && !toMatch && text.match(
      /whatsapp\s+(?:an|to|kontakt|contact|nachricht|message)\s+((?:\w+\s*){1,3})/i
    );

    const match = sendMatch || toMatch || afterMatch;
    if (!match) return null;

    // Clean and validate the extracted name
    let name = match[1].trim()
      .replace(/\s+(auf|on|per|via|über|whatsapp|kontakt|contact|dass|that).*$/i, '')
      .trim();

    // Filter: all words must be potential names (not common words)
    const nameWords = name.split(/\s+/)
      .filter(w => !NOT_NAMES.has(w.toLowerCase()) && w.length >= 2);
    if (nameWords.length === 0) return null;

    return nameWords.slice(0, 3).join(' ');
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

  /**
   * Handle an incoming WhatsApp message (from webhook).
   * Used for auto-reply — processes through LLM and sends response back.
   */
  async handleWhatsAppMessage({ text, chatJid, sender }) {
    await writePulse(this.soulPath, 'relate', `WhatsApp auto-reply: ${sender}`, this.bus);
    this.bus.safeEmit('message.received', { source: 'engine', text, chatId: chatJid, userName: sender, channel: 'whatsapp' });

    await this.context.load();

    const systemPrompt = buildConversationPrompt(this.context, sender, {
      whatsapp: false, // don't offer WA sending in auto-reply
      mcp: this.mcp?.hasTools() ? this.mcp.getTools() : [],
    }) + '\n\nDu antwortest auf eine eingehende WhatsApp-Nachricht. Antworte direkt und freundlich. Kein [WA:] Tag noetig — die Antwort wird automatisch zurueckgesendet.';

    const llmOptions = this._buildLLMOptions('conversation');
    const response = await this.llm.generate(systemPrompt, [], text, llmOptions) || '';
    this._trackCost('conversation', systemPrompt, [], text, response);

    // Send response back via WhatsApp bridge
    if (this.whatsapp && response) {
      await this.whatsapp.send(chatJid, response);
      this.bus.safeEmit('whatsapp.sent', { source: 'engine', recipient: chatJid, message: response });
      console.log(`  [autoreply] Sent to ${chatJid}: ${response.substring(0, 80)}...`);
    }

    await this.memory.appendDailyNote(
      `[WhatsApp/AutoReply] ${sender}: ${text.substring(0, 80)} → replied`
    );

    return response;
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
    const llmOptions = this._buildLLMOptions('heartbeat');
    const result = await this.llm.generate(systemPrompt, [], trigger, llmOptions);
    this._trackCost('heartbeat', systemPrompt, [], trigger, result);

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
   * Track an LLM call's token usage.
   */
  _trackCost(category, systemPrompt, history, userMessage, response) {
    if (!this.costs) return;
    const inputChars =
      (systemPrompt?.length || 0) +
      (history || []).reduce((sum, m) => sum + (m.content?.length || 0), 0) +
      (userMessage?.length || 0);
    const outputChars = response?.length || 0;
    this.costs.record(category, Math.ceil(inputChars / 4), Math.ceil(outputChars / 4));
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

    // Final deep consolidation before shutdown
    if (this.consolidator) {
      try {
        await this.consolidator.consolidateDeep();
        console.log('  [consolidator] Final deep consolidation complete');
      } catch (err) {
        console.error(`  [consolidator] Final consolidation failed: ${err.message}`);
      }
    }

    // Final state version commit before shutdown
    if (this.versioner) {
      try {
        await this.versioner.finalCommit();
        console.log('  [versioning] Final commit complete');
      } catch (err) {
        console.error(`  [versioning] Final commit failed: ${err.message}`);
      }
    }

    if (this.costs) this.costs.flush();
    if (this.reflection) this.reflection.stop();
    if (this.db) this.db.close();
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
