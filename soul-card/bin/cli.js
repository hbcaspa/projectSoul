#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { parseSeed, extractSoulInfo } = require('../lib/parser');
const { renderCard, renderMarkdown } = require('../lib/card');

const args = process.argv.slice(2);
let soulPath = process.cwd();
let format = 'terminal'; // terminal | markdown

// --path <dir>
const pathIdx = args.indexOf('--path');
if (pathIdx !== -1 && args[pathIdx + 1]) {
  soulPath = path.resolve(args[pathIdx + 1]);
}

// --markdown
if (args.includes('--markdown') || args.includes('--md')) {
  format = 'markdown';
}

// --help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  \x1b[36msoul-card\x1b[0m — Generate a shareable identity card from your AI soul

  \x1b[2mUsage:\x1b[0m
    soul-card                      \x1b[2m# Terminal card from current dir\x1b[0m
    soul-card --path ~/my-soul     \x1b[2m# Specify soul directory\x1b[0m
    soul-card --markdown           \x1b[2m# Output as markdown\x1b[0m
    soul-card --markdown > card.md \x1b[2m# Save to file\x1b[0m
    npx soul-card                  \x1b[2m# Run without installing\x1b[0m

  \x1b[36mhttps://github.com/hbcaspa/projectSoul\x1b[0m
`);
  process.exit(0);
}

// Find SEED.md
const seedPath = path.join(soulPath, 'SEED.md');
if (!fs.existsSync(seedPath)) {
  // Try parent
  const parentSeed = path.join(soulPath, '..', 'SEED.md');
  if (fs.existsSync(parentSeed)) {
    soulPath = path.resolve(soulPath, '..');
  } else {
    console.error(`\x1b[31mNo SEED.md found in ${soulPath}\x1b[0m`);
    console.error(`\x1b[2mRun this in your soul directory, or use --path\x1b[0m`);
    process.exit(1);
  }
}

try {
  const soul = parseSeed(path.join(soulPath, 'SEED.md'));
  const info = extractSoulInfo(soul);

  if (format === 'markdown') {
    console.log(renderMarkdown(info));
  } else {
    console.log('');
    console.log(renderCard(info));
    console.log('');
    console.log(`  \x1b[2mTip: soul-card --markdown > card.md  to export\x1b[0m`);
    console.log('');
  }
} catch (err) {
  console.error(`\x1b[31mFailed to parse SEED.md:\x1b[0m ${err.message}`);
  process.exit(1);
}
