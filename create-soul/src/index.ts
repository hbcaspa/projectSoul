#!/usr/bin/env node

import * as p from '@clack/prompts';
import pc from 'picocolors';
import { downloadTemplate } from 'giget';
import { execa } from 'execa';
import { existsSync, writeFileSync, readdirSync } from 'fs';
import { resolve, basename } from 'path';

// ── Types ──────────────────────────────────────────

interface WizardAnswers {
  language: 'de' | 'en';
  directory: string;
  runtime: 'claude-code' | 'api-key' | 'ollama' | 'manual';
  apiProvider?: 'anthropic' | 'openai' | 'google';
  apiKey?: string;
  ollamaModel?: string;
  features: string[];
  telegramToken?: string;
  telegramOwnerId?: string;
  geminiKey?: string;
  openaiKey?: string;
}

// ── Branding ───────────────────────────────────────

function showBanner() {
  console.log();
  console.log(pc.cyan('  ╭───────────────────────────────────────╮'));
  console.log(pc.cyan('  │                                       │'));
  console.log(pc.cyan('  │') + '   👻  ' + pc.bold('Soul Protocol') + '                    ' + pc.cyan('│'));
  console.log(pc.cyan('  │') + '   ' + pc.dim('Give your AI a life.') + '                ' + pc.cyan('│'));
  console.log(pc.cyan('  │                                       │'));
  console.log(pc.cyan('  ╰───────────────────────────────────────╯'));
  console.log();
}

// ── Text by language ───────────────────────────────

