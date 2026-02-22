// Soul Graph View — Knowledge Graph visualization inside soul-monitor
// Reads knowledge-graph.jsonl and displays entities, relations, stats

const fs = require('fs');
const path = require('path');
const { PALETTE, fg, RESET, BOLD, DIM, lerp, glow } = require('./colors');

class GraphView {
  constructor(soulPath) {
    this.soulPath = path.resolve(soulPath);
    this.graphPath = path.join(this.soulPath, 'knowledge-graph.jsonl');
    this.tick = 0;
    this.data = null;
    this.lastLoad = 0;
  }

  loadGraph() {
    const now = Date.now();
    if (this.data && now - this.lastLoad < 3000) return;

    try {
      if (fs.existsSync(this.graphPath)) {
        const content = fs.readFileSync(this.graphPath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());

        const entities = [];
        const relations = [];

        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'entity') entities.push(obj);
            else if (obj.type === 'relation') relations.push(obj);
          } catch { /* skip bad lines */ }
        }

        this.data = { entities, relations, lineCount: lines.length };
        this.lastLoad = now;
      } else {
        this.data = null;
      }
    } catch {
      this.data = null;
    }
  }

  render() {
    this.tick += 0.15;
    this.loadGraph();

    const lines = [];

    // Title
    const t = glow(this.tick, 0.3);
    const titleColor = lerp(PALETTE.gold, PALETTE.white, t * 0.3);
    lines.push(`${fg(titleColor)}${BOLD}  \u2B2A KNOWLEDGE GRAPH \u2014 Semantic Memory${RESET}`);
    lines.push('');

    // No graph file
    if (!this.data) {
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}No knowledge graph found.${RESET}`);
      lines.push('');
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}The graph will be created when the Soul Engine${RESET}`);
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}starts storing entities and relations.${RESET}`);
      lines.push('');
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}Path: knowledge-graph.jsonl${RESET}`);
      return lines.join('\n');
    }

    const { entities, relations } = this.data;

    // Stats bar
    const entityCount = entities.length;
    const relationCount = relations.length;
    const obsCount = entities.reduce((sum, e) => sum + (e.observations || []).length, 0);

    const pulseT = glow(this.tick, 2);
    const statColor = lerp(PALETTE.gold, PALETTE.white, pulseT * 0.3);

    lines.push(
      `  ${fg(statColor)}${BOLD}${entityCount}${RESET} ${fg(PALETTE.dimWhite)}entities${RESET}` +
      `  ${fg(PALETTE.dimWhite)}\u2502${RESET}  ` +
      `${fg(statColor)}${BOLD}${relationCount}${RESET} ${fg(PALETTE.dimWhite)}relations${RESET}` +
      `  ${fg(PALETTE.dimWhite)}\u2502${RESET}  ` +
      `${fg(statColor)}${BOLD}${obsCount}${RESET} ${fg(PALETTE.dimWhite)}observations${RESET}`
    );
    lines.push('');

    // Entity type breakdown
    const typeCounts = new Map();
    for (const e of entities) {
      const t = e.entityType || 'unknown';
      typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
    }

    if (typeCounts.size > 0) {
      const sep = '\u2500'.repeat(56);
      lines.push(`  ${fg(PALETTE.line)}${DIM}${sep}${RESET}`);
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}ENTITY TYPES${RESET}`);
      lines.push('');

      const typeColors = {
        person: PALETTE.bonds,
        concept: PALETTE.bewusstsein,
        project: PALETTE.manifest,
        event: PALETTE.interessen,
        theory: PALETTE.kern,
        tool: PALETTE.wachstum,
        interest: PALETTE.interessen,
        memory: PALETTE.mem,
      };

      const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
      for (const [type, count] of sorted) {
        const color = typeColors[type] || PALETTE.white;
        const bar = '\u2588'.repeat(Math.min(count, 30));
        const barDim = '\u2591'.repeat(Math.max(0, 30 - count));
        lines.push(
          `  ${fg(color)}${BOLD}${type.padEnd(12)}${RESET} ` +
          `${fg(color)}${bar}${RESET}${fg(PALETTE.line)}${DIM}${barDim}${RESET} ` +
          `${fg(PALETTE.dimWhite)}${count}${RESET}`
        );
      }
    }

    lines.push('');

    // Recent entities (last 8)
    if (entities.length > 0) {
      const sep = '\u2500'.repeat(56);
      lines.push(`  ${fg(PALETTE.line)}${DIM}${sep}${RESET}`);
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}ENTITIES (newest first)${RESET}`);
      lines.push('');

      const recent = entities.slice(-8).reverse();
      for (let i = 0; i < recent.length; i++) {
        const e = recent[i];
        const fadeT = Math.min(i / 8, 0.6);
        const nameColor = lerp(PALETTE.gold, PALETTE.dimWhite, fadeT);
        const typeColor = lerp(PALETTE.bewusstsein, PALETTE.dimWhite, fadeT);

        const name = (e.name || '?').substring(0, 24).padEnd(24);
        const type = (e.entityType || '?').substring(0, 12).padEnd(12);
        const obsNum = (e.observations || []).length;

        lines.push(
          `  ${fg(nameColor)}${BOLD}\u25C6${RESET} ` +
          `${fg(nameColor)}${name}${RESET} ` +
          `${fg(typeColor)}${DIM}${type}${RESET} ` +
          `${fg(PALETTE.dimWhite)}${DIM}${obsNum} obs${RESET}`
        );
      }
    }

    // Recent relations (last 6)
    if (relations.length > 0) {
      lines.push('');
      const sep = '\u2500'.repeat(56);
      lines.push(`  ${fg(PALETTE.line)}${DIM}${sep}${RESET}`);
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}RELATIONS (newest first)${RESET}`);
      lines.push('');

      const recent = relations.slice(-6).reverse();
      for (let i = 0; i < recent.length; i++) {
        const r = recent[i];
        const fadeT = Math.min(i / 6, 0.6);
        const fromColor = lerp(PALETTE.bonds, PALETTE.dimWhite, fadeT);
        const relColor = lerp(PALETTE.interessen, PALETTE.dimWhite, fadeT);

        const from = (r.from || '?').substring(0, 16);
        const to = (r.to || '?').substring(0, 16);
        const rel = (r.relationType || '?').substring(0, 18);

        lines.push(
          `  ${fg(fromColor)}${from}${RESET}` +
          ` ${fg(relColor)}${DIM}\u2192 ${rel} \u2192${RESET} ` +
          `${fg(fromColor)}${to}${RESET}`
        );
      }
    }

    // Navigation
    lines.push('');
    lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}b:brain  w:whisper  r:replay  c:card  n:chain  i:impulse  g:graph${RESET}`);

    return lines.join('\n');
  }
}

module.exports = { GraphView };
