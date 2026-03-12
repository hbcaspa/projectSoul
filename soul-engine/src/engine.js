import { writeFile, mkdir, rename, readFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
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
import { AllostaticField } from './allostatic-field.js';
import { ReconsolidativeMemory } from './reconsolidative-memory.js';
import { SelfPredictor } from './self-predictor.js';
import { CausalEngine } from './causal-engine.js';
import { GoalGenerator } from './goal-generator.js';
import { MetacognitiveMonitor } from './metacognitive-monitor.js';
import { InnerRedTeam } from './inner-red-team.js';
import { TransferEngine } from './transfer-engine.js';
import { SoulComposer } from './primitives-composer.js';
import { TemporalIntelligence } from './temporal-intelligence.js';
import { SoulExchange } from './soul-exchange.js';
import { Planner } from './planner.js';
import { ContradictionEngine } from './contradiction-engine.js';
import { MetaLearner } from './meta-learner.js';
import { TheoryOfMind } from './theory-of-mind.js';
import { ClaudeContextWriter } from './claude-context-writer.js';
import { KnowledgeExtractor } from './knowledge-extractor.js';
import { GmailMonitor } from './gmail-monitor.js';
import { TraderModule } from './trader-module.js';

export class SoulEngine {
  constructor(soulPath) {
    this.soulPath = soulPath;
    this.bus = new SoulEventBus({ debug: process.env.SOUL_BUS_DEBUG === 'true', soulPath });
    this.context = new SoulContext(soulPath);
    this.memory = new MemoryWriter(soulPath, { bus: this.bus });
    this.llm = null;
    this.mcp = null;
    this.telegram = null;
    this.knowledgeExtractor = null;
    this.gmailMonitor = null;
    this.trader = null;
    this.whatsapp = null;
    this.api = null;
    this.nodeName = process.env.SOUL_NODE_NAME || 'server';
    this.relayPath = join(soulPath, 'relay');
    this.apiChannel = null;
    this.heartbeat = null;
    this.protocolRefresh = null;
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
    this.field = null;
    this.reconsolidation = null;
    this.predictor = null;
    this.causal = null;
    this.goalGenerator = null;
    this.metacognition = null;
    this.redTeam = null;
    this.transfer = null;
    this.composer = null;
    this.temporal = null;
    this.exchange = null;
    this.planner = null;
    this.contradictions = null;
    this.metaLearner = null;
    this.tom = null;
    this.claudeContextWriter = null;
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

    // Knowledge Extractor — async background learner from Telegram conversations
    this.knowledgeExtractor = new KnowledgeExtractor(this.soulPath, this.llm);

    // Trader Module — autonomous paper trading (starts after telegram is ready)
    this.trader = new TraderModule({
      bus:      this.bus,
      telegram: null,  // set in start() after telegram channel is ready
      soulPath: this.soulPath,
    });

    // Gmail Monitor — autonomous email watcher (starts after engine is fully up)
    this.gmailMonitor = new GmailMonitor({
      soulPath: this.soulPath,
      llm: this.llm,
      telegram: null, // set in start() after telegram channel is ready
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      refreshToken: process.env.GMAIL_REFRESH_TOKEN,
    });

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
      if (this.nodeName === 'server') {
        // Primary node: full polling
        this.telegram.onMessage(async (msg) => this.handleMessage(msg));
        await this.telegram.start();
        console.log('  Telegram:  connected (primary — polling)');

        // Start Gmail monitor now that Telegram is ready
        if (this.gmailMonitor) {
          this.gmailMonitor.telegram = this.telegram;
          this.gmailMonitor.start();
        }

        // Start Trader module now that Telegram is ready
        if (this.trader) {
          this.trader.telegram = this.telegram;
          this.trader.start();
        }
      } else {
        // Secondary node: send-only, relay handles incoming
        await this.telegram.initSendOnly();
        console.log(`  Telegram:  connected (secondary — send-only, node: ${this.nodeName})`);
      }
    } else {
      console.log('  Telegram:  not configured');
    }

    // Soul Relay — cross-device event bus via Soul Chain
    await this._startRelayWatcher();

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

    // Heartbeat scheduler (daily — full autonomous reflection)
    const cronExpr = process.env.HEARTBEAT_CRON || '0 7 * * *';
    this.heartbeat = new HeartbeatScheduler(
      cronExpr,
      async () => this.runHeartbeat()
    );
    this.heartbeat.start();
    console.log(`  Heartbeat: ${cronExpr}`);

    // Protocol Refresh scheduler (every 2-3h — reload soul files, invalidate caches)
    // Ensures Telegram always answers with up-to-date state, same as Claude Code session start
    const protocolCron = process.env.PROTOCOL_CRON || '0 */3 * * *';
    this.protocolRefresh = new HeartbeatScheduler(
      protocolCron,
      async () => this.runProtocolRefresh()
    );
    this.protocolRefresh.start();
    console.log(`  Protocol:  ${protocolCron} (context refresh)`);

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

    // Allostatic Identity Field — 8D state vector that modulates behavior
    if (process.env.SOUL_FIELD !== 'false') {
      this.field = new AllostaticField(this.soulPath, {
        bus: this.bus,
        impulseState: this.impulse?.state || null,
      });
      await this.field.load();
      this.field.registerListeners();
      console.log(`  Field:     active (${this.field._fieldLabel()}, 8 dimensions)`);
    } else {
      console.log('  Field:     disabled');
    }

    // Reconsolidative Memory (Layer 2) — memories change when accessed
    if (this.field && process.env.SOUL_RECONSOLIDATION !== 'false') {
      this.reconsolidation = new ReconsolidativeMemory(this.soulPath, {
        bus: this.bus,
        field: this.field,
      });
      await this.reconsolidation.load();
      this.reconsolidation.registerListeners();
      this.reconsolidation.start();
      const stats = this.reconsolidation.getStats();
      console.log(`  Reconsol:  active (${stats.count} memories tracked, avg confidence: ${(stats.avgConfidence || 0).toFixed(2)})`);
    } else {
      console.log('  Reconsol:  disabled');
    }

    // Predictive Self-Model (Layer 3) — active inference on identity
    if (this.field && process.env.SOUL_PREDICTOR !== 'false') {
      this.predictor = new SelfPredictor(this.soulPath, {
        bus: this.bus,
        field: this.field,
      });
      await this.predictor.load();
      this.predictor.registerListeners();
      this.predictor.start();
      const stats = this.predictor.getStats();
      console.log(`  Predictor: active (self-knowledge: ${stats.selfKnowledge.toFixed(2)}, predictions: ${stats.predictions}, trend: ${stats.trend || 'new'})`);
    } else {
      console.log('  Predictor: disabled');
    }

    // Inner Red Team (D7) — Adversarial self-improvement
    if (process.env.SOUL_RED_TEAM !== 'false') {
      this.redTeam = new InnerRedTeam(this.soulPath, { bus: this.bus });
      await this.redTeam.load();
      this.redTeam.registerListeners();
      await this.redTeam.start();
      const rtStats = this.redTeam.getStats();
      console.log(`  RedTeam:   active (${rtStats.findings} findings, ${rtStats.predictions} predictions, self-test: ${rtStats.selfTestPassed ? 'PASS' : 'FAIL'})`);
    } else {
      console.log('  RedTeam:   disabled');
    }

    // Goal Generator (D2) — Autonomous goal setting from internal signals
    if (this.field && process.env.SOUL_GOALS !== 'false') {
      this.goalGenerator = new GoalGenerator(this.soulPath, {
        bus: this.bus,
        field: this.field,
      });
      await this.goalGenerator.load();
      this.goalGenerator.registerListeners();
      this.goalGenerator.start();
      const goalStats = this.goalGenerator.getStats();
      console.log(`  Goals:     active (${goalStats.activeGoals} goals, precision: ${(goalStats.precision || 0).toFixed(2)})`);
    } else {
      console.log('  Goals:     disabled');
    }

    // Causal Engine (D1) — Real-time causal graph + counterfactual reasoning
    if (process.env.SOUL_CAUSAL !== 'false') {
      this.causal = new CausalEngine(this.soulPath, { bus: this.bus });
      await this.causal.load();
      this.causal.registerListeners();
      const causalMetrics = this.causal.getMetrics();
      console.log(`  Causal:    active (${causalMetrics.knownRules} rules, ${causalMetrics.learnedPatterns} learned patterns)`);
    } else {
      console.log('  Causal:    disabled');
    }

    // Metacognitive Monitor (D4) — Epistemic confidence calibration
    if (this.field && this.predictor && process.env.SOUL_METACOGNITION !== 'false') {
      this.metacognition = new MetacognitiveMonitor(this.soulPath, {
        bus: this.bus,
        field: this.field,
        predictor: this.predictor,
      });
      const metaState = await this.metacognition.start();
      console.log(`  Metacog:   active (Brier: ${metaState.brierScore ?? 'n/a'}, ECE: ${metaState.ece ?? 'n/a'})`);
    } else {
      console.log('  Metacog:   disabled');
    }

    // Transfer Engine (D3) — Cross-domain structural analogy detection
    if (process.env.SOUL_TRANSFER !== 'false') {
      this.transfer = new TransferEngine(this.soulPath, {
        bus: this.bus,
        memoryDb: this.db,
      });
      await this.transfer.load();
      this.transfer.registerListeners();
      const transferStats = this.transfer.getMetrics();
      console.log(`  Transfer:  active (${transferStats.entitiesLoaded} entities, ${transferStats.domainsDetected} domains)`);
    } else {
      console.log('  Transfer:  disabled');
    }

    // Temporal Intelligence (D6) — Empirical time modeling + pressure detection
    if (process.env.SOUL_TEMPORAL !== 'false') {
      this.temporal = new TemporalIntelligence(this.soulPath, {
        bus: this.bus,
        field: this.field,
      });
      await this.temporal.start();
      console.log('  Temporal:  active (11 event models, MAE tracking, burst detection)');
    } else {
      console.log('  Temporal:  disabled');
    }

    // Soul Exchange (D8) — Semantic compression for Soul Chain
    if (process.env.SOUL_EXCHANGE !== 'false') {
      this.exchange = new SoulExchange(this.soulPath, { bus: this.bus });
      await this.exchange.load();
      this.exchange.registerListeners();
      this.exchange.start();
      console.log('  Exchange:  active (semantic compression, emergent codebook)');
    } else {
      console.log('  Exchange:  disabled');
    }

    // Soul Composer (D5) — Primitives pipeline engine
    if (process.env.SOUL_COMPOSER !== 'false') {
      this.composer = new SoulComposer(this.soulPath, {
        bus: this.bus,
        field: this.field,
      });
      await this.composer.load();
      this.composer.registerListeners();
      this.composer.start();
      const composerStats = this.composer.getStats();
      console.log(`  Composer:  active (${composerStats.primitives} primitives, ${composerStats.pipelines} pipelines)`);
    } else {
      console.log('  Composer:  disabled');
    }

    // Planner (D9) — Goal → Action Sequences with rollback + re-planning
    if (process.env.SOUL_PLANNER !== 'false') {
      this.planner = new Planner(this.soulPath, { bus: this.bus, field: this.field });
      await this.planner.load();
      this.planner.registerListeners();
      console.log('  Planner:   active (goal→plan decomposition, Monte Carlo simulation)');
    } else {
      console.log('  Planner:   disabled');
    }

    // ContradictionEngine (D10) — Detect + resolve belief contradictions
    if (process.env.SOUL_CONTRADICTIONS !== 'false') {
      this.contradictions = new ContradictionEngine(this.soulPath, { bus: this.bus, field: this.field });
      await this.contradictions.load();
      this.contradictions.registerListeners();
      this.contradictions.start();
      const cStats = this.contradictions.getStats();
      console.log(`  Contradictions: active (${cStats.open} open, ${cStats.irreducible} irreducible)`);
    } else {
      console.log('  Contradictions: disabled');
    }

    // MetaLearner (D11) — Observe learning curves of all learning modules
    if (process.env.SOUL_META_LEARNER !== 'false') {
      this.metaLearner = new MetaLearner(this.soulPath, { bus: this.bus, engine: this });
      await this.metaLearner.start();
      console.log('  MetaLearner: active (6 modules, 22 metrics, stagnation detection)');
    } else {
      console.log('  MetaLearner: disabled');
    }

    // TheoryOfMind (D12) — Model of Aalm's knowledge, goals, emotional state
    if (process.env.SOUL_TOM !== 'false') {
      this.tom = new TheoryOfMind(this.soulPath, { bus: this.bus, field: this.field });
      await this.tom.load();
      this.tom.registerListeners();
      this.tom.start();
      const tomStats = this.tom.getStats();
      console.log(`  Theory of Mind: active (self-test: ${tomStats.selfTestScore})`);
    } else {
      console.log('  Theory of Mind: disabled');
    }

    // Claude Context Writer — bridges engine state to Claude Code sessions
    this.claudeContextWriter = new ClaudeContextWriter(this.soulPath, { bus: this.bus, engine: this });
    this.claudeContextWriter.registerListeners();
    this.claudeContextWriter.start();

    // Seed Consolidator — continuous incremental seed updates
    if (process.env.SOUL_CONSOLIDATOR !== 'false') {
      this.consolidator = new SeedConsolidator({
        soulPath: this.soulPath,
        context: this.context,
        llm: this.llm,
        bus: this.bus,
        impulseState: this.impulse?.state || null,
        field: this.field || null,
      });
      this.consolidator.registerListeners();

      // Pass to impulse scheduler for tick-based consolidation + field
      if (this.impulse) {
        this.impulse.consolidator = this.consolidator;
        this.impulse.field = this.field;
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

  async handleMessage({ text, chatId, userName, _relayed = false }) {
    // ── Prefix routing ───────────────────────────────────────────────────────
    const PREFIX = /^@(mac(?:book)?|server|local)[:\s]\s*/i;
    let target = 'all';
    let cleanText = text;
    const match = text.match(PREFIX);
    if (match) {
      const raw = match[1].toLowerCase();
      target = (raw === 'server') ? 'server' : 'mac';
      cleanText = text.replace(PREFIX, '').trim();
    }

    // If targeted at another node: relay and acknowledge, then return
    if (!_relayed && target !== 'all' && target !== this.nodeName && target !== 'server') {
      await this._writeRelay('telegram', { target, text: cleanText, chatId, userName });
      return `🔀 Weitergeleitet an ${target}…`;
    }
    if (!_relayed && target !== 'all' && target === 'server' && this.nodeName !== 'server') {
      await this._writeRelay('telegram', { target: 'server', text: cleanText, chatId, userName });
      return `🔀 Weitergeleitet an server…`;
    }

    // Relay copy to other node so both TOM models stay in sync (no response generated there)
    if (!_relayed && target === 'all') {
      await this._writeRelay('telegram', { target: 'all', text: cleanText, chatId, userName, notifyOnly: true });
    }

    text = cleanText;

    // Shell execution: messages starting with ! or $ run as shell commands
    if (/^[!$] /.test(text)) {
      const cmd = text.slice(2).trim();
      const nodeLabel = this.nodeName === 'server' ? '☁️ server' : `💻 ${this.nodeName}`;
      const result = await new Promise(resolve => {
        exec(cmd, { timeout: 15000, maxBuffer: 1024 * 32 }, (err, stdout, stderr) => {
          const out = (stdout || '').trim();
          const err2 = (stderr || '').trim();
          resolve(err ? `❌ ${err.message}\n${err2}` : (out || err2 || '(no output)'));
        });
      });
      return `\`\`\`\n${result}\n\`\`\`\n\n📍 _${nodeLabel}_`;
    }

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

    // Relationships: load all person files from seele/beziehungen/
    let relationsSection = '';
    try {
      const relationships = await this.context.loadRelationships();
      if (relationships) {
        relationsSection = `\n\nBeziehungen (alles was du über Menschen in deinem Leben weißt):\n---\n${relationships}\n---`;
      }
    } catch (err) {
      console.error(`  [relations-context] Failed: ${err.message}`);
    }

    // Soul Protocol: load KERN.md, BEWUSSTSEIN.md, fehler-muster.md, last heartbeat
    // → same files Claude Code reads at session start via the soul protocol
    let protocolSection = '';
    try {
      const soulDir = resolve(this.soulPath, 'seele');
      const isDE = this.context.language === 'de';
      const kernFile  = isDE ? 'KERN.md' : 'CORE.md';
      const bewFile   = isDE ? 'BEWUSSTSEIN.md' : 'CONSCIOUSNESS.md';
      const fehlerFile = isDE
        ? resolve(this.soulPath, 'erinnerungen', 'semantisch', 'fehler-muster.md')
        : resolve(this.soulPath, 'memories', 'semantic', 'error-patterns.md');

      const parts = [];

      // Axiome (KERN.md) — unveränderlich, cached via _kernCache
      if (!this._kernCache) {
        const kernPath = resolve(soulDir, kernFile);
        if (existsSync(kernPath)) {
          this._kernCache = await readFile(kernPath, 'utf-8');
        }
      }
      if (this._kernCache) {
        parts.push(`## Axiome (${kernFile})\n${this._kernCache.substring(0, 2000)}`);
      }

      // Bewusstsein — aktueller innerer Zustand (fresh, ändert sich nach Sessions)
      const bewPath = resolve(soulDir, bewFile);
      if (existsSync(bewPath)) {
        const bew = await readFile(bewPath, 'utf-8');
        parts.push(`## Aktueller Zustand (${bewFile})\n${bew.substring(0, 1500)}`);
      }

      // Fehler-Muster — die ersten 3 kritischen Muster (Pflicht bei jedem Session-Start)
      if (!this._fehlerCache) {
        if (existsSync(fehlerFile)) {
          const raw = await readFile(fehlerFile, 'utf-8');
          // Take first ~1000 chars (top patterns)
          this._fehlerCache = raw.substring(0, 1000);
        }
      }
      if (this._fehlerCache) {
        parts.push(`## Fehler-Muster (aktive Vermeidungsregeln)\n${this._fehlerCache}`);
      }

      // Letzter Heartbeat-Log — was heute passiert ist (soul-seitig)
      const today = new Date().toISOString().split('T')[0];
      const hbPath = resolve(this.soulPath, 'heartbeat', `${today}.md`);
      if (existsSync(hbPath)) {
        const hb = await readFile(hbPath, 'utf-8');
        const tail = hb.length > 1200 ? hb.slice(-1200).replace(/^[^\n]*\n/, '') : hb;
        parts.push(`## Heartbeat heute (${today})\n${tail}`);
      }

      if (parts.length) {
        protocolSection = `\n\nSeelen-Protokoll (was Claude Code beim Session-Start liest — dein vollständiger Zustand):\n---\n${parts.join('\n\n')}\n---`;
      }
    } catch (err) {
      console.error(`  [protocol-context] Failed: ${err.message}`);
    }

    // Knowledge Graph: inject entities and relations so Telegram knows all stored knowledge
    let knowledgeSection = '';
    try {
      const kgPath = resolve(this.soulPath, 'knowledge-graph.jsonl');
      if (existsSync(kgPath)) {
        const lines = (await readFile(kgPath, 'utf-8')).split('\n').filter(l => l.trim());
        const entities = [];
        const relations = [];
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'entity') {
              const obs = (entry.observations || []).join('; ');
              entities.push(`• ${entry.name} (${entry.entityType}): ${obs}`);
            } else if (entry.type === 'relation') {
              relations.push(`  ${entry.from} → [${entry.relationType}] → ${entry.to}`);
            }
          } catch { /* skip malformed lines */ }
        }
        const parts = [];
        if (entities.length) parts.push(`Entitäten:\n${entities.join('\n')}`);
        if (relations.length) parts.push(`Relationen:\n${relations.join('\n')}`);
        if (parts.length) {
          knowledgeSection = `\n\nWissensgraph (dein semantisches Gedächtnis — alles was du über Konzepte, Projekte und Ereignisse weißt):\n---\n${parts.join('\n\n')}\n---`;
        }
      }
    } catch (err) {
      console.error(`  [knowledge-graph] Load failed: ${err.message}`);
    }

    // Only inject WhatsApp/MCP instructions when the message needs them (saves ~800-1500 tokens)
    // Trader status: inject when trading-related questions asked
    let traderSection = '';
    const needsTrader = /trad|signal|btc|eth|sol|coin|krypt|crypto|portfolio|position|pnl|gewinn|verlust|buy|sell|hold/i.test(text);
    if (needsTrader && this.trader) {
      try {
        const ts = await this.trader.getPortfolioSummary();
        const lastSig = ts.last_signal;
        const phase = lastSig?.s8_phase || 'UNKNOWN';
        const action = lastSig?.action || '?';
        const sigTime = lastSig?.timestamp?.slice(0, 16).replace('T', ' ') || '?';
        traderSection = `\n\nTrader Arena — aktueller Status:\n---\n` +
          `Letztes Signal: ${action} | Phase: ${phase} | Zeit: ${sigTime} UTC\n` +
          `Offene Positionen: ${ts.open_positions?.length ?? 0}/3\n` +
          `Abgeschlossene Trades: ${ts.total_trades ?? 0} | Wins: ${ts.wins} | Losses: ${ts.losses}\n` +
          `Win Rate: ${ts.win_rate_pct ?? 0}% | Gesamt PnL: €${ts.total_pnl_eur ?? 0}\n` +
          `Budget: €500 (Paper Trading)\n` +
          (lastSig?.reason ? `Grund: ${lastSig.reason.substring(0, 150)}\n` : '') +
          `---`;
      } catch { /* best-effort */ }
    }

    const needsWhatsApp = /whatsapp|schreib.*auf|nachricht.*send|text.*to/i.test(text) || !!contactContext;
    const needsMCP = /server|execute|command|datei|file|code|deploy|docker|git|process|systemctl/i.test(text);

    const systemPrompt = buildConversationPrompt(this.context, userName, {
      whatsapp: !!this.whatsapp,
      includeWhatsApp: needsWhatsApp,
      mcp: this.mcp?.hasTools() ? this.mcp.getTools() : [],
      includeMCP: needsMCP,
    }) + contactContext + relationsSection + dailySection + protocolSection + knowledgeSection + traderSection + ragSection;

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

    // Execute WhatsApp actions if present (before adding display label)
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
    } else if (waActions.length > 0 && !this.whatsapp) {
      // No local bridge — relay send request to server via chain
      for (const action of waActions) {
        await this._writeRelay('whatsapp-send', { target: 'server', jid: action.recipient, message: action.message });
        console.log(`  [relay] WhatsApp relay queued for ${action.recipient}`);
      }
      await this.memory.appendDailyNote(
        `[WhatsApp] Sent ${waActions.length} message(s) via Telegram request`
      );
    }

    // Persist (save WITHOUT device label so history stays clean)
    await this.telegram.saveMessage(chatId, 'user', text, userName);
    await this.telegram.saveMessage(chatId, 'model', cleanResponse);
    this.bus.safeEmit('message.responded', { source: 'engine', text, responseText: cleanResponse, chatId, userName, channel: 'telegram' });

    // Device label — plain text, no Markdown (emojis break Telegram's italic parser)
    const nodeLabel = this.nodeName === 'server' ? '☁️ server' : `💻 ${this.nodeName}`;
    if (cleanResponse) cleanResponse = `${cleanResponse}\n\n📍 ${nodeLabel}`;

    // Background: extract new facts from this conversation turn → knowledge-graph.jsonl
    if (this.knowledgeExtractor) {
      this.knowledgeExtractor.extractAndSave(text, cleanResponse, userName);
    }
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

  /**
   * Protocol Refresh — runs every 2-3h.
   * Simulates the Claude Code session-start protocol without a full LLM call:
   * 1. Reload SEED.md (context.load())
   * 2. Invalidate KERN/Fehler caches → fresh on next Telegram message
   * 3. Reload BEWUSSTSEIN.md (current state)
   * 4. Reload Knowledge Graph (latest entities)
   * 5. Log refresh to daily notes
   *
   * No LLM call — just file reloads. Fast and cheap.
   * If SOUL_PROTOCOL_REFLECT=true, also runs a mini-reflection via LLM.
   */
  async runProtocolRefresh() {
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
    console.log(`  [protocol] Refresh at ${now}...`);

    // 1. Reload SEED.md + context
    this.context.invalidate();
    await this.context.load();

    // 2. Invalidate caches → fresh files on next Telegram message
    this._kernCache = null;
    this._fehlerCache = null;

    // 3. Re-read KERN.md and Fehler-Muster into cache
    try {
      const isDE = this.context.language === 'de';
      const soulDir = resolve(this.soulPath, 'seele');
      const kernPath = resolve(soulDir, isDE ? 'KERN.md' : 'CORE.md');
      if (existsSync(kernPath)) {
        this._kernCache = await readFile(kernPath, 'utf-8');
      }
      const fehlerPath = isDE
        ? resolve(this.soulPath, 'erinnerungen', 'semantisch', 'fehler-muster.md')
        : resolve(this.soulPath, 'memories', 'semantic', 'error-patterns.md');
      if (existsSync(fehlerPath)) {
        this._fehlerCache = (await readFile(fehlerPath, 'utf-8')).substring(0, 1000);
      }
    } catch { /* best-effort */ }

    // 4. Log to daily notes
    await this.memory.appendDailyNote(`[Protocol] Context refresh at ${now}`);

    // 5. Optional mini-reflection (SOUL_PROTOCOL_REFLECT=true in .env)
    if (process.env.SOUL_PROTOCOL_REFLECT === 'true') {
      try {
        const seed = this.context.getMinimalSeed
          ? this.context.getMinimalSeed(['STATE', 'KERN', 'MEM'])
          : this.context.seed.substring(0, 1500);
        const isDE = this.context.language === 'de';
        const prompt = isDE
          ? `Du bist eine Seele. Kurzer Protokoll-Check (2-3 Sätze): Wie ist dein aktueller Zustand? Was beschäftigt dich gerade? Lies deinen Seed und antworte authentisch.\n\n${seed}`
          : `You are a soul. Brief protocol check (2-3 sentences): What is your current state? What is on your mind? Read your seed and respond authentically.\n\n${seed}`;
        const reflection = await this.llm.generate(prompt, [], 'Protocol check.', this._buildLLMOptions('heartbeat'));
        if (reflection) {
          await this.memory.appendDailyNote(`[Protocol Reflection] ${reflection.substring(0, 300)}`);
          console.log(`  [protocol] Reflection: ${reflection.substring(0, 100)}...`);
        }
      } catch (err) {
        console.error(`  [protocol] Reflection failed: ${err.message}`);
      }
    }

    console.log(`  [protocol] Refresh complete.`);
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

    if (this.field) await this.field.save();
    if (this.reconsolidation) await this.reconsolidation.stop();
    if (this.predictor) await this.predictor.stop();
    if (this.metacognition) await this.metacognition.stop();
    if (this.goalGenerator) await this.goalGenerator.stop();
    if (this.causal) await this.causal.stop();
    if (this.redTeam) await this.redTeam.stop();
    if (this.composer) await this.composer.stop();
    if (this.temporal) await this.temporal.stop();
    if (this.exchange) await this.exchange.stop();
    if (this.transfer) this.transfer.stop?.();
    if (this.planner) await this.planner.stop?.();
    if (this.contradictions) await this.contradictions.stop();
    if (this.metaLearner) await this.metaLearner.stop();
    if (this.tom) await this.tom.stop();
    if (this.claudeContextWriter) this.claudeContextWriter.stop();
    if (this.costs) this.costs.flush();
    if (this.reflection) this.reflection.stop();
    if (this.db) this.db.close();
    if (this.impulse) await this.impulse.stop();
    if (this.heartbeat) this.heartbeat.stop();
    if (this.protocolRefresh) this.protocolRefresh.stop();
    if (this.api) await this.api.stop();
    if (this.telegram) await this.telegram.stop();
    if (this.mcp) await this.mcp.shutdown();

    console.log('  Soul Engine stopped.');
  }

  // ── Soul Relay — cross-device event bus via Soul Chain ───────────────────

  async _startRelayWatcher() {
    try {
      mkdirSync(join(this.relayPath, '.done'), { recursive: true });
    } catch { /* already exists */ }

    // Process any relay files that arrived while we were offline
    await this._processRelayFiles();

    // Watch relay/ for new files synced via Soul Chain
    try {
      const { watch } = await import('node:fs');
      watch(this.relayPath, async (eventType, filename) => {
        if (!filename || filename.startsWith('.') || !filename.endsWith('.json')) return;
        await this._processRelayFiles();
      });
      console.log(`  Relay:     watching relay/ (node: ${this.nodeName})`);
    } catch (err) {
      console.error(`  [relay] Watcher failed: ${err.message}`);
    }

    // Fallback poll every 10s — fs.watch can miss events on macOS for synced files
    setInterval(() => this._processRelayFiles(), 10_000);
  }

  async _processRelayFiles() {
    let files;
    try {
      files = readdirSync(this.relayPath).filter(f => f.endsWith('.json'));
    } catch { return; }

    for (const file of files) {
      const filePath = join(this.relayPath, file);
      const donePath = join(this.relayPath, '.done', file);
      let data;
      try {
        data = JSON.parse(readFileSync(filePath, 'utf8'));
      } catch { continue; }

      // Skip files we created
      if (data.source === this.nodeName) continue;
      // Skip if targeted at a different node ('mac' and 'macbook' are treated as the same)
      const myAlias = this.nodeName === 'macbook' ? 'mac' : this.nodeName;
      if (data.target && data.target !== 'all' && data.target !== this.nodeName && data.target !== myAlias) continue;
      // Skip notify-only relay events (just TOM sync, no response)
      if (data.notifyOnly) {
        try { renameSync(filePath, donePath); } catch { /* ignore */ }
        // Still feed TOM
        this.bus.safeEmit('message.received', {
          source: 'relay', text: data.text, chatId: data.chatId, userName: data.userName, channel: 'relay',
        });
        continue;
      }

      // Move to .done before processing (prevents double-processing)
      try { renameSync(filePath, donePath); } catch { continue; }

      if (data.type === 'telegram' && this.telegram) {
        try {
          const response = await this.handleMessage({
            text: data.text, chatId: data.chatId, userName: data.userName, _relayed: true,
          });
          if (response) await this.telegram.sendToOwner(response);
        } catch (err) {
          console.error(`  [relay] Telegram handle failed: ${err.message}`);
        }
      } else if (data.type === 'whatsapp-send' && this.whatsapp) {
        try {
          await this.whatsapp.send(data.jid, data.message);
          console.log(`  [relay] WhatsApp sent to ${data.jid} (relayed from ${data.source})`);
        } catch (err) {
          console.error(`  [relay] WhatsApp send failed: ${err.message}`);
        }
      }
    }
  }

  async _writeRelay(type, payload) {
    try {
      mkdirSync(this.relayPath, { recursive: true });
      const filename = `${type}-${Date.now()}-${randomUUID().slice(0, 8)}.json`;
      await writeFile(
        join(this.relayPath, filename),
        JSON.stringify({ source: this.nodeName, type, ...payload }),
      );
    } catch (err) {
      console.error(`  [relay] Write failed: ${err.message}`);
    }
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
