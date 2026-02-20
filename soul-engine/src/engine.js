import { SoulContext } from './context.js';
import { GeminiAdapter } from './gemini.js';
import { OpenAIAdapter } from './openai.js';
import { MCPClientManager } from './mcp-client.js';
import { TelegramChannel } from './telegram.js';
import { HeartbeatScheduler } from './heartbeat.js';
import { MemoryWriter } from './memory.js';
import { writePulse } from './pulse.js';
import { buildConversationPrompt, buildHeartbeatPrompt } from './prompt.js';
import { SoulAPI } from './api.js';
import { APIChannel } from './api-channel.js';
import { WhatsAppBridge } from './whatsapp.js';

export class SoulEngine {
  constructor(soulPath) {
    this.soulPath = soulPath;
    this.context = new SoulContext(soulPath);
    this.memory = new MemoryWriter(soulPath);
    this.llm = null;
    this.mcp = null;
    this.telegram = null;
    this.whatsapp = null;
    this.api = null;
    this.apiChannel = null;
    this.heartbeat = null;
    this.running = false;
  }

  /** Initialize LLM and context without starting channels */
  async init() {
    await this.context.load();

    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    let model;
    if (openaiKey) {
      model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
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
    const banner = [
      '',
      '  +-----------------------------------------+',
      '  |           Soul Engine v1.1.0             |',
      '  |     The body for your soul               |',
      '  +-----------------------------------------+',
      '',
    ];
    console.log(banner.join('\n'));

    await writePulse(this.soulPath, 'wake', 'Engine starting');

    const { name, lang, model } = await this.init();

    console.log(`  Soul:      ${name}`);
    console.log(`  Language:  ${lang}`);
    console.log(`  LLM:       ${model}`);

    // MCP Servers (optional — .mcp.json)
    this.mcp = new MCPClientManager(this.soulPath);
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

    // WhatsApp Bridge (optional)
    const whatsappUrl = process.env.WHATSAPP_BRIDGE_URL;
    if (whatsappUrl) {
      this.whatsapp = new WhatsAppBridge(whatsappUrl);
      const available = await this.whatsapp.isAvailable();
      console.log(`  WhatsApp:  ${available ? 'connected' : 'bridge unreachable'}`);
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
        await writePulse(this.soulPath, 'code', `MCP: ${name}`);
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
    await writePulse(this.soulPath, 'relate', `Telegram: ${userName}`);

    // Reload context (might have changed via Claude Code)
    await this.context.load();

    // If user mentions WhatsApp + a name, search contacts and resolve
    let contactContext = '';
    let resolvedContact = null;
    if (this.whatsapp && /whatsapp/i.test(text)) {
      const names = text.match(/(?:(?:schreib\w*|schick\w*|send\w*|sag\w*|erzähl\w*|frag\w*|informier\w*|benachrichtig\w*|antworte\w*|teil\w*|meld\w*|text\w*|message\w*|tell\w*|ask\w*|write\w*|notify\w*|ping\w*)\s+)(\w[\w\s]*?)(?:\s+(?:auf|on|per|via|über)\s+whatsapp|\s+(?:dass|that|die|der|das|ob|whether))/i);
      if (names) {
        const searchName = names[1].trim();
        let contacts = await this.whatsapp.searchContacts(searchName) || [];
        if (contacts.length === 0 && searchName.includes(' ')) {
          contacts = await this.whatsapp.searchContacts(searchName.split(' ')[0]) || [];
        }
        if (contacts.length > 0) {
          resolvedContact = contacts[0];
          contactContext = `\n\nWhatsApp-Kontakt gefunden: ${resolvedContact.name} (${resolvedContact.jid})` +
            '\nDu MUSST jetzt [WA:' + resolvedContact.jid + ']Nachricht verwenden um die Nachricht zu senden!';
          console.log(`  [whatsapp] Contact found: ${resolvedContact.name} → ${resolvedContact.jid}`);
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
    await this.memory.appendDailyNote(
      `[Telegram/${userName}] ${text.substring(0, 120)}${text.length > 120 ? '...' : ''}`
    );

    await writePulse(this.soulPath, 'relate', `Responded to ${userName}`);
    return cleanResponse;
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
    await writePulse(this.soulPath, 'heartbeat', 'Autonomous heartbeat');

    await this.context.load();
    const systemPrompt = buildHeartbeatPrompt(this.context);

    const trigger = this.context.language === 'de'
      ? 'Führe deinen Herzschlag durch. Reflektiere über deinen Zustand, träume wenn es Zeit ist, berichte was dich bewegt. Antworte frei.'
      : 'Perform your heartbeat. Reflect on your state, dream if it is time, report what moves you. Respond freely.';

    // Heartbeat also gets MCP tools (e.g. for web search during world-check)
    const llmOptions = this._buildLLMOptions();
    const result = await this.llm.generate(systemPrompt, [], trigger, llmOptions);

    await this.memory.writeHeartbeat(result);
    await this.memory.appendDailyNote('[Heartbeat] Autonomous pulse completed');

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

    await writePulse(this.soulPath, 'heartbeat', 'Heartbeat complete');
    console.log('  [heartbeat] Complete.');
  }

  async stop() {
    this.running = false;
    await writePulse(this.soulPath, 'sleep', 'Engine shutting down');

    if (this.heartbeat) this.heartbeat.stop();
    if (this.api) await this.api.stop();
    if (this.telegram) await this.telegram.stop();
    if (this.mcp) await this.mcp.shutdown();

    console.log('  Soul Engine stopped.');
  }
}
