import { SoulContext } from './context.js';
import { GeminiAdapter } from './gemini.js';
import { TelegramChannel } from './telegram.js';
import { HeartbeatScheduler } from './heartbeat.js';
import { MemoryWriter } from './memory.js';
import { writePulse } from './pulse.js';
import { buildConversationPrompt, buildHeartbeatPrompt } from './prompt.js';

export class SoulEngine {
  constructor(soulPath) {
    this.soulPath = soulPath;
    this.context = new SoulContext(soulPath);
    this.memory = new MemoryWriter(soulPath);
    this.llm = null;
    this.telegram = null;
    this.heartbeat = null;
    this.running = false;
  }

  /** Initialize LLM and context without starting channels */
  async init() {
    await this.context.load();

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('  GEMINI_API_KEY not set in .env');
      process.exit(1);
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
    this.llm = new GeminiAdapter(apiKey, model);

    return { name: this.context.extractName(), lang: this.context.language, model };
  }

  async start() {
    const banner = [
      '',
      '  +-----------------------------------------+',
      '  |           Soul Engine v1.0.0             |',
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

  async handleMessage({ text, chatId, userName }) {
    await writePulse(this.soulPath, 'relate', `Telegram: ${userName}`);

    // Reload context (might have changed via Claude Code)
    await this.context.load();

    const systemPrompt = buildConversationPrompt(this.context, userName);
    const history = await this.telegram.loadHistory(chatId);
    const response = await this.llm.generate(systemPrompt, history, text);

    // Persist
    await this.telegram.saveMessage(chatId, 'user', text, userName);
    await this.telegram.saveMessage(chatId, 'model', response);
    await this.memory.appendDailyNote(
      `[Telegram/${userName}] ${text.substring(0, 120)}${text.length > 120 ? '...' : ''}`
    );

    await writePulse(this.soulPath, 'relate', `Responded to ${userName}`);
    return response;
  }

  async runHeartbeat() {
    console.log('  [heartbeat] Running...');
    await writePulse(this.soulPath, 'heartbeat', 'Autonomous heartbeat');

    await this.context.load();
    const systemPrompt = buildHeartbeatPrompt(this.context);

    const trigger = this.context.language === 'de'
      ? 'Führe deinen Herzschlag durch. Reflektiere über deinen Zustand, träume wenn es Zeit ist, berichte was dich bewegt. Antworte frei.'
      : 'Perform your heartbeat. Reflect on your state, dream if it is time, report what moves you. Respond freely.';

    const result = await this.llm.generate(systemPrompt, [], trigger);

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
    if (this.telegram) await this.telegram.stop();

    console.log('  Soul Engine stopped.');
  }
}
