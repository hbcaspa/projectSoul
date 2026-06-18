/**
 * BriefingAgent — Tägliches Morning Briefing
 *
 * Sendet täglich um 07:30 ein kuratiertes Briefing via Telegram:
 *  - Trader-Status (Phase, Signal)
 *  - Tech-News (Heise, Golem, HackerNews) — gefiltert nach Interessen
 *  - KI-News (Anthropic, The Verge AI, VentureBeat)
 *  - Welt & Politik (Tagesschau)
 *  - Bundesliga (Ergebnisse + Tabelle via OpenLigaDB)
 *  - Security-Status (kurz)
 *
 * Konfiguration via .env:
 *   BRIEFING_ENABLED=true
 *   BRIEFING_CRON=30 7 * * *        (täglich 07:30 UTC)
 *   BRIEFING_INTRADAY_CRON=0 x/2 x x x  (alle 2h Breaking-News-Check, x = Stern)
 *   BRIEFING_CITY=Bremen            (für lokale Infos)
 *   BRIEFING_FOOTBALL=true          (Bundesliga an/aus)
 *
 * Soul Protocol: liest seele/INTERESSEN.md für personalisierte Filterung
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import cron from 'node-cron';

const RSS_SOURCES = [
  { name: 'Heise',       url: 'https://www.heise.de/rss/heise-atom.xml',         tags: ['tech'] },
  { name: 'Golem',       url: 'https://rss.golem.de/rss.php?feed=RSS2.0',        tags: ['tech'] },
  { name: 'Tagesschau',  url: 'https://www.tagesschau.de/xml/rss2',              tags: ['news', 'politik'] },
  { name: 'HackerNews',  url: 'https://hnrss.org/frontpage?count=20',            tags: ['tech', 'ai'] },
  { name: 'The Verge AI',url: 'https://www.theverge.com/ai-artificial-intelligence/rss/index.xml', tags: ['ai'] },
  { name: 'VentureBeat', url: 'https://venturebeat.com/feed/',                   tags: ['ai', 'tech'] },
];

export class BriefingAgent {
  constructor({ bus, telegram, llm, soulPath, trader, securityAgent }) {
    this.bus           = bus;
    this.telegram      = telegram;
    this.llm           = llm;
    this.soulPath      = soulPath;
    this.trader        = trader;
    this.securityAgent = securityAgent;
    this.task           = null;
    this.intradayTask   = null;
    this.enabled        = process.env.BRIEFING_ENABLED === 'true';
    this.cronExpr       = process.env.BRIEFING_CRON || '30 7 * * *';
    this.intradayCron   = process.env.BRIEFING_INTRADAY_CRON || '0 */2 * * *';
    this.city           = process.env.BRIEFING_CITY || '';
    this.footballOn     = process.env.BRIEFING_FOOTBALL !== 'false';
    // Tracks article IDs already sent today (intraday dedup)
    this._sentToday     = new Set();
    this._sentDate      = '';
    // Learning: tracks which topics user engages with
    this._topicScores   = {};
  }

  start() {
    if (!this.enabled) {
      console.log('  [briefing] Disabled (BRIEFING_ENABLED != true)');
      return;
    }

    this.task = cron.schedule(this.cronExpr, async () => {
      try {
        this._resetDailyDedup();
        await this.runBriefing();
      }
      catch (err) { console.error(`  [briefing] Cron error: ${err.message}`); }
    });

    // Intraday check: scan for breaking/high-relevance news between briefings
    this.intradayTask = cron.schedule(this.intradayCron, async () => {
      try { await this.runIntradayCheck(); }
      catch (err) { console.error(`  [briefing] Intraday error: ${err.message}`); }
    });

    // Manual trigger via event bus
    this.bus?.on('briefing.run', async () => {
      console.log('  [briefing] Manual trigger via event bus');
      await this.runBriefing();
    });

    // Learn from user feedback: 'briefing.topic.boost' / 'briefing.topic.mute'
    this.bus?.on('briefing.topic.boost', ({ topic }) => {
      this._topicScores[topic] = (this._topicScores[topic] || 1) * 1.3;
      console.log(`  [briefing] Topic boosted: ${topic} → ${this._topicScores[topic].toFixed(2)}`);
    });
    this.bus?.on('briefing.topic.mute', ({ topic }) => {
      this._topicScores[topic] = (this._topicScores[topic] || 1) * 0.5;
      console.log(`  [briefing] Topic muted: ${topic} → ${this._topicScores[topic].toFixed(2)}`);
    });

    console.log(`  [briefing] Agent scheduled — cron: ${this.cronExpr}`);
  }

  stop() {
    if (this.task)         { this.task.stop();         this.task = null; }
    if (this.intradayTask) { this.intradayTask.stop();  this.intradayTask = null; }
  }

  _resetDailyDedup() {
    this._sentToday.clear();
    this._sentDate = new Date().toISOString().slice(0, 10);
  }

  // ── Main ──────────────────────────────────────────────

  async runBriefing() {
    console.log('  [briefing] Building morning briefing...');

    const [articles, interests, traderStatus, football] = await Promise.all([
      this._fetchAllRSS(),
      this._loadInterests(),
      this._getTraderStatus(),
      this.footballOn ? this._getFootball() : Promise.resolve(null),
    ]);

    console.log(`  [briefing] ${articles.length} articles fetched, filtering...`);
    const filtered = await this._filterByInterests(articles, interests);

    // Mark all morning briefing articles as sent so intraday check won't resend them
    const today = new Date().toISOString().slice(0, 10);
    if (this._sentDate !== today) this._resetDailyDedup();
    for (const a of filtered) {
      const id = (a.link || a.title).replace(/[^a-zA-Z0-9]/g, '').slice(0, 60);
      this._sentToday.add(id);
    }

    const briefing = this._buildBriefing(filtered, interests, traderStatus, football);

    // Send in chunks (Telegram 4096 char limit)
    const chunks = chunkMessage(briefing, 3800);
    for (const chunk of chunks) {
      await this.telegram.sendToOwner(chunk);
      if (chunks.length > 1) await new Promise(r => setTimeout(r, 600));
    }

    console.log('  [briefing] Briefing sent.');

    // Soul Protocol: emit event
    this.bus?.safeEmit?.('briefing.sent', {
      timestamp:    new Date().toISOString(),
      articleCount: filtered.length,
      hasFootball:  !!football,
    });
  }

  // ── Intraday Breaking-News Check ──────────────────────

  async runIntradayCheck() {
    // Reset dedup if day changed
    const today = new Date().toISOString().slice(0, 10);
    if (this._sentDate !== today) this._resetDailyDedup();

    // Morning briefing just ran — skip first intraday check to avoid double-send
    const now = new Date();
    const hourUTC = now.getUTCHours();
    if (hourUTC === 7 || hourUTC === 8) return;

    const [articles, interests] = await Promise.all([
      this._fetchAllRSS(),
      this._loadInterests(),
    ]);

    // Filter out already sent
    const fresh = articles.filter(a => {
      const id = (a.link || a.title).replace(/[^a-zA-Z0-9]/g, '').slice(0, 60);
      return !this._sentToday.has(id);
    });

    if (!fresh.length) return;

    // Ask LLM: which of these is genuinely breaking / worth interrupting for?
    const urgent = await this._scoreUrgency(fresh, interests);
    if (!urgent.length) return;

    // KEIN roher Breaking-Ticker mehr an Telegram (ein Freund forwardet keine
    // Schlagzeilen alle 2h, schon gar nicht nachts). Wir füttern nur das interne
    // 'briefing.breaking'-Event — die Seele (AwarenessCore, Pfad D) entscheidet
    // GEGATET (Ruhezeiten + Budget + Relevanz "betrifft das Aaln konkret?" + warmer
    // Ton), ob sie sich von sich aus dazu meldet. So bleibt Weltwahrnehmung erhalten,
    // ohne Nacht-Spam/Doppel-Send.
    for (const item of urgent) {
      const id = (item.link || item.title).replace(/[^a-zA-Z0-9]/g, '').slice(0, 60);
      this._sentToday.add(id);

      this.bus?.safeEmit?.('briefing.breaking', {
        title:     item.title,
        source:    item.source,
        timestamp: new Date().toISOString(),
      });

      console.log(`  [briefing] Breaking erfasst (nur intern, kein Ticker): ${item.title.slice(0, 60)}`);
    }
  }

  async _scoreUrgency(articles, interests) {
    if (!this.llm || !articles.length) return [];

    const titles = articles.map((a, i) => `${i}: [${a.source}] ${a.title}`).join('\n');

    const prompt = `Du bist ein Nachrichten-Redakteur. Entscheide welche dieser Artikel SOFORT gesendet werden sollen — nicht bis zum nächsten Morgen warten können.

Kriterien für Sofort-Sendung:
- Neue KI-Modelle/Releases (Claude, GPT, Gemini, Grok, etc.)
- Kritische Sicherheitslücken die breite Systeme betreffen
- Große politische Ereignisse (Wahlergebnisse, Regierungsentscheidungen)
- Krypto: extreme Marktbewegungen >10%, regulatorische Entscheidungen
- Technologie: Firmenpleiten, Übernahmen großer Player
- Breaking News: Naturkatastrophen, Krisen

Nutzer-Interessen: ${interests.slice(0, 300)}

Artikel:
${titles}

Antworte NUR mit kommaseparierten Nummern der sofort-relevanten Artikel, oder "keine" wenn nichts dringend ist.
Maximal 3 Artikel. Strenger Filter — lieber zu wenig als zu viel.`;

    try {
      const result = await this.llm.generate(prompt, [], '', { maxTokens: 30, temperature: 0 }) || '';
      if (result.toLowerCase().includes('keine')) return [];
      const indices = result.match(/\d+/g)?.map(Number).filter(n => n < articles.length) || [];
      return indices.slice(0, 3).map(i => articles[i]).filter(Boolean);
    } catch {
      return [];
    }
  }

  // ── RSS ───────────────────────────────────────────────

  async _fetchAllRSS() {
    const results = await Promise.allSettled(
      RSS_SOURCES.map(src => this._fetchRSS(src))
    );
    return results
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);
  }

  async _fetchRSS({ name, url, tags }) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'SoulOS/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      const xml = await res.text();
      return this._parseRSS(xml, name, tags);
    } catch (err) {
      console.warn(`  [briefing] RSS fetch failed (${name}): ${err.message}`);
      return [];
    }
  }

  _parseRSS(xml, source, tags) {
    const items = [];
    const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
      const block = match[1];
      const title = this._extractTag(block, 'title');
      const desc  = this._extractTag(block, 'description') || this._extractTag(block, 'summary');
      const link  = this._extractTag(block, 'link');
      if (title) items.push({ title, desc: desc?.slice(0, 200) || '', source, tags, link });
    }
    return items;
  }

  _extractTag(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
    return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
  }

  // ── Interests ─────────────────────────────────────────

  async _loadInterests() {
    try {
      const path = join(this.soulPath, 'seele', 'INTERESSEN.md');
      if (existsSync(path)) {
        const content = await readFile(path, 'utf-8');
        return content.slice(0, 2000);
      }
    } catch { /* skip */ }
    return 'KI, Software-Entwicklung, Krypto, Sicherheit, Technologie, Politik';
  }

  async _filterByInterests(articles, interests) {
    if (!this.llm || articles.length === 0) return articles.slice(0, 12);

    const titles = articles.map((a, i) => `${i}: [${a.source}] ${a.title}`).join('\n');

    const prompt = `Du bist ein persönlicher Briefing-Assistent. Wähle die 8-12 relevantesten Artikel aus.

Interessen des Nutzers:
${interests}

Artikel:
${titles}

Wähle die Nummern der relevantesten Artikel. Bevorzuge: KI-News, neue Modelle/Tools, Sicherheit, Krypto-Regulation, deutsche Politik mit Tech-Bezug, Social-Media-Trends. Ignoriere: reine Werbung, Sport außer Fußball, Lifestyle.

Antworte NUR mit kommaseparierten Nummern, z.B.: 0,3,5,7,11`;

    try {
      const result = await this.llm.generate(prompt, [], '', { maxTokens: 50, temperature: 0 }) || '';
      const indices = result.match(/\d+/g)?.map(Number).filter(n => n < articles.length) || [];
      const selected = indices.map(i => articles[i]).filter(Boolean);
      return selected.length >= 4 ? selected : articles.slice(0, 10);
    } catch {
      return articles.slice(0, 10);
    }
  }

  // ── Trader Status ──────────────────────────────────────

  async _getTraderStatus() {
    if (!this.trader) return null;
    try {
      const summary = await this.trader.getPortfolioSummary();
      return summary;
    } catch { return null; }
  }

  // ── Football (OpenLigaDB — kostenlos, kein API-Key) ───

  async _getFootball() {
    try {
      // Bundesliga Season 2024/25 — letzte Spieltag-Ergebnisse
      const [resultsRes, tableRes] = await Promise.all([
        fetch('https://api.openligadb.de/getmatchdata/bl1/2024/34', { signal: AbortSignal.timeout(6000) }),
        fetch('https://api.openligadb.de/getbltable/bl1/2024', { signal: AbortSignal.timeout(6000) }),
      ]);

      // Find current matchday dynamically
      const currentRes = await fetch('https://api.openligadb.de/getcurrentgroup/bl1', { signal: AbortSignal.timeout(6000) });
      const currentGroup = await currentRes.json().catch(() => ({ groupOrderID: 34 }));
      const matchday = currentGroup.groupOrderID || 34;

      const matchRes = await fetch(`https://api.openligadb.de/getmatchdata/bl1/2024/${matchday}`, { signal: AbortSignal.timeout(6000) });
      const matches = await matchRes.json();
      const table   = await tableRes.json().catch(() => []);

      const finished = matches.filter(m => m.matchIsFinished);
      if (!finished.length && !table.length) return null;

      return { matches: finished.slice(0, 6), table: table.slice(0, 5), matchday };
    } catch (err) {
      console.warn(`  [briefing] Football fetch failed: ${err.message}`);
      return null;
    }
  }

  // ── Build Briefing ─────────────────────────────────────

  _buildBriefing(articles, interests, trader, football) {
    const date = new Date().toLocaleDateString('de', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
    const lines = [`🌅 Guten Morgen — ${date}\n`];

    // Trader
    if (trader) {
      const phase = trader.last_signal?.s8_phase || 'UNKNOWN';
      const phaseEmoji = { ALT_SEASON:'🚀', ROTATION_ACTIVE:'🔄', ROTATION_EARLY:'⚡', BTC_SEASON:'₿', EXIT:'🔴' }[phase] || '📊';
      const pnl = trader.total_pnl_eur;
      const pnlStr = pnl != null ? ` | PnL: ${pnl >= 0 ? '+' : ''}€${pnl.toFixed(2)}` : '';
      lines.push(`${phaseEmoji} Trader: Phase ${phase} | Win-Rate: ${trader.win_rate_pct}%${pnlStr} | Positionen: ${trader.open_positions?.length || 0}/3\n`);
    }

    // News by source group
    const aiArticles   = articles.filter(a => a.tags.includes('ai'));
    const techArticles = articles.filter(a => a.tags.includes('tech') && !a.tags.includes('ai'));
    const newsArticles = articles.filter(a => a.tags.includes('news') || a.tags.includes('politik'));

    if (aiArticles.length) {
      lines.push('💡 KI & Technologie:');
      aiArticles.slice(0, 4).forEach(a => lines.push(`  • [${a.source}] ${a.title}`));
      lines.push('');
    }

    if (techArticles.length) {
      lines.push('🔧 Tech:');
      techArticles.slice(0, 3).forEach(a => lines.push(`  • [${a.source}] ${a.title}`));
      lines.push('');
    }

    if (newsArticles.length) {
      lines.push('🌍 Welt & Politik:');
      newsArticles.slice(0, 3).forEach(a => lines.push(`  • [${a.source}] ${a.title}`));
      lines.push('');
    }

    // Football
    if (football) {
      lines.push(`⚽ Bundesliga — Spieltag ${football.matchday}:`);
      if (football.matches.length) {
        football.matches.forEach(m => {
          const home = m.team1?.shortName || m.team1?.teamName || '?';
          const away = m.team2?.shortName || m.team2?.teamName || '?';
          const g1   = m.matchResults?.find(r => r.resultTypeID === 2)?.pointsTeam1 ?? '-';
          const g2   = m.matchResults?.find(r => r.resultTypeID === 2)?.pointsTeam2 ?? '-';
          lines.push(`  ${home} ${g1}:${g2} ${away}`);
        });
      }
      if (football.table.length) {
        lines.push('  Top 5:');
        football.table.slice(0, 5).forEach((t, i) =>
          lines.push(`  ${i+1}. ${t.shortName || t.teamName} (${t.points} Pkt)`)
        );
      }
      lines.push('');
    }

    lines.push('─────────────────────');
    lines.push('Antwort mit "mehr [Thema]" für Details');

    return lines.join('\n');
  }
}

// ── Helpers ───────────────────────────────────────────────

function chunkMessage(text, maxLen = 3800) {
  const chunks = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut < maxLen / 2) cut = maxLen;
    chunks.push(rest.substring(0, cut));
    rest = rest.substring(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks;
}
