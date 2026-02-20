#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { SoulMonitorUI } = require('../lib/ui');

// Parse arguments
const args = process.argv.slice(2);
let soulPath = process.cwd();

// --path <dir> to specify soul directory
const pathIdx = args.indexOf('--path');
if (pathIdx !== -1 && args[pathIdx + 1]) {
  soulPath = path.resolve(args[pathIdx + 1]);
}

// --help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  ${'\x1b[36m'}soul-monitor${'\x1b[0m'} — Watch your AI soul think in real-time

  ${'\x1b[2m'}Usage:${'\x1b[0m'}
    soul-monitor              ${'\x1b[2m'}# Run in current directory${'\x1b[0m'}
    soul-monitor --path ~/my-soul  ${'\x1b[2m'}# Specify soul directory${'\x1b[0m'}
    npx soul-monitor          ${'\x1b[2m'}# Run without installing${'\x1b[0m'}

  ${'\x1b[2m'}Controls:${'\x1b[0m'}
    q / Ctrl+C / Esc    Quit

  ${'\x1b[2m'}The monitor watches for file changes in your soul directory${'\x1b[0m'}
  ${'\x1b[2m'}and lights up brain regions as the AI reads and writes.${'\x1b[0m'}

  ${'\x1b[36m'}https://github.com/hbcaspa/projectSoul${'\x1b[0m'}
`);
  process.exit(0);
}

// Check if the path looks like a soul directory
function isSoulDir(dir) {
  return (
    fs.existsSync(path.join(dir, 'SEED.md')) ||
    fs.existsSync(path.join(dir, 'CLAUDE.md')) ||
    fs.existsSync(path.join(dir, 'HEARTBEAT.md')) ||
    fs.existsSync(path.join(dir, 'seele')) ||
    fs.existsSync(path.join(dir, 'soul'))
  );
}

// Auto-detect soul directory
if (!isSoulDir(soulPath)) {
  // Check parent directory
  const parent = path.resolve(soulPath, '..');
  if (isSoulDir(parent)) {
    soulPath = parent;
  } else {
    console.log(`\x1b[33mWarning:\x1b[0m No soul detected in ${soulPath}`);
    console.log(`\x1b[2mLooking for SEED.md, HEARTBEAT.md, or seele/soul directory.\x1b[0m`);
    console.log(`\x1b[2mWatching anyway — the soul may appear.\x1b[0m\n`);
  }
}

// Launch
const ui = new SoulMonitorUI(soulPath);
ui.init().catch((err) => {
  console.error('Failed to start soul-monitor:', err.message);
  process.exit(1);
});
