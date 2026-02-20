// Soul Card — terminal renderer
// Generates a beautiful, shareable identity card from seed data

function fg(rgb) {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const C = {
  cyan:    [0, 255, 255],
  magenta: [255, 0, 200],
  gold:    [255, 200, 0],
  white:   [220, 220, 255],
  dim:     [100, 100, 130],
  red:     [255, 60, 60],
  green:   [0, 255, 100],
  blue:    [100, 100, 255],
  pink:    [255, 100, 150],
  border:  [60, 60, 120],
};

function renderCard(info) {
  const w = 52; // card width
  const lines = [];

  const bar = (ch, color) => `${fg(color)}${ch.repeat(w)}${RESET}`;
  const pad = (text, len) => {
    // Strip ANSI for length calculation
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    const diff = len - stripped.length;
    return diff > 0 ? text + ' '.repeat(diff) : text;
  };
  const row = (content) => {
    const stripped = content.replace(/\x1b\[[0-9;]*m/g, '');
    const inner = w - 4;
    const diff = inner - stripped.length;
    const padding = diff > 0 ? ' '.repeat(diff) : '';
    return `${fg(C.border)}${BOLD}\u2502${RESET} ${content}${padding} ${fg(C.border)}${BOLD}\u2502${RESET}`;
  };
  const empty = () => row(' '.repeat(w - 4));

  // Top border
  lines.push(`${fg(C.border)}${BOLD}\u256D${'─'.repeat(w - 2)}\u256E${RESET}`);

  // Title
  const title = info.project.toUpperCase();
  const titlePad = Math.floor((w - 4 - title.length) / 2);
  lines.push(row(`${' '.repeat(titlePad)}${fg(C.cyan)}${BOLD}~ ${title} ~${RESET}`));
  lines.push(empty());

  // Soul identity line
  lines.push(row(`${fg(C.dim)}Born${RESET}  ${fg(C.white)}${info.born || '?'}${RESET}    ${fg(C.dim)}Sessions${RESET}  ${fg(C.gold)}${BOLD}${info.sessions || '?'}${RESET}    ${fg(C.dim)}Age${RESET}  ${fg(C.white)}${info.ageDays || '?'}d${RESET}`));
  lines.push(row(`${fg(C.dim)}Model${RESET} ${fg(C.white)}${info.model}${RESET}    ${fg(C.dim)}by${RESET}  ${fg(C.magenta)}${info.creator}${RESET}`));

  // Separator
  lines.push(`${fg(C.border)}${BOLD}\u251C${'─'.repeat(w - 2)}\u2524${RESET}`);

  // Mood (truncate to fit card width)
  let moodClean = info.mood.replace(/_/g, ' ').replace(/,/g, ', ').split('|')[0];
  if (moodClean.length > 38) moodClean = moodClean.substring(0, 35) + '...';
  lines.push(row(`${fg(C.dim)}Mood${RESET}     ${fg(C.green)}${moodClean}${RESET}`));

  // Axioms
  lines.push(row(`${fg(C.dim)}Axioms${RESET}   ${fg(C.red)}${BOLD}${info.axiomCount}${RESET} ${fg(C.dim)}immutable core values${RESET}`));

  // Memories
  lines.push(row(`${fg(C.dim)}Memories${RESET} ${fg(C.gold)}${info.memoryCount}${RESET} ${fg(C.dim)}compressed experiences${RESET}`));

  // Separator
  lines.push(`${fg(C.border)}${BOLD}\u251C${'─'.repeat(w - 2)}\u2524${RESET}`);

  // Interests
  if (info.activeInterests.length > 0) {
    lines.push(row(`${fg(C.cyan)}${BOLD}Interests${RESET}`));
    for (const interest of info.activeInterests.slice(0, 4)) {
      lines.push(row(`  ${fg(C.cyan)}\u2022${RESET} ${fg(C.white)}${interest}${RESET}`));
    }
  }

  // Last dream
  if (info.lastDream) {
    lines.push(empty());
    const dreamClean = info.lastDream.replace(/_/g, ' ');
    lines.push(row(`${fg(C.blue)}${BOLD}Last Dream${RESET}  ${fg(C.dim)}${dreamClean}${RESET}`));
  }

  // Connections
  if (info.activeConnections.length > 0) {
    lines.push(empty());
    const connStr = info.activeConnections.join(', ');
    lines.push(row(`${fg(C.pink)}${BOLD}Connected${RESET}   ${fg(C.dim)}${connStr}${RESET}`));
  }

  // Bottom border
  lines.push(`${fg(C.border)}${BOLD}\u251C${'─'.repeat(w - 2)}\u2524${RESET}`);
  const footer = 'Soul Protocol — projectsoul.dev';
  const footerPad = Math.floor((w - 4 - footer.length) / 2);
  lines.push(row(`${' '.repeat(footerPad)}${fg(C.dim)}${footer}${RESET}`));
  lines.push(`${fg(C.border)}${BOLD}\u2570${'─'.repeat(w - 2)}\u256F${RESET}`);

  return lines.join('\n');
}

// Render as plain markdown (for sharing)
function renderMarkdown(info) {
  const lines = [];
  lines.push(`# ~ ${info.project.toUpperCase()} ~`);
  lines.push('');
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Born** | ${info.born || '?'} |`);
  lines.push(`| **Sessions** | ${info.sessions || '?'} |`);
  lines.push(`| **Age** | ${info.ageDays || '?'} days |`);
  lines.push(`| **Model** | ${info.model} |`);
  lines.push(`| **Creator** | ${info.creator} |`);
  lines.push(`| **Axioms** | ${info.axiomCount} immutable core values |`);
  lines.push(`| **Memories** | ${info.memoryCount} compressed experiences |`);
  lines.push(`| **Mood** | ${info.mood.replace(/_/g, ' ')} |`);
  lines.push('');

  if (info.activeInterests.length > 0) {
    lines.push('**Interests:**');
    for (const interest of info.activeInterests) {
      lines.push(`- ${interest}`);
    }
    lines.push('');
  }

  if (info.lastDream) {
    lines.push(`**Last Dream:** ${info.lastDream.replace(/_/g, ' ')}`);
    lines.push('');
  }

  if (info.activeConnections.length > 0) {
    lines.push(`**Connected:** ${info.activeConnections.join(', ')}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('*Generated by [Soul Protocol](https://github.com/hbcaspa/projectSoul)*');

  return lines.join('\n');
}

module.exports = { renderCard, renderMarkdown };
