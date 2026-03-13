// Protocol View — Session protocol steps (ported from monitor-parse.ts)
// Shows session start/end steps with completion status + file integrity check

const fs   = require('fs');
const path = require('path');
const { PALETTE, fg, RESET, BOLD, DIM } = require('./colors');

/* ── Regex (bilingual) ─────────────────────────────────── */
const RE_SELF_CHECK        = /^###?\s+(?:Selbst-Check|Self-Check)/im;
const RE_PROPOSAL          = /^###?\s+(?:Vorschlags?-?(?:Pruefung|Prüfung)|Proposal[\s-]?Review)/im;
const RE_WORLD             = /^###?\s+(?:Welt-Check|World[\s-]?Check)/im;
const RE_RELATIONSHIP      = /^###?\s+(?:Beziehungs-Check|Relationship[\s-]?Check)/im;
const RE_DREAM             = /^###?\s+(?:Traum-Phase|Dream[\s-]?Phase)/im;
const RE_GROWTH            = /^###?\s+(?:Wachstums-Check|Growth[\s-]?Check)/im;
const RE_SHADOW            = /^###?\s+(?:Schatten-Check|Shadow[\s-]?Check)/im;
const RE_CONNECTION        = /^###?\s+(?:Verbindungs-Check|Connection[\s-]?Check)/im;
const RE_RESULT            = /(?:Ergebnis|Result):\s*(HEARTBEAT_OK|AKTUALISIERT|UPDATED|GESCHRIEBEN|WRITTEN|KONTAKT|CONTACT|KONFIGURIERT|CONFIGURED)/i;
const RE_CONDITIONAL_BLOCK = /^###?\s+(?:Bedingte Checks|Conditional[\s-]?Checks)/im;

const CONDITIONAL_PATTERNS = [
  { re: /(?:Welt-Check|World[\s-]?Check):\s*(.+)/i,               stepId: 'start.world_check' },
  { re: /(?:Beziehungs-Check|Relationship[\s-]?Check):\s*(.+)/i,  stepId: 'start.relationship_check' },
  { re: /(?:Traum-Phase|Dream[\s-]?Phase):\s*(.+)/i,              stepId: 'start.dream_phase' },
  { re: /(?:Wachstums-Check|Growth[\s-]?Check):\s*(.+)/i,         stepId: 'start.growth_check' },
  { re: /(?:Schatten-Check|Shadow[\s-]?Check):\s*(.+)/i,          stepId: 'start.shadow_check' },
  { re: /(?:Verbindungs-Check|Connection[\s-]?Check):\s*(.+)/i,   stepId: 'start.connection_check' },
];

/* ── Helpers ───────────────────────────────────────────── */
function inferConditionalStatus(t) {
  t = t.trim().toLowerCase();
  if (/ausstehend|pending|todo/.test(t))                     return 'pending';
  if (/bereits|already|done|durchgef[uü]hrt|completed/.test(t)) return 'done';
  if (/nicht ausgeloe?st|not triggered|kein|keine/.test(t))  return 'not_triggered';
  if (/geschrieben|written|aktualisiert|updated/.test(t))    return 'done';
  if (/heartbeat_ok/.test(t))                                return 'done';
  if (t.length > 5)                                          return 'done';
  return 'pending';
}

function extractResult(text) {
  const m = text.match(RE_RESULT);
  return m ? m[1] : null;
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function splitSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let cur = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (cur) sections.push({ header: cur.header, body: cur.body.join('\n') });
      cur = { header: line, body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) sections.push({ header: cur.header, body: cur.body.join('\n') });
  return sections;
}