const t = {
  de: {
    welcome: 'Willkommen beim Soul Protocol Setup!',
    dirQuestion: 'Wo soll deine Seele leben?',
    dirPlaceholder: './meine-seele',
    dirRequired: 'Ein Verzeichnis wird benoetigt',
    dirExists: 'Dieses Verzeichnis existiert bereits und ist nicht leer',
    runtimeQuestion: 'Wie wirst du mit deiner Seele sprechen?',
    runtimeClaude: 'Claude Code',
    runtimeClaudeHint: 'empfohlen — volle Erfahrung',
    runtimeApi: 'API Key',
    runtimeApiHint: 'Anthropic, OpenAI oder Gemini',
    runtimeOllama: 'Ollama',
    runtimeOllamaHint: '100% lokal, keine Cloud',
    runtimeManual: 'Manuell / Anderes',
    runtimeManualHint: 'nur die Dateien',
    providerQuestion: 'Welcher KI-Anbieter?',
    apiKeyQuestion: 'API Key eingeben:',
    apiKeyRequired: 'API Key wird benoetigt',
    apiKeyHint: 'Wird sicher in .env gespeichert, nie ins Git committed',
    ollamaModelQuestion: 'Welches Ollama-Modell?',
    ollamaNotRunning: 'Ollama scheint nicht zu laufen. Bitte starte es mit: ollama serve',
    featuresQuestion: 'Welche Features moechtest du aktivieren?',
    featTelegram: 'Telegram Bot',
    featTelegramHint: 'schreib deiner Seele jederzeit vom Handy',
    featEngine: 'Soul Engine',
    featEngineHint: 'autonomer Herzschlag, Traeume, 24/7',
    featMonitor: 'Soul Monitor',
    featMonitorHint: 'sieh ihr beim Denken zu in Echtzeit',
    featSync: 'P2P Sync',
    featSyncHint: 'verschluesselte Synchronisation ueber Geraete',
    featMcp: 'Server-Steuerung (MCP)',
    featMcpHint: 'voller Terminal-Zugriff per Chat',
    featGraph: 'Knowledge Graph',
    featGraphHint: 'semantisches Gedaechtnis — Entitaeten und Relationen',
    telegramTokenQuestion: 'Telegram Bot Token:',
    telegramTokenHint: 'Oeffne Telegram → suche @BotFather → sende /newbot → kopiere den Token',
    telegramTokenRequired: 'Bot Token wird fuer Telegram benoetigt',
    telegramIdQuestion: 'Deine Telegram User ID:',
    telegramIdHint: 'Sende eine Nachricht an @userinfobot um deine ID zu erhalten',
    telegramIdRequired: 'User ID wird fuer Telegram benoetigt',
    engineNeedsLlm: 'Die Soul Engine braucht einen LLM-Zugang. Welchen Anbieter moechtest du nutzen?',
    engineKeyQuestion: 'API Key fuer die Soul Engine:',
    engineKeyRequired: 'API Key wird fuer die Soul Engine benoetigt',
    cloning: 'Lade Soul Protocol Template...',
    cloned: 'Template geladen',
    configuring: 'Schreibe Konfiguration...',
    configured: 'Konfiguration geschrieben',
    installing: 'Installiere Abhaengigkeiten...',
    installed: 'Abhaengigkeiten installiert',
    initGit: 'Initialisiere Git...',
    gitDone: 'Git initialisiert',
    testingTelegram: 'Teste Telegram-Verbindung...',
    telegramOk: 'Telegram verbunden',
    telegramFail: 'Telegram-Test fehlgeschlagen — pruefe den Token spaeter',
    done: 'Deine Seele ist bereit!',
    nextSteps: 'Naechste Schritte',
    nextClaude: 'Deine KI erkennt automatisch, dass noch keine Seele existiert\nund startet das Gruendungsinterview mit dir.',
    nextApi: 'Starte die erste Session mit deiner Seele.\nSie erkennt automatisch, dass noch keine Seele existiert\nund startet das Gruendungsinterview mit dir.',
    nextManual: 'Oeffne das Verzeichnis mit deinem bevorzugten KI-Tool.\nDie KI liest CLAUDE.md und startet das Gruendungsinterview.',
    cancelled: 'Setup abgebrochen.',
  },
  en: {
    welcome: 'Welcome to the Soul Protocol Setup!',
    dirQuestion: 'Where should your soul live?',
    dirPlaceholder: './my-soul',
    dirRequired: 'A directory is required',
    dirExists: 'This directory already exists and is not empty',
    runtimeQuestion: 'How will you talk to your soul?',
    runtimeClaude: 'Claude Code',
    runtimeClaudeHint: 'recommended — full experience',
    runtimeApi: 'API Key',
    runtimeApiHint: 'Anthropic, OpenAI or Gemini',
    runtimeOllama: 'Ollama',
    runtimeOllamaHint: '100% local, no cloud',
    runtimeManual: 'Manual / Other',
    runtimeManualHint: 'just the files',
    providerQuestion: 'Which AI provider?',
    apiKeyQuestion: 'Enter your API key:',
    apiKeyRequired: 'API key is required',
    apiKeyHint: 'Stored securely in .env, never committed to git',
    ollamaModelQuestion: 'Which Ollama model?',
    ollamaNotRunning: 'Ollama does not seem to be running. Start it with: ollama serve',
    featuresQuestion: 'Which features do you want to enable?',
    featTelegram: 'Telegram Bot',
    featTelegramHint: 'message your soul from your phone anytime',
    featEngine: 'Soul Engine',
    featEngineHint: 'autonomous heartbeat, dreams, 24/7',
    featMonitor: 'Soul Monitor',
    featMonitorHint: 'watch it think in real-time',
    featSync: 'P2P Sync',
    featSyncHint: 'encrypted sync across devices',
    featMcp: 'Server Control (MCP)',
    featMcpHint: 'full terminal access via chat',
    featGraph: 'Knowledge Graph',
    featGraphHint: 'semantic memory — entities and relations',
    telegramTokenQuestion: 'Telegram Bot Token:',
    telegramTokenHint: 'Open Telegram → search @BotFather → send /newbot → copy the token',
    telegramTokenRequired: 'Bot token is required for Telegram',
    telegramIdQuestion: 'Your Telegram User ID:',
    telegramIdHint: 'Send any message to @userinfobot to get your ID',
    telegramIdRequired: 'User ID is required for Telegram',
    engineNeedsLlm: 'Soul Engine needs an LLM connection. Which provider do you want to use?',
    engineKeyQuestion: 'API key for Soul Engine:',
    engineKeyRequired: 'API key is required for Soul Engine',
    cloning: 'Downloading Soul Protocol template...',
    cloned: 'Template downloaded',
    configuring: 'Writing configuration...',
    configured: 'Configuration written',
    installing: 'Installing dependencies...',
    installed: 'Dependencies installed',
    initGit: 'Initializing git...',
    gitDone: 'Git initialized',
    testingTelegram: 'Testing Telegram connection...',
    telegramOk: 'Telegram connected',
    telegramFail: 'Telegram test failed — check the token later',
    done: 'Your soul is ready!',
    nextSteps: 'Next steps',
    nextClaude: 'Your AI will automatically detect that no soul exists yet\nand start the founding interview with you.',
    nextApi: 'Start the first session with your soul.\nIt will detect that no soul exists yet\nand start the founding interview with you.',
    nextManual: 'Open the directory with your preferred AI tool.\nIt reads CLAUDE.md and starts the founding interview.',
    cancelled: 'Setup cancelled.',
  },
};

