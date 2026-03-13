// Engine View — Server Agents, Event Stream, Cost Tracking
// Reads from engine API (localhost) + local files

const fs   = require('fs');
const path = require('path');
const http = require('http');
const { PALETTE, fg, RESET, BOLD, DIM } = require('./colors');

const AGENTS = [
  { id: 'security',  label: 'Security Agent', cron: 'Mo 09:00 UTC', envKey: 'SECURITY_AGENT_ENABLED' },
  { id: 'briefing',  label: 'Briefing Agent',  cron: '07:30 + 2h',  envKey: 'BRIEFING_ENABLED' },
  { id: 'uptime',    label: 'Uptime Monitor',  cron: 'every 5min',  envKey: 'UPTIME_ENABLED' },
  { id: 'search',    label: 'Search Monitor',  cron: 'every 30min', envKey: 'SEARCH_MONITOR_ENABLED' },
  { id: 'awareness', label: 'Awareness Core',  cron: 'live',        envKey: null },
  { id: 'trader',    label: 'Trader',          cron: '*/15 min',    envKey: null },
];

const CORE_SYSTEMS = [
  { id: 'telegram', label: 'Telegram',      file: '.telegram-status' },
  { id: 'gmail',    label: 'Gmail Monitor', file: null },
  { id: 'tom',      label: 'Theory of Mind',file: null },
  { id: 'memory',   label: 'Memory DB',     file: null },
  { id: 'mcp',      label: 'MCP Tools',     file: '.mcp.json' },
  { id: 'chain',    label: 'Soul Chain',    file: '.soul-chain-status' },
];

class EngineView {
  constructor(soulPath) {
    this.soulPath      = path.resolve(soulPath);
    this._modules      = null;   // from /api/modules
    this._modLastFetch = 0;
    this._fetchPending = false;
    this._events       = [];
    this._eventsLast   = 0;
    this._costs        = null;
    this._costsLast    = 0;
    this._envContent   = '';
    this._envLast      = 0;
    this.tick          = 0;
  }

  /* ── .env cache ──────────────────────────────────────── */
  _env() {
    const now = Date.now();
    if (now - this._envLast < 15000) return this._envContent;
    this._envLast = now;
    try { this._envContent = fs.readFileSync(path.join(this.soulPath, '.env'), 'utf-8'); }
    catch { this._envContent = ''; }
    return this._envContent;
  }

  _envVal(key) {
    const m = this._env().match(new RegExp(`^${key}=(.+)`, 'm'));
    return m ? m[1].trim() : null;
  }

