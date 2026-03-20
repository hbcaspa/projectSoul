import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

const POLL_INTERVAL_MS = (parseInt(process.env.GMAIL_POLL_INTERVAL_MIN) || 15) * 60 * 1000;
const STATE_FILE = process.env.GMAIL_STATE_FILE || '/opt/soul/connections/gmail-state.json';

/**
 * GmailMonitor — autonomous email watcher.
 *
 * Every POLL_INTERVAL_MS:
 *   1. Fetch new emails since last check (via Gmail historyId)
 *   2. Classify each as spam / info / wichtig / aktion_erforderlich
 *   3. Send a compact Telegram digest (only if new non-spam emails exist)
 *   4. Persist historyId so nothing is processed twice
 */
// Categories that get immediate individual alerts (not bundled into digest)
const URGENT_CATEGORIES = ['mahnung', 'rechnung_offen', 'kuendigung', 'behoerde', 'rechtlich'];

export class GmailMonitor {
  constructor({ soulPath, llm, telegram, bus, clientId, clientSecret, refreshToken }) {
    this.soulPath = soulPath;
    this.llm = llm;
    this.telegram = telegram;
    this.bus = bus;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this._accessToken = null;
    this._tokenExpiry = 0;
    this._timer = null;
    this._running = false;
  }

  start() {
    if (!this.clientId || !this.clientSecret || !this.refreshToken) {
      console.log('  Gmail:     disabled (no credentials)');
      return;
    }
    if (!this.telegram) {
      console.log('  Gmail:     disabled (no Telegram channel)');
      return;
    }
    console.log(`  Gmail:     monitoring active (every ${POLL_INTERVAL_MS / 60000} min)`);
    // First check after 1 minute (let engine fully start first)
    setTimeout(() => this._tick(), 60 * 1000);
  }

  stop() {
    if (this._timer) clearTimeout(this._timer);
  }

  // ── Core loop ──────────────────────────────────────────

  async _tick() {
    if (this._running) return;
    this._running = true;

    try {
      await this._checkNewEmails();
    } catch (err) {
      console.error(`  [gmail-monitor] Error: ${err.message}`);
    } finally {
      this._running = false;
      this._timer = setTimeout(() => this._tick(), POLL_INTERVAL_MS);
    }
  }

  async _checkNewEmails() {
    const state = await this._loadState();
    const newMessages = await this._fetchNewMessages(state.historyId, state.lastMessageId);

    if (!newMessages.length) return;

    console.log(`  [gmail-monitor] ${newMessages.length} new email(s)`);

    // Classify and build digest
    const classified = [];
    for (const msg of newMessages.slice(0, 20)) { // max 20 per cycle
      try {
        const detail = await this._fetchEmailDetail(msg.id);
        const category = await this._classify(detail);
        const isUrgent = URGENT_CATEGORIES.includes(category);
        const [summary, urgency] = await Promise.all([
          this._summarize(detail),
          isUrgent ? this._extractUrgency(detail) : Promise.resolve({}),
        ]);
        classified.push({ ...detail, category, summary, urgency });
      } catch (err) {
        console.error(`  [gmail-monitor] classify error: ${err.message}`);
      }
    }

    // Save new historyId / lastMessageId
    const newState = {
      historyId: newMessages[0].historyId || state.historyId,
      lastMessageId: newMessages[0].id,
      lastCheck: new Date().toISOString(),
    };
    await this._saveState(newState);

    // Filter: skip spam
    const relevant = classified.filter(m => m.category !== 'spam');
    if (!relevant.length) {
      const spamCount = classified.filter(m => m.category === 'spam').length;
      console.log(`  [gmail-monitor] All ${spamCount} emails classified as spam — no notification`);
      return;
    }

    // Urgent mails: send immediately, individually, with action proposals
    const urgent = relevant.filter(m => URGENT_CATEGORIES.includes(m.category));
    const normal = relevant.filter(m => !URGENT_CATEGORIES.includes(m.category));

    for (const mail of urgent) {
      const alert = this._buildUrgentAlert(mail);
      await this.telegram.sendToOwner(alert);
      console.log(`  [gmail-monitor] Urgent alert sent: ${mail.category} — "${mail.subject}"`);

      // Soul Protocol: emit event on bus
      this.bus?.safeEmit?.('mail.urgent', {
        category:  mail.category,
        from:      mail.from,
        subject:   mail.subject,
        summary:   mail.summary,
        urgency:   mail.urgency,
        timestamp: new Date().toISOString(),
      });
    }

    // Normal mails: digest as before
    if (normal.length) {
      const digest = this._buildDigest(normal, classified.length - urgent.length);
      await this.telegram.sendToOwner(digest);
    }

    console.log(`  [gmail-monitor] Done: ${urgent.length} urgent alerts, ${normal.length} in digest, ${classified.length - relevant.length} spam`);
  }