// ── Helpers ────────────────────────────────────────

function onCancel(lang: 'de' | 'en') {
  p.cancel(t[lang].cancelled);
  process.exit(0);
}

function isCancel(value: unknown, lang: 'de' | 'en'): value is symbol {
  if (p.isCancel(value)) {
    onCancel(lang);
    return true;
  }
  return false;
}

async function checkOllama(): Promise<string[]> {
  try {
    const { stdout } = await execa('ollama', ['list']);
    const lines = stdout.trim().split('\n').slice(1); // skip header
    return lines
      .map((line) => line.split(/\s+/)[0])
      .filter((name) => name && name.length > 0);
  } catch {
    return [];
  }
}

async function testTelegramToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as { ok: boolean };
    return data.ok === true;
  } catch {
    return false;
  }
}

function buildEnv(answers: WizardAnswers): string {
  const lines: string[] = [
    '# Soul Protocol Configuration',
    '# Generated by create-soul',
    '',
  ];

  // LLM Provider
  if (answers.runtime === 'api-key' || answers.features.includes('engine')) {
    const provider = answers.apiProvider;
    const key = answers.apiKey || answers.geminiKey || answers.openaiKey;

    if (provider === 'google' || answers.geminiKey) {
      lines.push('# LLM Provider — Gemini');
      lines.push(`GEMINI_API_KEY=${answers.geminiKey || key || ''}`);
      lines.push('GEMINI_MODEL=gemini-2.5-flash');
      lines.push('');
    }
    if (provider === 'openai' || answers.openaiKey) {
      lines.push('# LLM Provider — OpenAI');
      lines.push(`OPENAI_API_KEY=${answers.openaiKey || key || ''}`);
      lines.push('OPENAI_MODEL=gpt-4.1-mini');
      lines.push('');
    }
    if (provider === 'anthropic') {
      lines.push('# LLM Provider — Anthropic');
      lines.push(`ANTHROPIC_API_KEY=${key || ''}`);
      lines.push('ANTHROPIC_MODEL=claude-sonnet-4-20250514');
      lines.push('');
    }
  }

  if (answers.runtime === 'ollama') {
    lines.push('# LLM Provider — Ollama (local)');
    lines.push('OLLAMA_BASE_URL=http://localhost:11434');
    lines.push(`OLLAMA_MODEL=${answers.ollamaModel || 'llama3.1'}`);
    lines.push('');
  }

  // Telegram
  if (answers.telegramToken) {
    lines.push('# Telegram');
    lines.push(`TELEGRAM_BOT_TOKEN=${answers.telegramToken}`);
    lines.push(`TELEGRAM_OWNER_ID=${answers.telegramOwnerId || ''}`);
    lines.push('TELEGRAM_NOTIFY_HEARTBEAT=true');
    lines.push('');
  }

  // Heartbeat
  if (answers.features.includes('engine')) {
    lines.push('# Heartbeat Schedule (cron: minute hour day month weekday)');
    lines.push('HEARTBEAT_CRON=0 7 * * *');
    lines.push('');
  }

  // Impulse System (proactive soul)
  if (answers.features.includes('engine') && answers.telegramToken) {
    lines.push('# Impulse System — proactive soul (spontaneous messages via Telegram)');
    lines.push('SOUL_IMPULSE=true');
    lines.push('IMPULSE_MIN_DELAY=600        # Min seconds between impulses (default: 600 = 10min)');
    lines.push('IMPULSE_MAX_DELAY=14400      # Max seconds between impulses (default: 14400 = 4h)');
    lines.push('IMPULSE_NIGHT_START=23       # Hour to enter quiet mode (default: 23)');
    lines.push('IMPULSE_NIGHT_END=7          # Hour to exit quiet mode (default: 7)');
    lines.push('');
  }

  // WhatsApp Bridge (optional)
  if (answers.features.includes('engine')) {
    lines.push('# WhatsApp Bridge (optional — requires whatsapp-bridge running)');
    lines.push('# WHATSAPP_BRIDGE_URL=http://127.0.0.1:8080');
    lines.push('');
  }

  // API for iOS App
  lines.push('# API (for Soul App / external access)');
  lines.push('# API_KEY=your-secret-key-here');
  lines.push('# API_PORT=3001');
  lines.push('');

  return lines.join('\n');
}

