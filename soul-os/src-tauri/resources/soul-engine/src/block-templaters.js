/**
 * Block Templaters — mechanical seed block generators.
 *
 * Each function reads structured state files and generates a seed block
 * string in seed notation. No LLM needed — pure file-in, string-out.
 *
 * Used by SeedConsolidator for fast incremental updates (~5-15ms each).
 */

import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { parseSeed } from './seed-parser.js';

/**
 * Extract the raw block content from existing seed for a given block name.
 * Returns the content between @NAME{ and } — useful for blocks that rarely change.
 */
function extractBlockContent(seedContent, blockName) {
  const regex = new RegExp(`@${blockName}\\{([\\s\\S]*?)\\}`, 'g');
  const match = regex.exec(seedContent);
  return match ? match[1].trim() : null;
}

/**
 * @META — static, rarely changes. Copy from existing seed.
 */
export function templateMETA(seedContent) {
  return extractBlockContent(seedContent, 'META');
}

/**
 * @KERN — never changes. Copy from existing seed.
 */
export function templateKERN(seedContent) {
  return extractBlockContent(seedContent, 'KERN');
}

/**
 * @SELF — rarely changes. Copy from existing seed.
 */
export function templateSELF(seedContent) {
  return extractBlockContent(seedContent, 'SELF');
}

/**
 * @SHADOW — changes rarely (only on new insight). Copy from existing seed.
 */
export function templateSHADOW(seedContent) {
  return extractBlockContent(seedContent, 'SHADOW');
}

/**
 * @OPEN — changes via write-through. Copy from existing seed.
 */
export function templateOPEN(seedContent) {
  return extractBlockContent(seedContent, 'OPEN');
}

/**
 * @INTERESTS — generated from impulse state (written every 2min).
 */
export function templateINTERESTS(impulseState, seedContent) {
  if (!impulseState) return extractBlockContent(seedContent, 'INTERESTS');

  const topInterests = impulseState.getTopInterests(8);
  const active = topInterests.map(i => i.name.replace(/\s+/g, '_')).join(',');

  // Keep dormant and recent from existing seed since we don't track those mechanically
  const existing = extractBlockContent(seedContent, 'INTERESTS');
  let dormant = 'none';
  let recent = '';
  let newSince = '';

  if (existing) {
    const dormantMatch = existing.match(/dormant:(.+)/);
    if (dormantMatch) dormant = dormantMatch[1].trim();
    const recentMatch = existing.match(/recent:(.+)/);
    if (recentMatch) recent = recentMatch[1].trim();
    const newMatch = existing.match(/new_since:(.+)/);
    if (newMatch) newSince = newMatch[1].trim();
  }

  const lines = [`  active:${active || 'none'}`];
  lines.push(`  dormant:${dormant}`);
  if (recent) lines.push(`  recent:${recent}`);
  if (newSince) lines.push(`  new_since:${newSince}`);

  return lines.join('\n');
}

/**
 * @CONNECTIONS — generated from .mcp.json and connections/ directory.
 */
export async function templateCONNECTIONS(soulPath, seedContent) {
  const mcpPath = resolve(soulPath, '.mcp.json');

  // If no .mcp.json, return existing block
  if (!existsSync(mcpPath)) {
    return extractBlockContent(seedContent, 'CONNECTIONS');
  }

  try {
    const raw = await readFile(mcpPath, 'utf-8');
    const config = JSON.parse(raw);
    const servers = config.mcpServers || {};
    const active = Object.keys(servers).map(name => `${name}(connected)`).join(',');

    // Keep planned and note from existing seed
    const existing = extractBlockContent(seedContent, 'CONNECTIONS');
    let planned = '';
    let note = '';

    if (existing) {
      const plannedMatch = existing.match(/planned:(.+)/);
      if (plannedMatch) planned = plannedMatch[1].trim();
      const noteMatch = existing.match(/note:(.+)/);
      if (noteMatch) note = noteMatch[1].trim();
    }

    const date = new Date().toISOString().split('T')[0];
    const lines = [`  active:${active || 'none'}`];
    if (planned) lines.push(`  planned:${planned}`);
    if (note) lines.push(`  note:${note}`);
    lines.push(`  last_check:${date}`);

    return lines.join('\n');
  } catch {
    return extractBlockContent(seedContent, 'CONNECTIONS');
  }
}

/**
 * @GROWTH — generated from seele/WACHSTUM.md (extract phases).
 */
