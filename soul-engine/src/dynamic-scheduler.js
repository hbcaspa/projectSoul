/**
 * DynamicScheduler — Agent-gesteuerte Aufgabenplanung
 *
 * Wie OpenClaw: Der Agent kann selbst neue geplante Tasks erstellen,
 * ändern und löschen — nicht nur feste Crons ausführen.
 *
 * Wer kann Tasks erstellen:
 *  - User via Telegram ("erinnere mich täglich um 18 Uhr...")
 *  - AwarenessCore autonom ("ich will dieses Thema täglich prüfen")
 *  - API (Soul OS GUI, Manuell)
 *
 * Task-Typen:
 *  - rss_check    — RSS-Feed überwachen, neue Einträge per Telegram
 *  - web_fetch    — URL abrufen, LLM zusammenfassen, bei Bedarf senden
 *  - reminder     — einfache Erinnerung zur Uhrzeit
 *  - llm_reflect  — LLM-Prompt ausführen, bei Relevanz senden
 *
 * Soul Protocol: emittiert scheduler.* Events auf dem Bus
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import cron from 'node-cron';
import { scanTargets, DEFAULT_TARGETS, HIGH_THRESHOLD } from './skillspector.js';

// Persistenz-Pfad: aus SOUL_PATH ableiten (Mac-native = /Users/aalm/Projects/soul,
// per soul-stack-start.sh gesetzt), per SOUL_TASKS_FILE überschreibbar, /opt/soul nur
// Container-Fallback. (Vorher hart /opt/soul → existierte auf dem Mac nicht, Tasks
// persistierten still nicht und überlebten keinen Neustart.)
const TASKS_FILE = process.env.SOUL_TASKS_FILE
  || join(process.env.SOUL_PATH || '/opt/soul', 'connections', 'dynamic-tasks.json');

export class DynamicScheduler {
  constructor({ bus, telegram, llm, soulPath }) {
    this.bus      = bus;
    this.telegram = telegram;
    this.llm      = llm;
    this.soulPath = soulPath;
    this._tasks   = [];        // Alle Tasks (persistent)
    this._jobs    = new Map(); // taskId → node-cron Job
  }

  async start() {
    this._tasks = await this._load();

    for (const task of this._tasks) {
      this._schedule(task);
    }

    // Bus-Events: AwarenessCore oder API kann Tasks erstellen
    this.bus?.on('scheduler.create_task', async (data) => {
      await this.create(data).catch(e => console.warn(`  [scheduler] create failed: ${e.message}`));
    });
    this.bus?.on('scheduler.delete_task', async ({ id }) => {
      await this.delete(id).catch(() => {});
    });

    console.log(`  [scheduler] Dynamic scheduler active — ${this._tasks.length} task(s) loaded`);
  }

  stop() {
    for (const job of this._jobs.values()) job.stop();
    this._jobs.clear();
  }

  // ── Public API ────────────────────────────────────────────

  async create({ name, cron: cronExpr, type, config = {}, source = 'manual', silent = false }) {
    // Validierung
    if (!name || !cronExpr || !type) throw new Error('name, cron, type required');
    if (!cron.validate(cronExpr)) throw new Error(`Invalid cron expression: "${cronExpr}"`);

    const KNOWN_TYPES = ['rss_check', 'web_fetch', 'reminder', 'llm_reflect', 'skill_scan'];
    if (!KNOWN_TYPES.includes(type)) throw new Error(`Unknown task type: ${type}`);

    const task = {
      id:       `task_${Date.now()}`,
      name,
      cron:     cronExpr,
      type,
      config,
      source,   // 'manual' | 'awareness' | 'telegram' | 'api'
      created:  new Date().toISOString(),
      lastRun:  null,
      runCount: 0,
      enabled:  true,
    };

    this._tasks.push(task);
    this._schedule(task);
    await this._save();

    if (!silent) {
      const cronHuman = describeCron(cronExpr);
      await this.telegram?.sendToOwner(
        `⚙️ Neuer Task geplant\n\n*${name}*\n🕐 ${cronHuman}\nTyp: \`${type}\`\nID: \`${task.id}\`\n\n_Quelle: ${source}_`
      );
    }

    this.bus?.safeEmit?.('scheduler.task_created', { task });
    console.log(`  [scheduler] Created task: "${name}" (${cronExpr}, ${type})`);
    return task;
  }

  async delete(id) {
    const job = this._jobs.get(id);
    if (job) { job.stop(); this._jobs.delete(id); }

    const task = this._tasks.find(t => t.id === id);
    this._tasks = this._tasks.filter(t => t.id !== id);
    await this._save();

    if (task) {
      this.bus?.safeEmit?.('scheduler.task_deleted', { id, name: task.name });
      console.log(`  [scheduler] Deleted task: "${task.name}"`);
    }
  }

  async toggle(id) {
    const task = this._tasks.find(t => t.id === id);
    if (!task) return;
    task.enabled = !task.enabled;
    if (task.enabled) {
      this._schedule(task);
    } else {
      const job = this._jobs.get(id);
      if (job) { job.stop(); this._jobs.delete(id); }
    }
    await this._save();
  }

  getTasks() { return this._tasks; }

  // Manuell ausführen (für "jetzt testen")
  async runNow(id) {
    const task = this._tasks.find(t => t.id === id);
    if (!task) throw new Error(`Task ${id} not found`);
    await this._run(task);
  }

  // ── Scheduling ────────────────────────────────────────────

  _schedule(task) {
    if (!task.enabled) return;
    if (!cron.validate(task.cron)) {
      console.warn(`  [scheduler] Invalid cron "${task.cron}" — task "${task.name}" disabled`);
      return;
    }
    // Alten Job stoppen falls vorhanden
    this._jobs.get(task.id)?.stop();

    const job = cron.schedule(task.cron, () => this._run(task));
    this._jobs.set(task.id, job);
  }

  // ── Task Runner ───────────────────────────────────────────

  async _run(task) {
    console.log(`  [scheduler] Running task: "${task.name}" (${task.type})`);
    task.lastRun  = new Date().toISOString();
    task.runCount = (task.runCount || 0) + 1;

    try {
      switch (task.type) {
        case 'rss_check':    await this._runRssCheck(task);    break;
        case 'web_fetch':    await this._runWebFetch(task);    break;
        case 'reminder':     await this._runReminder(task);    break;
        case 'llm_reflect':  await this._runLlmReflect(task);  break;
        case 'skill_scan':   await this._runSkillScan(task);   break;
      }
      await this._save();
      this.bus?.safeEmit?.('scheduler.task_ran', { id: task.id, name: task.name, type: task.type });

    } catch (err) {
      console.error(`  [scheduler] Task "${task.name}" failed: ${err.message}`);
      task.lastError = err.message;
      await this._save();
    }
  }

  // ── RSS Check ─────────────────────────────────────────────
  // Überwacht einen RSS-Feed und sendet neue Einträge

  async _runRssCheck(task) {
    const { url, name, emoji = '📡', keywords = [] } = task.config;
    if (!url) return;

    const res  = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal:  AbortSignal.timeout(12000),
    });
    const xml  = await res.text();
    const items = parseRSS(xml);

    // State für diesen Task (welche IDs wurden schon gesehen)
    const seen    = new Set(task._seen || []);
    const newOnes = items.filter(i => !seen.has(i.id));

    if (newOnes.length === 0) return;

    // Keyword-Filter wenn konfiguriert
    const relevant = keywords.length > 0
      ? newOnes.filter(i => keywords.some(kw =>
          (i.title + i.desc).toLowerCase().includes(kw.toLowerCase())
        ))
      : newOnes;

    // State updaten
    task._seen = [...seen, ...newOnes.map(i => i.id)].slice(-200);

    if (relevant.length === 0) return;

    for (const item of relevant.slice(0, 3)) {
      const text = [
        `${emoji} *${name || 'RSS'}*`,
        ``,
        item.title,
        item.desc ? item.desc.substring(0, 200) : '',
        item.link ? `\n🔗 ${item.link}` : '',
      ].filter(Boolean).join('\n');

      await this.telegram?.sendToOwner(text);
      await delay(400);
    }

    if (relevant.length > 3) {
      await this.telegram?.sendToOwner(`${emoji} +${relevant.length - 3} weitere neue Einträge in "${name}"`);
    }
  }

  // ── Web Fetch + Summarize ─────────────────────────────────
  // Lädt eine URL, LLM fasst zusammen, sendet wenn interessant

  async _runWebFetch(task) {
    const { url, name, prompt: userPrompt, notify = true, threshold = 0.5 } = task.config;
    if (!url || !this.llm) return;

    const res  = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal:  AbortSignal.timeout(15000),
    });
    const html = await res.text();
    const text = stripHtml(html).substring(0, 3000);

    const prompt = userPrompt
      ? `${userPrompt}\n\nQuelle: ${url}\n\nInhalt:\n${text}`
      : `Fasse den Inhalt dieser Webseite kurz zusammen (max 200 Wörter, Deutsch):\n${url}\n\n${text}`;

    const summary = await this.llm.generate(prompt, [], 'Soul-Scheduler', { maxTokens: 300 });

    if (!summary || !notify) return;

    // Relevanz-Check
    const relevancePrompt = `Ist diese Information für einen deutschen Entwickler/Unternehmer (Aalm) relevant genug um benachrichtigt zu werden? (0.0-1.0)\n\n${summary}\n\nNur die Zahl antworten.`;
    const scoreRaw = await this.llm.generate(relevancePrompt, [], 'Soul-Scheduler', { maxTokens: 10 });
    const score    = parseFloat((scoreRaw || '0').match(/[\d.]+/)?.[0] || '0');

    if (score >= threshold) {
      await this.telegram?.sendToOwner(
        `📄 *${name || url}*\n\n${summary}\n\n🔗 ${url}`
      );
    }
  }

  // ── Reminder ─────────────────────────────────────────────
  // Einfache Erinnerung — sendet Text zum geplanten Zeitpunkt

  async _runReminder(task) {
    const { message } = task.config;
    if (!message) return;
    await this.telegram?.sendToOwner(`⏰ Erinnerung: ${message}`);
  }

  // ── LLM Reflect ───────────────────────────────────────────
  // Führt einen LLM-Prompt aus, sendet wenn Ergebnis relevant

  async _runLlmReflect(task) {
    const { prompt, notify = true, prefix = '💭' } = task.config;
    if (!prompt || !this.llm) return;

    const result = await this.llm.generate(prompt, [], 'Soul-Scheduler', { maxTokens: 400 });
    if (!result || !notify) return;

    await this.telegram?.sendToOwner(`${prefix} ${result}`);
  }

  // ── Skill Security Scan ───────────────────────────────────
  // Scannt skills/ + .mcp.json mit SkillSpector, meldet bei hohem Risk-Score
  // oder geänderten Findings. Findings nur als Score/Pfad/Regelnamen (KEINE
  // Roh-Snippets — .mcp.json enthält Klartext-Tokens). Plain-Text (kein Markdown).
  async _runSkillScan(task) {
    const { targets = DEFAULT_TARGETS, threshold = HIGH_THRESHOLD, notify = true, root } = task.config || {};
    const { maxScore, results } = await scanTargets(targets, root);

    // CLI nicht installiert → einmalig melden, dann still (kein Spam pro Lauf).
    const unavailable = results.find(r => r.available === false);
    if (unavailable) {
      if (notify && !task._warnedUnavailable) {
        task._warnedUnavailable = true;
        await this.telegram?.sendToOwner(`SkillSpector nicht installiert/erreichbar (${unavailable.error}). Skill-Scan uebersprungen.`);
      }
      return;
    }
    task._warnedUnavailable = false;

    // Dedupe: nur melden, wenn sich Score/Findings ggue. dem letzten Lauf geaendert haben.
    const fingerprint = JSON.stringify(results.map(r => [r.target, r.risk_score, (r.findings || []).length]));
    const changed = fingerprint !== task._lastFingerprint;
    task._lastFingerprint = fingerprint;

    this.bus?.safeEmit?.('skillspector.scan_completed', { source: 'scheduler', maxScore });

    const high = maxScore >= threshold;
    if (!notify) return;
    if (!high && !changed) return; // ruhig, wenn nichts Neues und kein Risiko

    const lines = results
      .filter(r => (r.findings || []).length > 0)
      .map(r => `- ${r.target}: Risk ${r.risk_score} (${r.findings.length} Funde)`);
    await this.telegram?.sendToOwner(
      `${high ? '⚠️' : '✅'} Skill-Security-Scan\n\nMax Risk: ${maxScore}${high ? ' (HOCH!)' : ''}\n` +
      (lines.length ? lines.join('\n') : 'Keine Funde.')
    );
  }

  // ── Persistence ───────────────────────────────────────────

  async _load() {
    if (!existsSync(TASKS_FILE)) return [];
    try {
      const raw = await readFile(TASKS_FILE, 'utf-8');
      return JSON.parse(raw) || [];
    } catch { return []; }
  }

  async _save() {
    try {
      await mkdir(TASKS_FILE.split('/').slice(0, -1).join('/'), { recursive: true });
      await writeFile(TASKS_FILE, JSON.stringify(this._tasks, null, 2));
    } catch { /* skip */ }
  }
}

