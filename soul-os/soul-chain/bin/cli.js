#!/usr/bin/env node

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SoulChain } from '../src/chain.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const soulPath = process.env.SOUL_PATH || resolve(__dirname, '..', '..');

const command = process.argv[2];
const arg = process.argv.slice(3).join(' ');

async function main() {
  const chain = new SoulChain(soulPath);

  switch (command) {
    case 'init': {
      const { mnemonic, existing } = await chain.init();

      if (existing) {
        console.log('');
        console.log('  Chain already exists. Your soul token:');
      } else {
        console.log('');
        console.log('  Soul Chain initialized!');
        console.log('  Your soul token (keep this safe — it IS your soul):');
      }

      printToken(mnemonic);

      console.log('  Enter this token on other devices to sync.');
      console.log('  Then run: soul-chain start');
      console.log('');
      break;
    }

    case 'join': {
      if (!arg) {
        console.error('  Usage: soul-chain join "word1 word2 word3 ..."');
        process.exit(1);
      }

      try {
        await chain.join(arg);
        console.log('');
        console.log('  Joined the chain. Run: soul-chain start');
        console.log('');
      } catch (err) {
        console.error(`  Error: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'start': {
      // Allow inline token: soul-chain start --token "..."
      if (arg.startsWith('--token ')) {
        const token = arg.replace('--token ', '').replace(/"/g, '').trim();
        await chain.join(token);
      }

      const banner = [
        '',
        '  +-----------------------------------------+',
        '  |          Soul Chain v1.0.0               |',
        '  |  P2P encrypted sync — no server needed   |',
        '  +-----------------------------------------+',
        '',
      ];
      console.log(banner.join('\n'));

      const shutdown = async () => {
        console.log('');
        await chain.stop();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      try {
        await chain.start();
        console.log(`  Soul path: ${soulPath}`);
        console.log(`  Peers:     waiting for connections...`);
        console.log('');
        console.log('  Soul Chain is alive. Press Ctrl+C to stop.');
        console.log('');
      } catch (err) {
        console.error(`  Error: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'status': {
      const { existsSync } = await import('fs');
      const configPath = resolve(soulPath, '.soul-chain');
      const hasChain = existsSync(configPath);

      console.log('');
      console.log('  Soul Chain Status');
      console.log(`  Soul path: ${soulPath}`);
      console.log(`  Chain:     ${hasChain ? 'configured' : 'not initialized'}`);

      if (hasChain) {
        const { readFileSync } = await import('fs');
        const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
        const words = cfg.mnemonic.split(' ');
        console.log(`  Token:     ${words.slice(0, 3).join(' ')} ... (${words.length} words)`);
        console.log(`  Since:     ${cfg.created || cfg.joined}`);
      }
      console.log('');
      break;
    }

    default:
      console.log('');
      console.log('  Soul Chain — P2P encrypted sync for your soul');
      console.log('');
      console.log('  Usage:');
      console.log('    soul-chain init                  Create a new chain + soul token');
      console.log('    soul-chain join "word1 word2..."  Join a chain with a token');
      console.log('    soul-chain start                 Start syncing with peers');
      console.log('    soul-chain status                Show chain status');
      console.log('');
      console.log('  How it works:');
      console.log('    1. Run "soul-chain init" on your first device');
      console.log('    2. Note down your 16-word soul token');
      console.log('    3. Run "soul-chain join" on other devices');
      console.log('    4. Run "soul-chain start" on all devices');
      console.log('    5. Soul files sync automatically, encrypted, P2P');
      console.log('');
  }
}

function printToken(mnemonic) {
  const words = mnemonic.split(' ');
  console.log('');
  console.log('  +------------------------------------------+');
  for (let i = 0; i < words.length; i += 4) {
    const row = words.slice(i, i + 4).map((w) => w.padEnd(8)).join(' ');
    console.log(`  |  ${row}  |`);
  }
  console.log('  +------------------------------------------+');
  console.log('');
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