  // ── Gmail API ──────────────────────────────────────────

  async _fetchNewMessages(historyId, lastMessageId) {
    if (historyId) {
      // Use history API for incremental fetch
      try {
        const token = await this._getToken();
        const res = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${historyId}&historyTypes=messageAdded`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();

        if (data.error) throw new Error(data.error.message);

        const messages = [];
        for (const record of (data.history || [])) {
          for (const added of (record.messagesAdded || [])) {
            messages.push({ id: added.message.id, historyId: data.historyId });
          }
        }
        return messages;
      } catch (err) {
        // historyId might be expired — fall back to listing
        console.log(`  [gmail-monitor] History expired, falling back to list`);
      }
    }

    // First run or fallback: fetch last 10 unseen messages
    const token = await this._getToken();
    const res = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=10',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    if (!data.messages) return [];

    // Get current historyId for future incremental fetches
    const profileRes = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const profile = await profileRes.json();

    // Filter out already seen
    const messages = data.messages
      .filter(m => !lastMessageId || m.id > lastMessageId)
      .map(m => ({ ...m, historyId: profile.historyId }));

    return messages;
  }

  async _fetchEmailDetail(id) {
    const token = await this._getToken();
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const msg = await res.json();

    const getHeader = (name) =>
      msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const body = this._decodeBody(msg.payload).slice(0, 1500);

    return {
      id,
      from: getHeader('from'),
      subject: getHeader('subject'),
      date: getHeader('date'),
      body,
    };
  }

  _decodeBody(payload) {
    if (!payload) return '';
    if (payload.body?.data) return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data)
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      for (const part of payload.parts) {
        if (part.body?.data)
          return Buffer.from(part.body.data, 'base64').toString('utf-8').replace(/<[^>]+>/g, ' ');
      }
    }
    return '';
  }

  // ── Classification ─────────────────────────────────────

  async _classify(email) {
    const prompt = `Klassifiziere diese E-Mail in EINE der folgenden Kategorien:

DRINGEND (sofortige Einzelbenachrichtigung):
- mahnung: Zahlungserinnerung, Mahnung, offene Rechnung mit Frist, Inkasso-Androhung
- rechnung_offen: Unbezahlte Rechnung, Zahlungsaufforderung (keine Mahnung, erste Rechnung)
- kuendigung: Kündigung eines Vertrags (durch Anbieter ODER Bestätigung eigener Kündigung)
- behoerde: Finanzamt, Behörden, Ämter, amtliche Schreiben, Gerichtsdokumente
- rechtlich: Anwaltschreiben, Abmahnung, rechtliche Drohungen, DSGVO-Anfragen

NORMAL:
- wichtig: Persönliche Nachrichten, relevante geschäftliche Mails ohne Frist
- aktion_erforderlich: Mails die eine Antwort erfordern aber nicht dringend sind
- info: Informationen ohne Handlungsbedarf, Bestellbestätigungen, Versandinfos
- spam: Werbung, Newsletter, automatische Benachrichtigungen

Von: ${email.from}
Betreff: ${email.subject}
Inhalt: ${email.body.slice(0, 600)}

Antworte NUR mit einem Wort: mahnung, rechnung_offen, kuendigung, behoerde, rechtlich, wichtig, aktion_erforderlich, info, spam`;

    try {
      const result = await this.llm.generate(prompt, [], '', { maxTokens: 15, temperature: 0 }) || '';
      const category = result.trim().toLowerCase().replace(/[^a-z_]/g, '');
      const valid = ['mahnung','rechnung_offen','kuendigung','behoerde','rechtlich','wichtig','aktion_erforderlich','info','spam'];
      return valid.includes(category) ? category : 'info';
    } catch {
      return 'info';
    }
  }

  async _extractUrgency(email) {
    const prompt = `Analysiere diese E-Mail und extrahiere folgende Informationen als JSON:
{
  "betrag": "€XX,XX oder null",
  "frist": "TT.MM.JJJJ oder null",
  "frist_tage": Zahl oder null,
  "naechster_schritt": "Was passiert wenn nichts unternommen wird (1 Satz)",
  "empfehlung": "Konkrete Empfehlung was zu tun ist (1 Satz)"
}

Von: ${email.from}
Betreff: ${email.subject}
Inhalt: ${email.body.slice(0, 800)}

Antworte NUR mit dem JSON-Objekt, kein anderer Text.`;

    try {
      const result = await this.llm.generate(prompt, [], '', { maxTokens: 150, temperature: 0 }) || '';
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* skip */ }
    return {};
  }

  // ── Summarize ─────────────────────────────────────────

  async _summarize(email) {
    const prompt = `Fasse diese E-Mail in 1-2 Sätzen zusammen. Nur der Kern — was will der Absender, was ist wichtig? Kein Intro, keine Floskeln.

Von: ${email.from}
Betreff: ${email.subject}
Inhalt: ${email.body.slice(0, 1000)}`;

    try {
      const result = await this.llm.generate(prompt, [], '', { maxTokens: 80, temperature: 0.3 }) || '';
      return result.trim();
    } catch {
      return email.body.slice(0, 120).replace(/\s+/g, ' ').trim();
    }
  }

  // ── Urgent Alert ───────────────────────────────────────

  _buildUrgentAlert(mail) {
    const categoryLabel = {
      mahnung:        '⚠️ Mahnung',
      rechnung_offen: '📄 Offene Rechnung',
      kuendigung:     '🔴 Kündigung',
      behoerde:       '🏛 Behördenpost',
      rechtlich:      '⚖️ Rechtliches Schreiben',
    }[mail.category] || '❗ Wichtige Mail';

    const from = mail.from.replace(/<[^>]+>/, '').trim().replace(/"/g, '');
    const u = mail.urgency || {};

    const lines = [`${categoryLabel}\nVon: ${from}\nBetreff: ${mail.subject}\n`];
    lines.push(mail.summary);

    if (u.betrag) lines.push(`\nBetrag: ${u.betrag}`);
    if (u.frist)  lines.push(`Frist: ${u.frist}${u.frist_tage != null ? ` (in ${u.frist_tage} Tagen)` : ''}`);
    if (u.naechster_schritt) lines.push(`\nOhne Aktion: ${u.naechster_schritt}`);
    if (u.empfehlung) lines.push(`Empfehlung: ${u.empfehlung}`);

    return lines.join('\n');
  }

  // ── Digest builder ────────────────────────────────────

  _buildDigest(relevant, totalCount) {
    const spamCount = totalCount - relevant.length;
    const categoryEmoji = { wichtig: '🔴', aktion_erforderlich: '⚡', info: '📩', spam: '🗑' };

    const lines = [`📬 *${totalCount} neue Mail${totalCount !== 1 ? 's' : ''}*${spamCount > 0 ? ` (${spamCount} Spam gefiltert)` : ''}:\n`];

    for (const mail of relevant) {
      const emoji = categoryEmoji[mail.category] || '📩';
      const from = mail.from.replace(/<[^>]+>/, '').trim().replace(/"/g, '');
      lines.push(`${emoji} *${mail.subject}*\nVon: ${from}\n${mail.summary}`);
    }

    return lines.join('\n\n');
  }

  // ── State ──────────────────────────────────────────────

  async _loadState() {
    if (!existsSync(STATE_FILE)) return {};
    try {
      return JSON.parse(await readFile(STATE_FILE, 'utf-8'));
    } catch { return {}; }
  }

  async _saveState(state) {
    try {
      await mkdir(resolve(STATE_FILE, '..'), { recursive: true });
      await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error(`  [gmail-monitor] State save failed: ${err.message}`);
    }
  }

  // ── Token ──────────────────────────────────────────────

  async _getToken() {
    if (this._accessToken && Date.now() < this._tokenExpiry - 60000) return this._accessToken;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const data = await res.json();
    if (data.error) throw new Error(`Token refresh: ${data.error_description}`);

    this._accessToken = data.access_token;
    this._tokenExpiry = Date.now() + (data.expires_in * 1000);
    return this._accessToken;
  }
}