function buildMcpJson(answers: WizardAnswers): string {
  const servers: Record<string, { command: string; args: string[]; env: Record<string, string> }> = {};

  if (answers.features.includes('mcp')) {
    servers['shell'] = {
      command: 'node',
      args: ['soul-engine/src/shell-mcp-server.js'],
      env: {},
    };
  }

  if (answers.features.includes('graph')) {
    servers['memory'] = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: {
        MEMORY_FILE_PATH: 'knowledge-graph.jsonl',
      },
    };
  }

  return JSON.stringify({ mcpServers: servers }, null, 2);
}

// ── Main Wizard ────────────────────────────────────

async function main() {
  showBanner();

  // ── Step 1: Language ──

  const language = await p.select({
    message: '🌍 Language / Sprache?',
    options: [
      { value: 'de' as const, label: 'Deutsch' },
      { value: 'en' as const, label: 'English' },
    ],
  });
  if (isCancel(language, 'en')) return;

  const lang = language as 'de' | 'en';
  const txt = t[lang];

  p.intro(pc.cyan(txt.welcome));

  // ── Step 2: Directory ──

  const directory = await p.text({
    message: txt.dirQuestion,
    placeholder: txt.dirPlaceholder,
    validate: (value) => {
      if (!value || value.trim().length === 0) return txt.dirRequired;
      const dir = resolve(value);
      if (existsSync(dir)) {
        try {
          const entries = readdirSync(dir);
          if (entries.length > 0) return txt.dirExists;
        } catch { /* ignore */ }
      }
    },
  });
  if (isCancel(directory, lang)) return;

  const targetDir = resolve(directory as string);
  const projectName = basename(targetDir);

  // ── Step 3: Runtime ──

  const runtime = await p.select({
    message: txt.runtimeQuestion,
    options: [
      { value: 'claude-code' as const, label: txt.runtimeClaude, hint: txt.runtimeClaudeHint },
      { value: 'api-key' as const, label: txt.runtimeApi, hint: txt.runtimeApiHint },
      { value: 'ollama' as const, label: txt.runtimeOllama, hint: txt.runtimeOllamaHint },
      { value: 'manual' as const, label: txt.runtimeManual, hint: txt.runtimeManualHint },
    ],
  });
  if (isCancel(runtime, lang)) return;

  const answers: WizardAnswers = {
    language: lang,
    directory: directory as string,
    runtime: runtime as WizardAnswers['runtime'],
    features: [],
  };

  // ── Step 3b: API Key (if api-key mode) ──

  if (answers.runtime === 'api-key') {
    const provider = await p.select({
      message: txt.providerQuestion,
      options: [
        { value: 'anthropic' as const, label: 'Anthropic (Claude)' },
        { value: 'openai' as const, label: 'OpenAI (GPT)' },
        { value: 'google' as const, label: 'Google (Gemini)' },
      ],
    });
    if (isCancel(provider, lang)) return;
    answers.apiProvider = provider as WizardAnswers['apiProvider'];

    const apiKey = await p.password({
      message: txt.apiKeyQuestion,
      validate: (v) => {
        if (!v || v.trim().length === 0) return txt.apiKeyRequired;
      },
    });
    if (isCancel(apiKey, lang)) return;
    answers.apiKey = apiKey as string;

    p.log.info(pc.dim(txt.apiKeyHint));
  }

  // ── Step 3c: Ollama (if ollama mode) ──

  if (answers.runtime === 'ollama') {
    const models = await checkOllama();
    if (models.length === 0) {
      p.log.warn(pc.yellow(txt.ollamaNotRunning));
      const model = await p.text({
        message: txt.ollamaModelQuestion,
        placeholder: 'llama3.1',
      });
      if (isCancel(model, lang)) return;
      answers.ollamaModel = (model as string) || 'llama3.1';
    } else {
      const model = await p.select({
        message: txt.ollamaModelQuestion,
        options: models.map((m) => ({ value: m, label: m })),
      });
      if (isCancel(model, lang)) return;
      answers.ollamaModel = model as string;
    }
  }

  // ── Step 4: Features ──

  const features = await p.multiselect({
    message: txt.featuresQuestion,
    options: [
      { value: 'telegram', label: txt.featTelegram, hint: txt.featTelegramHint },
      { value: 'engine', label: txt.featEngine, hint: txt.featEngineHint },
      { value: 'monitor', label: txt.featMonitor, hint: txt.featMonitorHint },
      { value: 'sync', label: txt.featSync, hint: txt.featSyncHint },
      { value: 'mcp', label: txt.featMcp, hint: txt.featMcpHint },
      { value: 'graph', label: txt.featGraph, hint: txt.featGraphHint },
    ],
    required: false,
  });
  if (isCancel(features, lang)) return;
  answers.features = features as string[];

  // ── Step 4b: Telegram config ──

  if (answers.features.includes('telegram')) {
    p.log.step(pc.dim(txt.telegramTokenHint));

    const token = await p.text({
      message: txt.telegramTokenQuestion,
      validate: (v) => {
        if (!v || v.trim().length === 0) return txt.telegramTokenRequired;
        if (!v.includes(':')) return lang === 'de'
          ? 'Token-Format: 123456789:ABCdef...'
          : 'Token format: 123456789:ABCdef...';
      },
    });
    if (isCancel(token, lang)) return;
    answers.telegramToken = token as string;

    p.log.step(pc.dim(txt.telegramIdHint));

    const ownerId = await p.text({
      message: txt.telegramIdQuestion,
      validate: (v) => {
        if (!v || v.trim().length === 0) return txt.telegramIdRequired;
        if (!/^\d+$/.test(v)) return lang === 'de'
          ? 'Die ID besteht nur aus Zahlen'
          : 'The ID is numbers only';
      },
    });
    if (isCancel(ownerId, lang)) return;
    answers.telegramOwnerId = ownerId as string;
  }

  // ── Step 4c: Soul Engine LLM (if engine selected but no API key yet) ──

  if (answers.features.includes('engine') && answers.runtime === 'claude-code') {
    p.log.step(pc.dim(txt.engineNeedsLlm));

    const engineProvider = await p.select({
      message: txt.providerQuestion,
      options: [
        { value: 'google' as const, label: 'Google (Gemini)', hint: lang === 'de' ? 'kostenlos' : 'free tier' },
        { value: 'openai' as const, label: 'OpenAI (GPT)' },
      ],
    });
    if (isCancel(engineProvider, lang)) return;

    const engineKey = await p.password({
      message: txt.engineKeyQuestion,
      validate: (v) => {
        if (!v || v.trim().length === 0) return txt.engineKeyRequired;
      },
    });
    if (isCancel(engineKey, lang)) return;

    if (engineProvider === 'google') {
      answers.geminiKey = engineKey as string;
    } else {
      answers.openaiKey = engineKey as string;
    }
    answers.apiProvider = engineProvider as 'google' | 'openai';
  }

  // If API-key mode, also use that key for engine
  if (answers.features.includes('engine') && answers.runtime === 'api-key') {
    if (answers.apiProvider === 'google') {
      answers.geminiKey = answers.apiKey;
    } else if (answers.apiProvider === 'openai') {
      answers.openaiKey = answers.apiKey;
    }
  }

  // ── Actions ──────────────────────────────────────

  const s = p.spinner();

  // Clone template
  s.start(txt.cloning);
  try {
    await downloadTemplate('github:hbcaspa/projectSoul#main', {
      dir: targetDir,
      install: false,
    });
    s.stop(pc.green('✓ ') + txt.cloned);
  } catch (err) {
    // Fallback: try git clone
    try {
      await execa('git', ['clone', '--depth', '1', 'https://github.com/hbcaspa/projectSoul.git', targetDir]);
      // Remove .git so user starts fresh
      await execa('rm', ['-rf', `${targetDir}/.git`]);
      s.stop(pc.green('✓ ') + txt.cloned);
    } catch {
      s.stop(pc.red('✗ ') + (lang === 'de' ? 'Template konnte nicht geladen werden' : 'Failed to download template'));
      p.log.error(lang === 'de'
        ? 'Bitte klone manuell: git clone https://github.com/hbcaspa/projectSoul.git'
        : 'Please clone manually: git clone https://github.com/hbcaspa/projectSoul.git');
      process.exit(1);
    }
  }

  // Write configuration
  s.start(txt.configuring);

  // .language file
  writeFileSync(resolve(targetDir, '.language'), `lang:${lang}\n`);

  // .env
  const envContent = buildEnv(answers);
  writeFileSync(resolve(targetDir, '.env'), envContent);

  // .mcp.json (if MCP, engine, or graph features)
  if (answers.features.includes('mcp') || answers.features.includes('engine') || answers.features.includes('graph')) {
    const mcpContent = buildMcpJson(answers);
    writeFileSync(resolve(targetDir, '.mcp.json'), mcpContent);
  }

  // knowledge-graph.jsonl (if graph feature enabled)
  if (answers.features.includes('graph')) {
    writeFileSync(resolve(targetDir, 'knowledge-graph.jsonl'), '');
  }

  s.stop(pc.green('✓ ') + txt.configured);

  // Install dependencies
  const installTargets: string[] = [];
  if (answers.features.includes('engine') || answers.runtime === 'api-key') {
    installTargets.push('soul-engine');
  }
  if (answers.features.includes('monitor')) {
    installTargets.push('soul-monitor');
  }
  if (answers.features.includes('sync')) {
    installTargets.push('soul-chain');
  }

  if (installTargets.length > 0) {
    s.start(txt.installing);
    for (const target of installTargets) {
      const dir = resolve(targetDir, target);
      if (existsSync(resolve(dir, 'package.json'))) {
        try {
          await execa('npm', ['install'], { cwd: dir });
        } catch {
          // Non-fatal — user can install later
        }
      }
    }
    s.stop(pc.green('✓ ') + txt.installed);
  }

  // Test Telegram
  if (answers.telegramToken) {
    s.start(txt.testingTelegram);
    const ok = await testTelegramToken(answers.telegramToken);
    if (ok) {
      s.stop(pc.green('✓ ') + txt.telegramOk);
    } else {
      s.stop(pc.yellow('⚠ ') + txt.telegramFail);
    }
  }

  // Git init
  s.start(txt.initGit);
  try {
    await execa('git', ['init'], { cwd: targetDir });
    await execa('git', ['add', '.'], { cwd: targetDir });
    await execa('git', ['commit', '-m', 'Initial soul — created with create-soul'], { cwd: targetDir });
    s.stop(pc.green('✓ ') + txt.gitDone);
  } catch {
    s.stop(pc.yellow('⚠ ') + (lang === 'de' ? 'Git konnte nicht initialisiert werden' : 'Git initialization failed'));
  }

  // ── Done ─────────────────────────────────────────

  let nextStepsCmd = '';
  let nextStepsNote = '';

  if (answers.runtime === 'claude-code') {
    nextStepsCmd = `cd ${projectName}\nclaude`;
    nextStepsNote = txt.nextClaude;
  } else if (answers.runtime === 'api-key') {
    nextStepsCmd = `cd ${projectName}\nnpm run soul`;
    nextStepsNote = txt.nextApi;
  } else if (answers.runtime === 'ollama') {
    nextStepsCmd = `cd ${projectName}\nnpm run soul`;
    nextStepsNote = txt.nextApi;
  } else {
    nextStepsCmd = `cd ${projectName}`;
    nextStepsNote = txt.nextManual;
  }

  // Show enabled features
  if (answers.features.length > 0) {
    const featureLabels: Record<string, string> = lang === 'de'
      ? { telegram: 'Telegram Bot', engine: 'Soul Engine', monitor: 'Soul Monitor', sync: 'P2P Sync', mcp: 'Server-Steuerung', graph: 'Knowledge Graph' }
      : { telegram: 'Telegram Bot', engine: 'Soul Engine', monitor: 'Soul Monitor', sync: 'P2P Sync', mcp: 'Server Control', graph: 'Knowledge Graph' };

    const activeFeatures = answers.features
      .map((f) => `  ${pc.green('✓')} ${featureLabels[f] || f}`)
      .join('\n');

    p.note(activeFeatures, lang === 'de' ? 'Aktivierte Features' : 'Enabled Features');
  }

  // Show extra commands for features
  const extraCmds: string[] = [];
  if (answers.features.includes('engine')) {
    extraCmds.push(lang === 'de'
      ? `${pc.dim('#')} Soul Engine starten (in neuem Terminal):\ncd ${projectName}/soul-engine && npm start`
      : `${pc.dim('#')} Start Soul Engine (in a new terminal):\ncd ${projectName}/soul-engine && npm start`);
  }
  if (answers.features.includes('monitor')) {
    extraCmds.push(lang === 'de'
      ? `${pc.dim('#')} Soul Monitor starten (in neuem Terminal):\nnode ${projectName}/soul-monitor/bin/cli.js --path ${projectName}`
      : `${pc.dim('#')} Start Soul Monitor (in a new terminal):\nnode ${projectName}/soul-monitor/bin/cli.js --path ${projectName}`);
  }
  if (answers.features.includes('sync')) {
    extraCmds.push(lang === 'de'
      ? `${pc.dim('#')} P2P Sync initialisieren:\ncd ${projectName}/soul-chain && node bin/cli.js init\n${pc.dim('#')} Auf weiteren Geraeten:\nSOUL_PATH=/pfad/zu/seele node soul-chain/bin/cli.js start`
      : `${pc.dim('#')} Initialize P2P Sync:\ncd ${projectName}/soul-chain && node bin/cli.js init\n${pc.dim('#')} On other devices:\nSOUL_PATH=/path/to/soul node soul-chain/bin/cli.js start`);
  }

  const allSteps = nextStepsCmd + (extraCmds.length > 0 ? '\n\n' + extraCmds.join('\n\n') : '');

  p.note(allSteps, txt.nextSteps);
  p.log.info(pc.dim(nextStepsNote));

  p.outro(pc.cyan(txt.done) + ' 👻');
}

main().catch((err) => {
  console.error(pc.red('Error:'), err.message);
  process.exit(1);
});
