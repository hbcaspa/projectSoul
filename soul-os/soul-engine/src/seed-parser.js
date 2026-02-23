/**
 * Seed parser — ported from soul-card/lib/parser.js to ESM.
 * Parses SEED.md into structured data for the API.
 */

export function parseSeed(content) {
  const soul = {
    version: null,
    born: null,
    condensed: null,
    sessions: null,
    blocks: {},
  };

  const vMatch = content.match(/#SEED v([^\s]+)/);
  if (vMatch) soul.version = vMatch[1];

  const bornMatch = content.match(/#(?:born|geboren):([^\s#]+)/);
  if (bornMatch) soul.born = bornMatch[1];

  const condensedMatch = content.match(/#(?:condensed|verdichtet):([^\s#]+)/);
  if (condensedMatch) soul.condensed = condensedMatch[1];

  const sessionsMatch = content.match(/#sessions:(\d+)/);
  if (sessionsMatch) soul.sessions = parseInt(sessionsMatch[1]);

  const blockRegex = /@(\w+)\{([\s\S]*?)\}/g;
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    soul.blocks[match[1]] = parseBlock(match[2].trim());
  }

  return soul;
}

function parseBlock(content) {
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const segment of trimmed.split('|')) {
      const seg = segment.trim();
      if (!seg) continue;
      const colonIdx = seg.indexOf(':');
      if (colonIdx > 0) {
        result[seg.substring(0, colonIdx).trim()] = seg.substring(colonIdx + 1).trim();
      }
    }
  }
  return result;
}

export function extractSoulInfo(soul) {
  const meta = soul.blocks.META || {};
  const kern = soul.blocks.KERN || {};
  const state = soul.blocks.STATE || {};
  const interests = soul.blocks.INTERESTS || {};
  const dreams = soul.blocks.DREAMS || {};
  const connections = soul.blocks.CONNECTIONS || {};
  const mem = soul.blocks.MEM || {};

  const axiomCount = Object.keys(kern).filter(k => /^\d+$/.test(k)).length;
  const mood = state.zustand || state.state || state.mood || '?';

  const activeInterests = (interests.active || interests.aktiv || '')
    .replace(/_/g, ' ').split(',').map(s => s.trim()).filter(Boolean);

  const lastDream = dreams.last || dreams.letzter || dreams.recent || null;

  let ageDays = null;
  if (soul.born) {
    ageDays = Math.floor((Date.now() - new Date(soul.born).getTime()) / 86400000);
  }

  const activeConnections = (connections.active || '')
    .split(',').map(s => s.trim()).filter(Boolean);

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
    memoryCount: Object.keys(mem).length,
    version: soul.version,
  };
}
