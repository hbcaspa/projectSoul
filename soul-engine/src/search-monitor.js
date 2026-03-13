/**
 * SearchMonitor — Proaktiver Marktbeobachter
 *
 * Überwacht konfigurierte Suchen und meldet neue Treffer als
 * strukturierte Telegram-Nachrichten (Foto + Caption + Link-Button):
 *  - Immobilien: Wohnungen in Wunschregion (Kleinanzeigen RSS)
 *  - Leads: Website/Webdesign-Aufträge (Kleinanzeigen RSS)
 *
 * Konfiguration via .env:
 *   SEARCH_MONITOR_ENABLED=true
 *   SEARCH_INTERVAL_MIN=30
 *   SEARCH_IMMO_PLZ=28759
 *   SEARCH_IMMO_TYPE=miete
 *   SEARCH_LEADS_ENABLED=true
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const INTERVAL_MS = (parseInt(process.env.SEARCH_INTERVAL_MIN) || 30) * 60 * 1000;
const STATE_FILE  = '/opt/soul/connections/search-monitor-state.json';

const SEARCHES = [
  // Immobilien: Wohnungen per PLZ via Kleinanzeigen RSS
  {
    id:       'immo_bremen',
    name:     'Wohnungen',
    enabled:  () => !!process.env.SEARCH_IMMO_PLZ,
    rssUrl:   () => {
      const plz = process.env.SEARCH_IMMO_PLZ || '28759';
      return `https://www.kleinanzeigen.de/s-wohnung-mieten/${plz}/k0.rss`;
    },
    // WG-Gesucht HTML als Fallback
    fallbackUrl: () => {
      const plz = process.env.SEARCH_IMMO_PLZ || '28759';
      return `https://www.wg-gesucht.de/wohnungen-in-Bremen.8.2.1.0.html?offer_filter=1&city_id=8&noDeact=1&categories%5B%5D=2&rent_types%5B%5D=2`;
    },
    emoji:    '🏠',
    category: 'immobilien',
  },
  // Leads: Website-Aufträge auf Kleinanzeigen
  {
    id:      'ka_website',
    name:    'Website-Aufträge',
    enabled: () => process.env.SEARCH_LEADS_ENABLED !== 'false',
    rssUrl:  () => `https://www.kleinanzeigen.de/s-website+erstellen/k0.rss`,
    emoji:   '💼',
    category: 'lead',
  },
];

export class SearchMonitor {
  constructor({ bus, telegram, llm, soulPath }) {
    this.bus      = bus;
    this.telegram = telegram;
    this.llm      = llm;
    this.soulPath = soulPath;
    this.enabled  = process.env.SEARCH_MONITOR_ENABLED === 'true';
    this._timer   = null;
    this._state   = {};
  }

  async start() {
    if (!this.enabled) {
      console.log('  [search] Disabled (SEARCH_MONITOR_ENABLED != true)');
      return;
    }
    this._state = await this._loadState();
    this._firstRun = true;
    console.log(`  [search] Monitor active (${INTERVAL_MS / 60000} min interval)`);
    // 5 Min warten beim Start — vermeidet Flut bei Engine-Restart
    this._timer = setTimeout(() => this._tick(), 5 * 60 * 1000);
  }

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  async _tick() {
    const isFirst = this._firstRun;
    this._firstRun = false;
    try {
      for (const search of SEARCHES) {
        const isEnabled = typeof search.enabled === 'function' ? search.enabled() : search.enabled;
        if (!isEnabled) continue;
        await this._runSearch(search, isFirst);
      }
    } catch (err) {
      console.error(`  [search] Tick error: ${err.message}`);
    } finally {
      this._timer = setTimeout(() => this._tick(), INTERVAL_MS);
    }
  }

  async _runSearch(search, silentRun = false) {
    try {
      const url     = typeof search.rssUrl === 'function' ? search.rssUrl() : search.rssUrl;
      const results = await this._fetch(url, search);

      if (!results.length) return;

      const seen    = new Set(this._state[search.id] || []);
      const newOnes = results.filter(r => !seen.has(r.id));

      // Erster Lauf: nur State aufbauen, keine Benachrichtigungen
      if (silentRun || !this._state[search.id]) {
        this._state[search.id] = results.map(r => r.id);
        await this._saveState();
        console.log(`  [search] Init "${search.name}": ${results.length} bekannte Einträge`);
        return;
      }

      if (!newOnes.length) return;

      console.log(`  [search] ${newOnes.length} neue Treffer: ${search.name}`);

      // State aktualisieren
      this._state[search.id] = [...seen, ...newOnes.map(r => r.id)].slice(-200);
      await this._saveState();

      // Max. 3 einzelne Benachrichtigungen
      for (const item of newOnes.slice(0, 3)) {
        await this._notify(search, item);
        await new Promise(r => setTimeout(r, 600));
      }

      if (newOnes.length > 3) {
        await this.telegram?.sendToOwner(
          `${search.emoji} +${newOnes.length - 3} weitere neue ${search.name}`
        );
      }

      this.bus?.safeEmit?.('search.new_result', {
        searchId:  search.id,
        name:      search.name,
        count:     newOnes.length,
        category:  search.category,
        timestamp: new Date().toISOString(),
      });

    } catch (err) {
      console.warn(`  [search] Fehler (${search.name}): ${err.message}`);
    }
  }

  // ── Benachrichtigung je nach Kategorie ───────────────────

  async _notify(search, item) {
    if (search.category === 'immobilien') {
      await this._sendImmoAlert(item);
    } else {
      await this._sendLeadAlert(item);
    }
  }

  async _sendImmoAlert(item) {
    const d = item.details || {};
    const parts = [];

    // Strukturierte Zeilen
    if (d.rooms || d.size || d.price) {
      const specs = [d.rooms, d.size, d.price].filter(Boolean).join(' · ');
      parts.push(`<b>${specs}</b>`);
    }
    if (item.title) parts.push(item.title);
    if (d.location || d.district) parts.push(`📍 ${d.location || d.district}`);
    if (item.desc && !item.desc.includes(item.title)) {
      const shortDesc = item.desc.replace(/\s+/g, ' ').trim().substring(0, 200);
      if (shortDesc.length > 20) parts.push(`\n${shortDesc}`);
    }
    if (item.date) parts.push(`\n📅 ${formatDate(item.date)}`);

    const caption = `🏠 <b>Neue Wohnung</b>\n\n${parts.join('\n')}`;

    if (item.imageUrl) {
      await this.telegram?.sendPhotoToOwner(item.imageUrl, caption, item.link);
    } else if (item.link) {
      await this.telegram?.sendWithButtons(caption, [[{ text: '🔗 Zur Anzeige', url: item.link }]]);
    } else {
      await this.telegram?.sendToOwner(stripHtml(caption));
    }
  }

  async _sendLeadAlert(item) {
    const d = item.details || {};
    const parts = [`💼 <b>Website-Auftrag erkannt!</b>\n`];

    parts.push(`<b>${item.title}</b>`);
    if (item.desc) {
      const shortDesc = item.desc.replace(/\s+/g, ' ').trim().substring(0, 250);
      if (shortDesc.length > 10) parts.push(shortDesc);
    }
    if (d.price) parts.push(`💰 Budget: ${d.price}`);
    if (d.location) parts.push(`📍 ${d.location}`);
    if (item.date) parts.push(`📅 ${formatDate(item.date)}`);
    parts.push(`\nAngebotsmail vorbereiten?`);

    const text = parts.join('\n');

    if (item.link) {
      await this.telegram?.sendWithButtons(text, [[{ text: '🔗 Zur Anzeige', url: item.link }]]);
    } else {
      await this.telegram?.sendToOwner(stripHtml(text));
    }
  }

  // ── Fetch + Parse ─────────────────────────────────────────

  async _fetch(url, search) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0',
        'Accept':     'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    if (text.includes('<item') || text.includes('<entry')) {
      return this._parseRSS(text, search);
    }
    return this._parseHTML(text, search);
  }

  _parseRSS(xml, search) {
    const items  = [];
    const itemRe = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
    let m;

    while ((m = itemRe.exec(xml)) !== null && items.length < 15) {
      const block  = m[1];
      const title  = cleanText(this._tag(block, 'title'));
      const link   = cleanUrl(this._tag(block, 'link') || this._tag(block, 'id') || '');
      const rawDesc = this._tag(block, 'description') || this._tag(block, 'summary') || '';
      const date   = this._tag(block, 'pubDate') || this._tag(block, 'updated') || '';
      const enclosureM = block.match(/<enclosure[^>]+url="([^"]+)"/i);

      if (!title || !link) continue;

      const id       = link.replace(/[^a-zA-Z0-9]/g, '').slice(-48) || title.replace(/\s/g,'').slice(0,48);
      const desc     = stripHtml(rawDesc).trim().substring(0, 300);
      const imageUrl = enclosureM ? enclosureM[1] : this._extractImage(rawDesc);
      const details  = this._extractDetails(title, rawDesc);

      items.push({ id, title, link, desc, date, imageUrl, details });
    }
    return items;
  }

  _parseHTML(html, search) {
    // WG-Gesucht HTML — parse listing cards
    const items = [];

    // Try to find listing cards (WG-Gesucht structure)
    const cardRe = /<div[^>]+class="[^"]*(?:wgg_card|offer_list_item)[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    let m;
    while ((m = cardRe.exec(html)) !== null && items.length < 10) {
      const block = m[1];
      const titleM = block.match(/<a[^>]+href="([^"]+)"[^>]*>\s*([^<]{5,100})/);
      if (!titleM) continue;
      const link     = titleM[1].startsWith('http') ? titleM[1] : `https://www.wg-gesucht.de${titleM[1]}`;
      const title    = titleM[2].trim();
      const imageM   = block.match(/<img[^>]+src="(https?:\/\/[^"]+\.(jpg|jpeg|png|webp)[^"]*)"/i);
      const imageUrl = imageM ? imageM[1] : null;
      const details  = this._extractDetails(title, block);
      const id       = link.replace(/[^a-zA-Z0-9]/g, '').slice(-48);
      items.push({ id, title, link, desc: '', date: '', imageUrl, details });
    }

    // Generic fallback: extract linked headings
    if (items.length === 0) {
      const hRe = /<(?:h[23]|a)[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/(?:h[23]|a)>/gi;
      while ((m = hRe.exec(html)) !== null && items.length < 10) {
        const title = stripHtml(m[2]).trim();
        const link  = m[1];
        if (title.length < 5 || title.length > 150) continue;
        const id = link.replace(/[^a-zA-Z0-9]/g, '').slice(-48);
        items.push({ id, title, link, desc: '', date: '', imageUrl: null, details: {} });
      }
    }

    return items;
  }

  // ── Extract helpers ───────────────────────────────────────

  _extractImage(html) {
    // Kleinanzeigen: <img src="https://img.ebayimg.com/...">
    const m = html.match(/<img[^>]+src="(https?:\/\/[^"]+\.(jpg|jpeg|png|webp)(?:\?[^"]*)?)"[^>]*>/i);
    return m ? m[1] : null;
  }

  _extractDetails(title, text) {
    const combined = `${title} ${stripHtml(text)}`;
    const details  = {};

    // Preis
    const priceM = combined.match(/(\d[\d.]+)\s*€(?:\/(?:Mon|Monat|mo))?/i)
                || combined.match(/(?:Miete|Kaltmiete|Warmmiete|VB)[\s:]*(\d[\d.]+)\s*€/i);
    if (priceM) details.price = `${priceM[1]} €/Monat`;

    // Größe
    const sizeM = combined.match(/(\d+(?:[.,]\d+)?)\s*m[²2]/i);
    if (sizeM) details.size = `${sizeM[1]} m²`;

    // Zimmer
    const roomsM = combined.match(/(\d+(?:[.,]\d)?)\s*[-–]?\s*(?:Zimmer|Zi\.)/i)
                || combined.match(/(\d+(?:[.,]\d)?)-?ZKB/i)
                || title.match(/^(\d+)-Zimmer/i);
    if (roomsM) details.rooms = `${roomsM[1]}-Zi.`;

    // Ort / Stadtteil
    const locM = combined.match(/(?:in|Im?|@)\s+([A-ZÄÖÜ][a-zäöüß-]+([-\s][A-ZÄÖÜ][a-zäöüß-]+){0,2})/);
    if (locM) details.location = locM[1];

    return details;
  }

  _tag(xml, name) {
    const m = xml.match(new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${name}>`, 'i'));
    return m ? m[1].trim() : null;
  }

  // ── State persistence ─────────────────────────────────────

  async _loadState() {
    if (!existsSync(STATE_FILE)) return {};
    try { return JSON.parse(await readFile(STATE_FILE, 'utf-8')); }
    catch { return {}; }
  }

  async _saveState() {
    try {
      await mkdir(STATE_FILE.split('/').slice(0, -1).join('/'), { recursive: true });
      await writeFile(STATE_FILE, JSON.stringify(this._state, null, 2));
    } catch { /* skip */ }
  }
}

// ── Helpers ───────────────────────────────────────────────

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

function cleanText(t) {
  return t ? stripHtml(t).replace(/\s+/g, ' ').trim() : '';
}

function cleanUrl(url) {
  return url ? url.split('?')[0].split('#')[0].trim() : '';
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr.substring(0, 30);
    return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr.substring(0, 30);
  }
}
