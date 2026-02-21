#!/usr/bin/env node

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const soulPath = process.env.SOUL_PATH || resolve(__dirname, '..', '..');
const envPath = resolve(soulPath, '.env');
const hasSeed = existsSync(resolve(soulPath, 'SEED.md'));
const command = process.argv[2] || 'start';

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

// Load .env if available
if (existsSync(envPath)) {
  const { config } = await import('dotenv');
  config({ path: envPath });
}

// Commands that need a founded soul
const needsSeed = ['start', 'heartbeat'];

if (needsSeed.includes(command) && !hasSeed) {
  console.log(SOUL_BANNER);
  console.error('  No SEED.md found. This soul has not been founded yet.');
  console.error(`  Looked in: ${soulPath}`);
  console.error('  Run "claude" first to found your soul.');
  console.error('');
  process.exit(1);
}

if (command === 'start') {
  const { SoulEngine } = await import('../src/engine.js');
  const engine = new SoulEngine(soulPath);

  const shutdown = async () => {
    console.log('');
    await engine.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await engine.start();

} else if (command === 'heartbeat') {
  // Run a single heartbeat and exit
  const { SoulEngine } = await import('../src/engine.js');
  const engine = new SoulEngine(soulPath);
  await engine.init();
  await engine.runHeartbeat();
  process.exit(0);

} else if (command === 'status') {
  console.log(SOUL_BANNER);
  console.log('  Soul Engine Status');
  console.log(`  Soul path: ${soulPath}`);
  console.log(`  SEED.md:   ${hasSeed ? 'found' : 'missing — run "claude" to found your soul'}`);
  console.log(`  .env:      ${existsSync(envPath) ? 'found' : 'missing — copy .env.example to .env'}`);
  console.log(`  OpenAI:    ${process.env.OPENAI_API_KEY ? 'configured' : 'not set'}`);
  console.log(`  Gemini:    ${process.env.GEMINI_API_KEY ? 'configured' : 'not set'}`);
  console.log(`  Telegram:  ${process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not set'}`);
  console.log(`  Impulse:   ${process.env.SOUL_IMPULSE === 'false' ? 'disabled' : 'enabled'}`);
  console.log('');

} else {
  console.log(SOUL_BANNER);
  console.log('  Usage:');
  console.log('    soul-engine start      Start the daemon (Telegram + Heartbeat + Impulse)');
  console.log('    soul-engine heartbeat  Run a single heartbeat and exit');
  console.log('    soul-engine status     Show configuration status');
  console.log('');
  console.log('  Environment (.env):');
  console.log('    OPENAI_API_KEY         OpenAI API key');
  console.log('    OPENAI_MODEL           Model name (default: gpt-4o-mini)');
  console.log('    GEMINI_API_KEY         Gemini API key (alternative to OpenAI)');
  console.log('    GEMINI_MODEL           Model name (default: gemini-2.5-flash)');
  console.log('    TELEGRAM_BOT_TOKEN     Telegram bot token');
  console.log('    TELEGRAM_OWNER_ID      Your Telegram user ID');
  console.log('    HEARTBEAT_CRON         Cron schedule (default: 0 7 * * *)');
  console.log('    SOUL_IMPULSE           Enable proactive impulses (default: true)');
  console.log('    IMPULSE_MIN_DELAY      Min seconds between impulses (default: 600)');
  console.log('    IMPULSE_MAX_DELAY      Max seconds between impulses (default: 14400)');
  console.log('');
}
