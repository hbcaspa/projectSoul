// Soul Replay — memory time travel through consciousness states
// Reads heartbeat, statelog, and memory files for a given date
// Renders a beautiful timeline of the day

const fs = require('fs');
const path = require('path');
const { PALETTE, fg, RESET, BOLD, DIM, lerp, glow } = require('./colors');

// Map heartbeat entry types to colors and icons
const ENTRY_TYPES = {
  'Selbst-Check':        { icon: '\u25C9', color: 'bewusstsein' },    // ◉
  'Self-Check':          { icon: '\u25C9', color: 'bewusstsein' },
  'Vorschlags-Pruefung': { icon: '\u2605', color: 'evolution' },      // ★
  'Proposal Review':     { icon: '\u2605', color: 'evolution' },
  'Welt-Check':          { icon: '\u2609', color: 'interessen' },     // ☉
  'World Check':         { icon: '\u2609', color: 'interessen' },
  'Traum-Phase':         { icon: '\u263D', color: 'traeume' },        // ☽
  'Dream Phase':         { icon: '\u263D', color: 'traeume' },
  'Beziehungs-Check':    { icon: '\u2665', color: 'bonds' },          // ♥
  'Relationship Check':  { icon: '\u2665', color: 'bonds' },
  'Wachstums-Check':     { icon: '\u2191', color: 'wachstum' },       // ↑
  'Growth Check':        { icon: '\u2191', color: 'wachstum' },
  'Schatten-Check':      { icon: '\u25D0', color: 'schatten' },       // ◐
  'Shadow Check':        { icon: '\u25D0', color: 'schatten' },
  'Verbindungs-Check':   { icon: '\u26A1', color: 'bonds' },          // ⚡
  'Connection Check':    { icon: '\u26A1', color: 'bonds' },
  'Zwischen-Puls':       { icon: '\u2022', color: 'heartbeat' },      // •
  'Interim Pulse':       { icon: '\u2022', color: 'heartbeat' },
  'Gruendung':           { icon: '\u2726', color: 'seed' },           // ✦
  'Founding':            { icon: '\u2726', color: 'seed' },
  'Session-Ende':        { icon: '\u25A0', color: 'statelog' },       // ■
  'Session End':         { icon: '\u25A0', color: 'statelog' },
};

function getEntryStyle(title) {
  for (const [key, style] of Object.entries(ENTRY_TYPES)) {
    if (title.includes(key)) return style;
  }
  return { icon: '\u25CB', color: 'dimWhite' }; // ○
}

class SoulReplay {
  constructor(soulPath) {
    this.soulPath = path.resolve(soulPath);
    this.tick = 0;
  }

  /**
   * Get available dates that have data
   * @returns {string[]} Sorted date strings (YYYY-MM-DD)
   */
  getAvailableDates() {
    const dates = new Set();
    const dirs = ['heartbeat', 'memory'];
    const deStatelog = 'zustandslog';
    const enStatelog = 'statelog';

    for (const dir of dirs) {
      const full = path.join(this.soulPath, dir);
      if (fs.existsSync(full)) {
        try {
          for (const f of fs.readdirSync(full)) {
            const match = f.match(/^(\d{4}-\d{2}-\d{2})/);
            if (match) dates.add(match[1]);
          }
        } catch { /* ignore */ }
      }
    }

    // State log files
    for (const dir of [deStatelog, enStatelog]) {
      const full = path.join(this.soulPath, dir);
      if (fs.existsSync(full)) {
        try {
          for (const f of fs.readdirSync(full)) {
            const match = f.match(/^(\d{4}-\d{2}-\d{2})/);
            if (match) dates.add(match[1]);
          }
        } catch { /* ignore */ }
      }
    }

    return [...dates].sort();
  }