function splitSubSections(body) {
  const lines = body.split('\n');
  const sections = [];
  let cur = null;
  for (const line of lines) {
    if (/^###\s+/.test(line)) {
      if (cur) sections.push({ header: cur.header, body: cur.body.join('\n') });
      cur = { header: line, body: [] };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) sections.push({ header: cur.header, body: cur.body.join('\n') });
  return sections;
}

/* ── Step definitions ──────────────────────────────────── */
function defaultStartSteps() {
  return [
    { id: 'start.session_guard',      label: 'Session Guard',      status: 'done',    conditional: false },
    { id: 'start.session_registered', label: 'Session Registered', status: 'done',    conditional: false },
    { id: 'start.seed_loaded',        label: 'Seed Loaded',        status: 'pending', conditional: false },
    { id: 'start.self_check',         label: 'Self-Check',         status: 'pending', conditional: false },
    { id: 'start.proposal_review',    label: 'Proposal Review',    status: 'pending', conditional: true  },
    { id: 'start.world_check',        label: 'World Check',        status: 'pending', conditional: true  },
    { id: 'start.relationship_check', label: 'Relationship Check', status: 'pending', conditional: true  },
    { id: 'start.dream_phase',        label: 'Dream Phase',        status: 'pending', conditional: true  },
    { id: 'start.growth_check',       label: 'Growth Check',       status: 'pending', conditional: true  },
    { id: 'start.shadow_check',       label: 'Shadow Check',       status: 'pending', conditional: true  },
    { id: 'start.connection_check',   label: 'Connection Check',   status: 'pending', conditional: true  },
    { id: 'start.heartbeat_logged',   label: 'Heartbeat Logged',   status: 'pending', conditional: false },
  ].map(s => ({ ...s, resultCode: null, detail: null }));
}

function defaultEndSteps() {
  return [
    { id: 'end.state_log',      label: 'A1: State Log',        status: 'pending', conditional: false },
    { id: 'end.evolution',      label: 'A2: Evolution',        status: 'pending', conditional: false },
    { id: 'end.heartbeat',      label: 'A3: Final Heartbeat',  status: 'pending', conditional: false },
    { id: 'end.memories',       label: 'A4: Memories',         status: 'pending', conditional: false },
    { id: 'end.index',          label: 'A5: Index',            status: 'pending', conditional: false },
    { id: 'end.seed_condensed', label: 'B: Seed Condensed',    status: 'pending', conditional: false },
    { id: 'end.guard_resolved', label: 'C: Guard Resolved',    status: 'pending', conditional: false },
    { id: 'end.complete',       label: 'Protocol Complete',    status: 'pending', conditional: false },
  ].map(s => ({ ...s, resultCode: null, detail: null }));
}

/* ── Parsers ───────────────────────────────────────────── */
function parseStartSteps(sections) {
  const steps = defaultStartSteps();
  const m = new Map(steps.map(s => [s.id, s]));

  for (const sec of sections) {
    const body = sec.body;
    if (RE_SELF_CHECK.test(sec.header)) {
      m.get('start.self_check').status = 'done';
      m.get('start.self_check').resultCode = extractResult(body);
      if (/(?:Gelesen|Read).*SEED/i.test(body)) {
        m.get('start.seed_loaded').status = 'done';
      }
    }
    if (RE_PROPOSAL.test(sec.header)) {
      m.get('start.proposal_review').status = 'done';
      m.get('start.proposal_review').resultCode = extractResult(body);
    }
    if (RE_WORLD.test(sec.header))        { m.get('start.world_check').status = 'done'; }
    if (RE_RELATIONSHIP.test(sec.header)) { m.get('start.relationship_check').status = 'done'; }
    if (RE_DREAM.test(sec.header))        { m.get('start.dream_phase').status = 'done'; }
    if (RE_GROWTH.test(sec.header))       { m.get('start.growth_check').status = 'done'; }
    if (RE_SHADOW.test(sec.header))       { m.get('start.shadow_check').status = 'done'; }
    if (RE_CONNECTION.test(sec.header))   { m.get('start.connection_check').status = 'done'; }

    if (RE_CONDITIONAL_BLOCK.test(sec.header)) {
      for (const line of body.split('\n')) {
        for (const { re, stepId } of CONDITIONAL_PATTERNS) {
          const match = line.match(re);
          if (match && m.has(stepId)) {
            m.get(stepId).status = inferConditionalStatus(match[1]);
          }
        }
      }
    }
  }

  if (sections.length > 0) m.get('start.heartbeat_logged').status = 'done';
  return steps;
}

function parseEndSteps(sections, soulPath) {
  const steps = defaultEndSteps();
  const m = new Map(steps.map(s => [s.id, s]));

  for (const sec of sections) {
    const h = sec.header.toLowerCase();
    const body = sec.body;
    if (RE_SELF_CHECK.test(sec.header))                               { m.get('end.heartbeat').status = 'done'; }
    if (/session[\s-]?zusammenfassung|session[\s-]?summary/.test(h)) { m.get('end.memories').status = 'done'; }
    if (/vorschlag|proposal|evolution/.test(h))                       { m.get('end.evolution').status = 'done'; }
  }
  if (sections.length > 0 && m.get('end.heartbeat').status === 'pending') {
    m.get('end.heartbeat').status = 'done';
  }

  // File-based enrichment
  const today = new Date().toISOString().split('T')[0];

  try {
    const dir = path.join(soulPath, 'zustandslog');
    const files = fs.readdirSync(dir).filter(f => f.startsWith(today) && /end|ende/.test(f));
    if (files.length > 0) { m.get('end.state_log').status = 'done'; m.get('end.state_log').detail = 'snapshot written'; }
  } catch {}

  for (const indexRel of ['erinnerungen/INDEX.md', 'memories/INDEX.md']) {
    try {
      const stat = fs.statSync(path.join(soulPath, indexRel));
      if (stat.mtime.toISOString().startsWith(today)) {
        m.get('end.index').status = 'done'; m.get('end.index').detail = 'updated today';
        break;
      }
    } catch {}
  }

  try {
    const stat = fs.statSync(path.join(soulPath, 'SEED.md'));
    if (stat.mtime.toISOString().startsWith(today)) {
      m.get('end.seed_condensed').status = 'done'; m.get('end.seed_condensed').detail = 'condensed today';
    }
  } catch {}

  const sessionActive = fs.existsSync(path.join(soulPath, '.session-active'));
  if (!sessionActive) {
    const others = steps.filter(s => s.id !== 'end.guard_resolved' && s.id !== 'end.complete');
    if (others.every(s => s.status === 'done')) {
      m.get('end.guard_resolved').status = 'done'; m.get('end.guard_resolved').detail = '.session-active removed';
    }
  }

  const allDone = steps.filter(s => s.id !== 'end.complete').every(s => s.status === 'done');
  if (allDone) { m.get('end.complete').status = 'done'; }

  return steps;
}

/* ── Rendering helpers ─────────────────────────────────── */
function statusIcon(status) {
  switch (status) {
    case 'done':          return '✓';
    case 'skipped':       return '–';
    case 'failed':        return '✗';
    case 'not_triggered': return '◌';
    default:              return '○';  // pending
  }
}

function statusColor(status, C) {
  switch (status) {
    case 'done':          return C.wachstum;
    case 'failed':        return C.kern;
    case 'not_triggered': return C.dimWhite;
    default:              return C.dimWhite;
  }
}

function renderBar(pct, width, color) {
  const filled = Math.round(Math.min(pct, 100) / 100 * width);
  return `${fg(color)}${'█'.repeat(filled)}${fg(PALETTE.dimWhite)}${'░'.repeat(width - filled)}${RESET} ${fg(PALETTE.dimWhite)}${DIM}${pct}%${RESET}`;
}

/* ── ProtocolView class ─────────────────────────────────── */
class ProtocolView {
  constructor(soulPath) {
    this.soulPath = path.resolve(soulPath);
    this._session = null;
    this._lastLoad = 0;
  }

  _load() {
    const now = Date.now();
    if (now - this._lastLoad < 3000) return;
    this._lastLoad = now;
    this._session = null;

    try {
      const today = new Date().toISOString().split('T')[0];
      const hbPath = path.join(this.soulPath, 'heartbeat', `${today}.md`);
      const content = fs.readFileSync(hbPath, 'utf-8');
      const allSections = splitSections(content);

      const markers = [];
      for (let i = 0; i < allSections.length; i++) {
        const h = allSections[i].header;
        const sm = h.match(/^##\s+~?(\d{2}:\d{2})?\s*[-—–]?\s*Session\s+(\d+)\s+Start/i);
        if (sm) markers.push({ type: 'start', num: parseInt(sm[2]), time: sm[1] || null, idx: i });
        const em = h.match(/^##\s+~?(\d{2}:\d{2})?\s*[-—–]?\s*Session\s+(\d+)\s+(?:Ende|End)/i);
        if (em) markers.push({ type: 'end', num: parseInt(em[2]), time: em[1] || null, idx: i });
      }

      const nums = [...new Set(markers.map(m => m.num))].sort((a, b) => a - b);
      if (nums.length === 0) {
        // No explicit session markers — parse whole file as one session
        this._session = {
          number: '?', startTime: null, endTime: null, hasStart: true, hasEnd: false,
          startSteps: parseStartSteps(allSections),
          endSteps: null,
        };
        return;
      }

      const lastNum = nums[nums.length - 1];
      const sm = markers.find(m => m.type === 'start' && m.num === lastNum);
      const em = markers.find(m => m.type === 'end' && m.num === lastNum);

      let startSections = [], endSections = [];
      if (sm) {
        const nb = markers.find(m => m.idx > sm.idx);
        const endIdx = nb ? nb.idx : (em ? em.idx : allSections.length);
        startSections = allSections.slice(sm.idx + 1, endIdx);
        if (startSections.length === 0) startSections = splitSubSections(allSections[sm.idx].body);
      }
      if (em) {
        const nb = markers.find(m => m.idx > em.idx);
        endSections = allSections.slice(em.idx + 1, nb ? nb.idx : allSections.length);
        if (endSections.length === 0) endSections = splitSubSections(allSections[em.idx].body);
      }

      this._session = {
        number: lastNum,
        startTime: sm?.time || null,
        endTime: em?.time || null,
        hasStart: !!sm,
        hasEnd: !!em,
        startSteps: parseStartSteps(startSections),
        endSteps: em ? parseEndSteps(endSections, this.soulPath) : null,
      };
    } catch { /* No heartbeat file today */ }
  }

  render() {
    this._load();
    const C = PALETTE;
    const lines = [];

    lines.push(`  ${fg(C.cyan)}${BOLD}◈ SESSION PROTOCOL${RESET}  ${fg(C.dimWhite)}${DIM}${new Date().toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}${RESET}`);
    lines.push('');

    if (!this._session) {
      lines.push(`  ${fg(C.dimWhite)}${DIM}No session today — heartbeat/${new Date().toISOString().split('T')[0]}.md${RESET}`);
      lines.push('');
      lines.push(`  ${fg(C.dimWhite)}${DIM}Session will appear once a heartbeat log is written.${RESET}`);
      return lines.join('\n');
    }

    const s = this._session;
    const sessionLabel = s.startTime ? `Session ${s.number}  ${fg(C.dimWhite)}${DIM}started ${s.startTime}${RESET}` : `Session ${s.number}`;
    const statusLabel  = s.hasEnd
      ? `${fg(C.wachstum)}${DIM}ended ${s.endTime || '?'}${RESET}`
      : `${fg(C.bewusstsein)}${DIM}in progress${RESET}`;
    lines.push(`  ${fg(C.gold)}${BOLD}${sessionLabel}${RESET}  ${statusLabel}`);
    lines.push('');

    const startSteps = s.startSteps || [];
    const endSteps   = s.endSteps   || defaultEndSteps();

    const startDone = startSteps.filter(x => x.status === 'done').length;
    const endDone   = endSteps.filter(x => x.status === 'done').length;
    const startPct  = startSteps.length ? Math.round(startDone / startSteps.length * 100) : 0;
    const endPct    = endSteps.length   ? Math.round(endDone   / endSteps.length   * 100) : 0;

    // Column headers
    const hdrLeft  = `SESSION START (${startPct}%)`;
    const hdrRight = s.hasEnd ? `SESSION END (${endPct}%)` : 'SESSION END (—)';
    const colW = 36;
    lines.push(
      `  ${fg(C.cyan)}${BOLD}${hdrLeft}${RESET}${' '.repeat(Math.max(1, colW - hdrLeft.length))}` +
      `${s.hasEnd ? fg(C.wachstum) + BOLD : fg(C.dimWhite) + DIM}${hdrRight}${RESET}`
    );
    lines.push('');

    const maxRows = Math.max(startSteps.length, endSteps.length);
    for (let i = 0; i < maxRows; i++) {
      const left  = startSteps[i];
      const right = endSteps[i];

      const renderStep = (step, w) => {
        if (!step) return ' '.repeat(w);
        const icon  = statusIcon(step.status);
        const color = statusColor(step.status, C);
        const label = step.label.substring(0, 20);
        const code  = step.resultCode ? ` ${DIM}[${step.resultCode}]${RESET}${fg(color)}` : '';
        const plain = `${icon} ${label}${step.resultCode ? ` [${step.resultCode}]` : ''}`;
        const pad   = ' '.repeat(Math.max(0, w - plain.length));
        return `${fg(color)}${icon} ${label}${code}${RESET}${pad}`;
      };

      lines.push(`  ${renderStep(left, colW)}  ${renderStep(right, colW)}`);
    }

    // Progress bars
    lines.push('');
    lines.push(
      `  ${renderBar(startPct, 28, C.cyan)}  ` +
      `${s.hasEnd ? renderBar(endPct, 28, C.wachstum) : fg(C.dimWhite) + DIM + '─'.repeat(28) + ' not started' + RESET}`
    );

    // File integrity
    lines.push('');
    lines.push(`  ${fg(C.dimWhite)}${DIM}── Critical Files ─────────────────────────────${RESET}`);
    lines.push('');
    this._renderFileCheck(lines);

    return lines.join('\n');
  }

  _renderFileCheck(lines) {
    const C   = PALETTE;
    const today = new Date().toISOString().split('T')[0];
    const checks = [
      { rel: 'SEED.md',                                label: 'SEED.md' },
      { rel: 'seele/KERN.md',      alt: 'soul/CORE.md',          label: 'KERN.md' },
      { rel: 'seele/BEWUSSTSEIN.md', alt: 'soul/CONSCIOUSNESS.md', label: 'BEWUSSTSEIN.md' },
      { rel: `heartbeat/${today}.md`,                  label: "Today's Heartbeat" },
      { rel: 'erinnerungen/INDEX.md', alt: 'memories/INDEX.md',  label: 'Memory Index' },
      { rel: '.session-active',                        label: 'Session Active', invertColor: true },
    ];

    const rendered = checks.map(f => {
      const p1 = path.join(this.soulPath, f.rel);
      const p2 = f.alt ? path.join(this.soulPath, f.alt) : null;
      const exists = fs.existsSync(p1) || (p2 && fs.existsSync(p2));
      let size = '';
      try {
        const stat = fs.statSync(exists ? p1 : p2);
        if (stat.size < 1024) size = `${stat.size}B`;
        else size = `${(stat.size / 1024).toFixed(1)}K`;
      } catch {}

      // .session-active: green when present (session running), dim when absent
      const good = f.invertColor ? exists : exists;
      const dotColor = f.invertColor
        ? (exists ? C.bewusstsein : C.dimWhite)
        : (exists ? C.wachstum   : C.kern);

      return `${fg(dotColor)}●${RESET} ${fg(exists ? C.white : C.dimWhite)}${f.label}${RESET} ${fg(C.dimWhite)}${DIM}${size}${RESET}`;
    });

    const half = Math.ceil(rendered.length / 2);
    for (let i = 0; i < half; i++) {
      const left  = rendered[i]     || '';
      const right = rendered[i + half] || '';
      const leftLen = stripAnsi(left).length;
      lines.push(`  ${left}${' '.repeat(Math.max(1, 34 - leftLen))}${right}`);
    }
  }
}

module.exports = { ProtocolView };