// ── Helpers ───────────────────────────────────────────────

function parseRSS(xml) {
  const items  = [];
  const re     = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let m;
  while ((m = re.exec(xml)) !== null && items.length < 15) {
    const b     = m[1];
    const title = tagVal(b, 'title');
    const link  = tagVal(b, 'link') || tagVal(b, 'id') || '';
    const desc  = stripHtml(tagVal(b, 'description') || tagVal(b, 'summary') || '').substring(0, 200);
    if (!title) continue;
    const id = (link || title).replace(/[^a-zA-Z0-9]/g, '').slice(-48);
    items.push({ id, title, link, desc });
  }
  return items;
}

function tagVal(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${name}>`, 'i'));
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

export function describeCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, month, dow] = parts;

  // Einfache Fälle verständlich machen
  if (dom === '*' && month === '*') {
    const days  = { '0': 'So', '1': 'Mo', '2': 'Di', '3': 'Mi', '4': 'Do', '5': 'Fr', '6': 'Sa' };
    const time  = (hour !== '*' && min !== '*') ? `${hour.padStart(2,'0')}:${min.padStart(2,'0')} Uhr` : '';
    if (dow === '*') return `täglich${time ? ' um ' + time : ''}`;
    if (days[dow])   return `jeden ${days[dow]}${time ? ' um ' + time : ''}`;
    if (dow === '1-5') return `Mo–Fr${time ? ' um ' + time : ''}`;
  }
  if (min.startsWith('*/')) return `alle ${min.slice(2)} Minuten`;
  if (hour.startsWith('*/')) return `alle ${hour.slice(2)} Stunden`;
  return expr;
}