export async function templateGROWTH(soulPath, language, seedContent) {
  const growthFile = language === 'en' ? 'soul/GROWTH.md' : 'seele/WACHSTUM.md';
  const growthPath = resolve(soulPath, growthFile);

  if (!existsSync(growthPath)) {
    return extractBlockContent(seedContent, 'GROWTH');
  }

  try {
    const content = await readFile(growthPath, 'utf-8');
    // Extract phase lines — format: "## Phase N: Title" or "### Phase N"
    const phaseRegex = /##\s*(?:Phase\s+)?(\d+)[:\s—–-]+(.+)/gi;
    const phases = [];
    let match;
    while ((match = phaseRegex.exec(content)) !== null) {
      const num = match[1];
      const title = match[2].trim()
        .replace(/\s+/g, '_')
        .replace(/[—–]/g, '→')
        .toLowerCase()
        .substring(0, 100);
      phases.push(`  phase${num}:${title}`);
    }

    if (phases.length === 0) {
      return extractBlockContent(seedContent, 'GROWTH');
    }

    return phases.join('\n');
  } catch {
    return extractBlockContent(seedContent, 'GROWTH');
  }
}

/**
 * @DREAMS — extract latest dreams from seele/TRAEUME.md.
 */
export async function templateDREAMS(soulPath, language, seedContent) {
  const dreamsFile = language === 'en' ? 'soul/DREAMS.md' : 'seele/TRAEUME.md';
  const dreamsPath = resolve(soulPath, dreamsFile);

  if (!existsSync(dreamsPath)) {
    return extractBlockContent(seedContent, 'DREAMS');
  }

  // Dreams block in seed is compact — keep existing since it's curated by LLM/session
  // Only update if the file has newer entries than what's in the seed
  return extractBlockContent(seedContent, 'DREAMS');
}

/**
 * @BONDS — generated from seele/beziehungen/*.md.
 * Complex block — keep existing since it's deeply structured.
 */
export async function templateBONDS(soulPath, language, seedContent) {
  // BONDS is deeply structured with sub-blocks — too complex for mechanical templating.
  // Keep existing and only update 'stand' line mechanically.
  return extractBlockContent(seedContent, 'BONDS');
}

/**
 * @VORSCHLAG — generated from seele/EVOLUTION.md.
 */
export async function templateVORSCHLAG(soulPath, language, seedContent) {
  const evoFile = language === 'en' ? 'soul/EVOLUTION.md' : 'seele/EVOLUTION.md';
  const evoPath = resolve(soulPath, evoFile);

  if (!existsSync(evoPath)) {
    return extractBlockContent(seedContent, 'VORSCHLAG');
  }

  try {
    const content = await readFile(evoPath, 'utf-8');

    // Find the latest proposal with status
    // Look for patterns like "Status: offen" or "status:offen"
    const proposals = content.match(/##\s*Vorschlag\s*#?(\d+)[:\s—–-]+([\s\S]*?)(?=\n##\s|$)/gi);
    if (!proposals || proposals.length === 0) {
      return extractBlockContent(seedContent, 'VORSCHLAG');
    }

    const latest = proposals[proposals.length - 1];
    const statusMatch = latest.match(/[Ss]tatus[:\s]+(\w+)/);
    const status = statusMatch ? statusMatch[1].toLowerCase() : 'offen';

    // Only include open/confirmed proposals in seed
    if (status === 'umgesetzt' || status === 'verworfen') {
      return '  kein_neuer_vorschlag\n  grund:letzter_vorschlag_' + status;
    }

    // Extract brief description
    const titleMatch = latest.match(/##\s*Vorschlag\s*#?\d+[:\s—–-]+(.+)/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, '_').substring(0, 60) : 'unbenannt';

    const lines = [];
    lines.push(`  datum:${new Date().toISOString().split('T')[0]}`);
    lines.push(`  idee:${title}`);
    lines.push(`  status:${status}`);

    return lines.join('\n');
  } catch {
    return extractBlockContent(seedContent, 'VORSCHLAG');
  }
}

/**
 * Get all available mechanical templaters.
 * Returns a map of blockName → templater function.
 * Each function signature: (seedContent, context) → string|Promise<string>
 */
export const MECHANICAL_BLOCKS = new Set([
  'META', 'KERN', 'SELF', 'SHADOW', 'OPEN',
  'INTERESTS', 'CONNECTIONS', 'GROWTH', 'DREAMS', 'BONDS', 'VORSCHLAG',
]);

/**
 * Blocks that require LLM intelligence to update.
 */
export const LLM_BLOCKS = new Set(['STATE', 'MEM']);