  /* ── Fetch /api/modules ──────────────────────────────── */
  _fetchModules() {
    const now = Date.now();
    if (this._fetchPending || now - this._modLastFetch < 8000) return;
    this._fetchPending = true;
    this._modLastFetch = now;

    const port   = parseInt(this._envVal('API_PORT') || '3001');
    const apiKey = this._envVal('API_KEY') || '';

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/modules',
      method: 'GET',
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      timeout: 3000,
    }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try { this._modules = JSON.parse(data); } catch {}
        this._fetchPending = false;
      });
    });
    req.on('error',   () => { this._fetchPending = false; });
    req.on('timeout', () => { req.destroy(); this._fetchPending = false; });
    req.end();
  }

  /* ── Event stream ────────────────────────────────────── */
  _loadEvents() {
    const now = Date.now();
    if (now - this._eventsLast < 2000) return;
    this._eventsLast = now;
    try {
      const evFile = path.join(this.soulPath, '.soul-events', 'current.jsonl');
      const lines  = fs.readFileSync(evFile, 'utf-8').split('\n').filter(Boolean);
      this._events = lines.slice(-20).reverse().map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch { this._events = []; }
  }

  /* ── Cost tracking ───────────────────────────────────── */
  _loadCosts() {
    const now = Date.now();
    if (now - this._costsLast < 15000) return;
    this._costsLast = now;
    try {
      const today = new Date().toISOString().split('T')[0];
      const lines = fs.readFileSync(path.join(this.soulPath, '.soul-audit.jsonl'), 'utf-8')
                      .split('\n').filter(Boolean);
      let calls = 0, tokens = 0;
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          if (e.timestamp?.startsWith(today) && e.type === 'llm_call') {
            calls++;
            tokens += (e.tokens || e.promptTokens || 0) + (e.completionTokens || 0);
          }
        } catch {}
      }
      // Also try the costs file written by soul-engine
      try {
        const costsFile = path.join(this.soulPath, '.soul-costs');
        const c = JSON.parse(fs.readFileSync(costsFile, 'utf-8'));
        if (c.today) { calls = c.today.calls || calls; tokens = c.today.tokens || tokens; }
      } catch {}
      this._costs = { calls, tokens };
    } catch { this._costs = null; }
  }

  /* ── Render ──────────────────────────────────────────── */
  render() {
    this.tick += 0.1;
    this._fetchModules();
    this._loadEvents();
    this._loadCosts();

    const C     = PALETTE;
    const lines = [];
    const env   = this._env();

    // ── Title ─────────────────────────────────────────────
    const engineAlive = this._modules !== null;
    const engineDot   = engineAlive ? `${fg(C.wachstum)}●${RESET}` : `${fg(C.dimWhite)}●${RESET}`;
    const engineState = engineAlive ? `${fg(C.wachstum)}${DIM}connected${RESET}` : `${fg(C.dimWhite)}${DIM}offline${RESET}`;
    lines.push(`  ${fg(C.manifest)}${BOLD}⚙ ENGINE & AGENTS${RESET}  ${engineDot} ${engineState}`);
    lines.push('');

    // ── Server Agents ──────────────────────────────────────
    lines.push(`  ${fg(C.gold)}${BOLD}Server Agents${RESET}  ${fg(C.dimWhite)}${DIM}(server node only)${RESET}`);
    lines.push('');

    const getModStatus = (id) => {
      if (!this._modules) return null;
      if (Array.isArray(this._modules)) return this._modules.find(m => m.id === id || m.name?.toLowerCase().includes(id));
      return this._modules[id] || null;
    };

    const colW = 38;
    for (let i = 0; i < AGENTS.length; i += 2) {
      const a1 = AGENTS[i];
      const a2 = AGENTS[i + 1];

      const renderAgent = (a) => {
        if (!a) return ' '.repeat(colW);
        const envVal  = a.envKey ? this._envVal(a.envKey) : null;
        const enabled = a.envKey ? (envVal === 'true') : true;
        const mod     = getModStatus(a.id);

        let dot, detail;
        if (!enabled) {
          dot    = `${fg(C.dimWhite)}○${RESET}`;
          detail = `${fg(C.dimWhite)}${DIM}disabled${RESET}`;
        } else if (mod?.lastRun) {
          const agoMin = Math.round((Date.now() - new Date(mod.lastRun)) / 60000);
          const agoStr = agoMin < 60 ? `${agoMin}m ago` : `${Math.round(agoMin / 60)}h ago`;
          dot    = `${fg(C.wachstum)}●${RESET}`;
          detail = `${fg(C.bewusstsein)}${DIM}${agoStr}${RESET}`;
        } else {
          dot    = `${fg(C.wachstum)}●${RESET}`;
          detail = `${fg(C.dimWhite)}${DIM}${a.cron}${RESET}`;
        }

        const label   = a.label.substring(0, 16);
        const plain   = `● ${label}`;
        const pad     = ' '.repeat(Math.max(1, 22 - plain.length));
        return `${dot} ${fg(C.white)}${label}${RESET}${pad}${detail}`;
      };

      const left  = renderAgent(a1);
      const right = renderAgent(a2);
      const leftPlain = stripAnsi(left);
      lines.push(`  ${left}${' '.repeat(Math.max(1, colW - leftPlain.length))}${right}`);
    }

    // ── Core Systems ────────────────────────────────────────
    lines.push('');
    lines.push(`  ${fg(C.dimWhite)}${DIM}── Core Systems ───────────────────────────────${RESET}`);
    lines.push('');

    for (let i = 0; i < CORE_SYSTEMS.length; i += 3) {
      const row = CORE_SYSTEMS.slice(i, i + 3).map(sys => {
        const fileOk = sys.file ? fs.existsSync(path.join(this.soulPath, sys.file)) : engineAlive;
        const dot    = fileOk ? `${fg(C.wachstum)}●${RESET}` : `${fg(C.dimWhite)}●${RESET}`;
        const label  = sys.label.substring(0, 14);
        const plain  = `● ${label}`;
        return `${dot} ${fg(fileOk ? C.white : C.dimWhite)}${label}${RESET}${' '.repeat(Math.max(1, 20 - plain.length))}`;
      });
      lines.push(`  ${row.join('')}`);
    }

    // ── Event Stream ────────────────────────────────────────
    lines.push('');
    lines.push(`  ${fg(C.dimWhite)}${DIM}── Event Stream ───────────────────────────────${RESET}`);
    lines.push('');

    if (this._events.length === 0) {
      lines.push(`  ${fg(C.dimWhite)}${DIM}Waiting for events — .soul-events/current.jsonl${RESET}`);
    } else {
      for (const ev of this._events.slice(0, 9)) {
        const ts      = ev.timestamp || ev.time;
        const timeStr = ts ? new Date(ts).toLocaleTimeString('de', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '??:??';
        const type    = (ev.type || ev.event || 'event').substring(0, 22);
        const detail  = (ev.detail || ev.data?.detail || ev.message || ev.data?.searchId || '').toString().substring(0, 38);
        const tc      = eventTypeColor(type, C);
        lines.push(`  ${fg(C.dimWhite)}${DIM}${timeStr}${RESET}  ${fg(tc)}${type.padEnd(22)}${RESET}  ${fg(C.dimWhite)}${DIM}${detail}${RESET}`);
      }
    }

    // ── Cost Tracking ───────────────────────────────────────
    lines.push('');
    lines.push(`  ${fg(C.dimWhite)}${DIM}── Today's Cost ────────────────────────────────${RESET}`);
    lines.push('');

    if (this._costs) {
      const { calls, tokens } = this._costs;
      const tokStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}K` : `${tokens}`;
      // Rough cost estimate: Gemini 2.5 Pro ~$0.00125 per 1K tokens
      const estUSD = ((tokens / 1000) * 0.00125).toFixed(4);
      lines.push(
        `  ${fg(C.gold)}${BOLD}${calls}${RESET} ${fg(C.dimWhite)}API calls${RESET}   ` +
        `${fg(C.gold)}${BOLD}${tokStr}${RESET} ${fg(C.dimWhite)}tokens${RESET}   ` +
        `${fg(C.dimWhite)}${DIM}~$${estUSD}${RESET}`
      );
    } else {
      lines.push(`  ${fg(C.dimWhite)}${DIM}No cost data (.soul-audit.jsonl)${RESET}`);
    }

    // ── UPTIME_URLS summary ─────────────────────────────────
    const uptimeUrls = this._envVal('UPTIME_URLS');
    if (uptimeUrls) {
      lines.push('');
      lines.push(`  ${fg(C.dimWhite)}${DIM}── Monitored URLs ──────────────────────────────${RESET}`);
      lines.push('');
      for (const url of uptimeUrls.split(',').map(u => u.trim()).filter(Boolean)) {
        lines.push(`  ${fg(C.bewusstsein)}○${RESET} ${fg(C.white)}${url}${RESET}`);
      }
    }

    return lines.join('\n');
  }
}

/* ── Helpers ───────────────────────────────────────────── */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function eventTypeColor(type, C) {
  if (!type) return C.dimWhite;
  if (/error|fail/i.test(type))              return C.kern;
  if (/mail|telegram/i.test(type))           return C.bonds;
  if (/security|uptime|ssl/i.test(type))     return C.manifest;
  if (/briefing|search|news/i.test(type))    return C.interessen;
  if (/trader|profit|crypto/i.test(type))    return C.gold;
  if (/awareness|soul|tom/i.test(type))      return C.bewusstsein;
  if (/heartbeat|session/i.test(type))       return C.heartbeat;
  return C.cyan;
}

module.exports = { EngineView };
