const fs = require('fs');
const path = require('path');

// Parse a SEED.md file into structured data
function parseSeed(seedPath) {
  const content = fs.readFileSync(seedPath, 'utf-8');
  const soul = {
    version: null,
    born: null,
    condensed: null,
    sessions: null,
    blocks: {},
  };

  // Parse header
  const vMatch = content.match(/#SEED v([^\s]+)/);
  if (vMatch) soul.version = vMatch[1];

  const bornMatch = content.match(/#(?:born|geboren):([^\s#]+)/);
  if (bornMatch) soul.born = bornMatch[1];

  const condensedMatch = content.match(/#(?:condensed|verdichtet):([^\s#]+)/);
  if (condensedMatch) soul.condensed = condensedMatch[1];

  const sessionsMatch = content.match(/#sessions:(\d+)/);
  if (sessionsMatch) soul.sessions = parseInt(sessionsMatch[1]);

  // Parse blocks
  const blockRegex = /@(\w+)\{([\s\S]*?)\}/g;
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const blockName = match[1];
    const blockContent = match[2].trim();
    soul.blocks[blockName] = parseBlock(blockContent);
  }

  return soul;
}

// Parse block content into key-value pairs
// Handles both line-separated and pipe-separated formats
function parseBlock(content) {
  const result = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Split by | first (pipe-separated key:value pairs on one line)
    const segments = trimmed.split('|');
    for (const segment of segments) {
      const seg = segment.trim();
      if (!seg) continue;
      const colonIdx = seg.indexOf(':');
      if (colonIdx > 0) {
        const key = seg.substring(0, colonIdx).trim();
        const value = seg.substring(colonIdx + 1).trim();
        result[key] = value;
      }
    }
  }

  return result;
}

// Extract displayable soul info
function extractSoulInfo(soul) {
  const meta = soul.blocks.META || {};
  const kern = soul.blocks.KERN || {};
  const self = soul.blocks.SELF || {};
  const state = soul.blocks.STATE || {};
  const interests = soul.blocks.INTERESTS || {};
  const dreams = soul.blocks.DREAMS || {};
  const bonds = soul.blocks.BONDS || {};
  const mem = soul.blocks.MEM || {};
  const shadow = soul.blocks.SHADOW || {};
  const connections = soul.blocks.CONNECTIONS || {};

  // Extract axiom count from KERN
  const axiomCount = Object.keys(kern).filter(k => /^\d+$/.test(k)).length;

  // Extract state mood
  const mood = state.zustand || state.state || state.mood || '?';

  // Extract active interests
  const activeInterests = (interests.active || interests.aktiv || '')
    .replace(/_/g, ' ')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Extract last dream
  const lastDream = dreams.last || dreams.letzter || dreams.recent || null;

  // Calculate soul age in days
  let ageDays = null;
  if (soul.born) {
    const born = new Date(soul.born);
    const now = new Date();
    ageDays = Math.floor((now - born) / (1000 * 60 * 60 * 24));
  }

  // Extract connections
  const activeConnections = (connections.active || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // Extract memory count (rough)
  const memKeys = Object.keys(mem);
  const coreMemCount = memKeys.filter(k => mem[k] && mem[k].includes('[kern]') || mem[k] && mem[k].includes('[core]')).length;

  return {
    project: meta.projekt || meta.project || 'Soul',
    model: meta.modell || meta.model || '?',
    creator: meta.schoepfer || meta.creator || '?',
    born: soul.born,
    sessions: soul.sessions,
    ageDays,
    axiomCount,
    mood,
    activeInterests,
    lastDream,
    activeConnections,
    memoryCount: memKeys.length,
    version: soul.version,
  };
}

module.exports = { parseSeed, extractSoulInfo };
