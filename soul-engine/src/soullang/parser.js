/**
 * SoulLang Parser
 *
 * Parses .sl files into structured objects.
 * The parser is intentionally simple — SoulLang is not a programming language,
 * it's a state notation. No control flow, no functions, just declarations.
 */

const BLOCK_TYPES = ['state', 'transition', 'impulse', 'eval', 'memory_ref', 'contradiction', 'voice'];

export function parse(source) {
  const blocks = [];
  const lines = source.split('\n');
  let current = null;
  let depth = 0;
  let lineNum = 0;

  for (const rawLine of lines) {
    lineNum++;
    const line = rawLine.replace(/\/\/.*$/, '').trim(); // strip comments
    if (!line) continue;

    // Block start: "type {"
    if (!current) {
      const match = line.match(/^(\w+)\s*\{$/);
      if (match) {
        const type = match[1];
        if (!BLOCK_TYPES.includes(type)) {
          throw new SoulLangError(`Unknown block type: ${type}`, lineNum);
        }
        current = { type, fields: {}, _line: lineNum };
        depth = 1;
        continue;
      }
      // Skip lines outside blocks (comments already stripped)
      continue;
    }

    // Block end
    if (line === '}') {
      depth--;
      if (depth === 0) {
        blocks.push(current);
        current = null;
      }
      continue;
    }

    // Field: "name: value"
    const fieldMatch = line.match(/^(\w+):\s*(.+)$/);
    if (fieldMatch) {
      const [, name, rawValue] = fieldMatch;
      current.fields[name] = parseValue(rawValue);
      continue;
    }

    throw new SoulLangError(`Unexpected syntax: ${line}`, lineNum);
  }

  if (current) {
    throw new SoulLangError(`Unclosed block: ${current.type}`, current._line);
  }

  return blocks;
}

function parseValue(raw) {
  const trimmed = raw.trim();

  // Array: [0.6, 0.45, ...]
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    return inner.split(',').map(v => parseValue(v.trim()));
  }

  // String: "..."
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }

  // Enum: a | b | c
  if (trimmed.includes(' | ')) {
    return { enum: trimmed.split('|').map(s => s.trim()) };
  }

  // Number
  if (/^[+-]?\d*\.?\d+$/.test(trimmed)) {
    return parseFloat(trimmed);
  }

  // Duration: 1d, 2h, 30m
  const durMatch = trimmed.match(/^(\d+)([dhms])$/);
  if (durMatch) {
    const units = { d: 86400, h: 3600, m: 60, s: 1 };
    return { duration: parseInt(durMatch[1]) * units[durMatch[2]], raw: trimmed };
  }

  // Keywords
  if (trimmed === 'now') return { timestamp: 'now' };
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'none') return null;

  // Bare word (label, identifier)
  return trimmed;
}

export class SoulLangError extends Error {
  constructor(message, line) {
    super(`SoulLang error at line ${line}: ${message}`);
    this.line = line;
  }
}