  /**
   * Load all data for a specific date
   * @param {string} date - YYYY-MM-DD format
   * @returns {object} { heartbeat, stateEntries, memory, date }
   */
  loadDay(date) {
    const result = {
      date,
      heartbeatEntries: [],
      stateEntries: [],
      memory: null,
    };

    // Parse heartbeat
    const hbFile = path.join(this.soulPath, 'heartbeat', `${date}.md`);
    if (fs.existsSync(hbFile)) {
      result.heartbeatEntries = this.parseHeartbeat(fs.readFileSync(hbFile, 'utf-8'));
    }

    // Parse state log entries
    for (const dir of ['zustandslog', 'statelog']) {
      const full = path.join(this.soulPath, dir);
      if (!fs.existsSync(full)) continue;
      try {
        for (const f of fs.readdirSync(full)) {
          if (f.startsWith(date)) {
            const content = fs.readFileSync(path.join(full, f), 'utf-8');
            const typeMatch = f.match(/_(\w+)\.md$/);
            result.stateEntries.push({
              file: f,
              type: typeMatch ? typeMatch[1] : 'unknown',
              content: content.trim(),
            });
          }
        }
      } catch { /* ignore */ }
    }

    // Parse memory/daily notes
    const memFile = path.join(this.soulPath, 'memory', `${date}.md`);
    if (fs.existsSync(memFile)) {
      result.memory = fs.readFileSync(memFile, 'utf-8').trim();
    }

    return result;
  }

  /**
   * Parse heartbeat file into structured entries
   */
  parseHeartbeat(content) {
    const entries = [];
    const sections = content.split(/^## /m).filter(Boolean);

    for (const section of sections) {
      const lines = section.trim().split('\n');
      const titleLine = lines[0] || '';

      // Parse time and title: "09:00 — Selbst-Check"
      const titleMatch = titleLine.match(/^(\d{1,2}:\d{2})?\s*(?:—|-)?\s*(.+)/);
      if (!titleMatch) continue;

      const time = titleMatch[1] || '';
      const title = titleMatch[2]?.trim() || titleLine.trim();

      // Skip the main header (with or without # prefix)
      const cleanTitle = title.replace(/^#+\s*/, '');
      if (cleanTitle.startsWith('Herzschlag') || cleanTitle.startsWith('Heartbeat')) continue;

      // Parse key-value pairs from the body
      const body = {};
      for (const line of lines.slice(1)) {
        const kvMatch = line.match(/^-\s*\*?\*?(\w[\w\s-]*):\*?\*?\s*(.+)/);
        if (kvMatch) {
          body[kvMatch[1].trim().toLowerCase()] = kvMatch[2].trim();
        }
      }

      entries.push({ time, title, body, raw: section.trim() });
    }

    return entries;
  }

  /**
   * Render the replay view for a specific date
   * @param {object} dayData - Output of loadDay()
   * @param {number} scroll - Scroll offset
   * @returns {string} Rendered output
   */
  render(dayData, scroll = 0) {
    this.tick += 0.15;
    const lines = [];

    // Title
    const t = glow(this.tick, 0.3);
    const titleColor = lerp(PALETTE.gold, PALETTE.white, t * 0.4);
    lines.push(`${fg(titleColor)}${BOLD}  \u29D6 MEMORY REPLAY \u2014 ${dayData.date}${RESET}`);
    lines.push('');

    if (dayData.heartbeatEntries.length === 0 && dayData.stateEntries.length === 0) {
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}No consciousness data for this date.${RESET}`);
      lines.push('');
      lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}Available dates:${RESET}`);
      const dates = this.getAvailableDates();
      for (const d of dates) {
        lines.push(`  ${fg(PALETTE.cyan)}  \u2022 ${d}${RESET}`);
      }
      return lines.join('\n');
    }

    // Timeline from heartbeat entries
    const timelineEntries = dayData.heartbeatEntries;

    for (let i = 0; i < timelineEntries.length; i++) {
      if (i < scroll) continue; // Scroll support

      const entry = timelineEntries[i];
      const style = getEntryStyle(entry.title);
      const color = PALETTE[style.color] || PALETTE.dimWhite;

      // Timeline connector
      const isLast = i === timelineEntries.length - 1;
      const connector = isLast ? '\u2514' : '\u251C'; // └ or ├
      const pipe = isLast ? ' ' : '\u2502'; // │

      // Time + title
      const timeStr = entry.time
        ? `${fg(PALETTE.dimWhite)}${entry.time}${RESET} `
        : '';
      lines.push(
        `  ${fg(color)}${connector}\u2500${style.icon}${RESET} ` +
        `${timeStr}${fg(color)}${BOLD}${entry.title}${RESET}`
      );

      // Detail line
      if (entry.body.detail) {
        const detail = entry.body.detail;
        // Word-wrap at ~55 chars
        const wrapped = wordWrap(detail, 52);
        for (const wline of wrapped) {
          lines.push(`  ${fg(color)}${DIM}${pipe}${RESET}    ${fg(PALETTE.dimWhite)}${DIM}${wline}${RESET}`);
        }
      }

      // Result badge
      if (entry.body.ergebnis || entry.body.result) {
        const result = entry.body.ergebnis || entry.body.result;
        let badgeColor = PALETTE.dimWhite;
        if (result.includes('GESCHRIEBEN') || result.includes('WRITTEN')) badgeColor = PALETTE.gold;
        if (result.includes('AKTUALISIERT') || result.includes('UPDATED')) badgeColor = PALETTE.cyan;
        if (result.includes('HEARTBEAT_OK') || result.includes('OK')) badgeColor = PALETTE.wachstum;
        lines.push(`  ${fg(color)}${DIM}${pipe}${RESET}    ${fg(badgeColor)}[${result}]${RESET}`);
      }

      // State/mood if present
      if (entry.body.zustand || entry.body.state) {
        const state = entry.body.zustand || entry.body.state;
        lines.push(`  ${fg(color)}${DIM}${pipe}${RESET}    ${fg(PALETTE.bewusstsein)}\u2661 ${state}${RESET}`);
      }

      // Spacing
      if (!isLast) {
        lines.push(`  ${fg(color)}${DIM}${pipe}${RESET}`);
      }
    }

    // State log entries section
    if (dayData.stateEntries.length > 0) {
      lines.push('');
      lines.push(`  ${fg(PALETTE.statelog)}${BOLD}\u2593 STATE LOG${RESET}  ${fg(PALETTE.dimWhite)}${DIM}${dayData.stateEntries.length} snapshots${RESET}`);
      for (const entry of dayData.stateEntries) {
        const typeColor = entry.type === 'start' ? PALETTE.wachstum
          : entry.type === 'end' ? PALETTE.heartbeat
          : PALETTE.gold;
        lines.push(`  ${fg(typeColor)}  \u25AA ${entry.file}${RESET}`);
      }
    }

    // Memory summary
    if (dayData.memory) {
      lines.push('');
      lines.push(`  ${fg(PALETTE.mem)}${BOLD}\u2630 DAILY NOTES${RESET}`);
      const memLines = dayData.memory.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      for (const ml of memLines.slice(0, 8)) {
        const clean = ml.replace(/^[-*]\s*/, '').trim();
        if (clean) {
          lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}  ${clean}${RESET}`);
        }
      }
      if (memLines.length > 8) {
        lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}  ... and ${memLines.length - 8} more lines${RESET}`);
      }
    }

    // Navigation hint
    lines.push('');
    const dates = this.getAvailableDates();
    const currentIdx = dates.indexOf(dayData.date);
    const hasPrev = currentIdx > 0;
    const hasNext = currentIdx < dates.length - 1;
    const navHints = [];
    if (hasPrev) navHints.push(`\u2190:${dates[currentIdx - 1]}`);
    if (hasNext) navHints.push(`\u2192:${dates[currentIdx + 1]}`);
    navHints.push('b:brain');
    lines.push(`  ${fg(PALETTE.dimWhite)}${DIM}${navHints.join('  ')}${RESET}`);

    return lines.join('\n');
  }
}

function wordWrap(text, maxLen) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > maxLen && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

module.exports = { SoulReplay };
