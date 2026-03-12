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
export class GmailMonitor {
  constructor({ soulPath, llm, telegram, clientId, clientSecret, refreshToken }) {
    this.soulPath = soulPath;
    this.llm = llm;
    this.telegram = telegram;
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
        const [category, summary] = await Promise.all([
          this._classify(detail),
          this._summarize(detail),
        ]);
        classified.push({ ...detail, category, summary });
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

    // Filter: skip spam, send digest of the rest
    const relevant = classified.filter(m => m.category !== 'spam');
    if (!relevant.length) {
      const spamCount = classified.filter(m => m.category === 'spam').length;
      console.log(`  [gmail-monitor] All ${spamCount} emails classified as spam — no notification`);
      return;
    }

    const digest = this._buildDigest(relevant, classified.length);
    await this.telegram.sendToOwner(digest);
    console.log(`  [gmail-monitor] Digest sent (${relevant.length} relevant, ${classified.length - relevant.length} spam)`);
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
- spam: Werbung, Newsletter, automatische Benachrichtigungen ohne Handlungsbedarf
- info: Informationen die gut zu wissen sind, aber keine Aktion erfordern
- wichtig: Persönliche Nachrichten, relevante geschäftliche Mails
- aktion_erforderlich: Mails die eine Reaktion oder Entscheidung verlangen

Von: ${email.from}
Betreff: ${email.subject}
Inhalt (Anfang): ${email.body.slice(0, 500)}

Antworte NUR mit einem der vier Wörter: spam, info, wichtig, aktion_erforderlich`;

    try {
      const result = await this.llm.generate(prompt, [], '', { maxTokens: 10, temperature: 0 }) || '';
      const category = result.trim().toLowerCase().replace(/[^a-z_]/g, '');
      return ['spam', 'info', 'wichtig', 'aktion_erforderlich'].includes(category) ? category : 'info';
    } catch {
      return 'info';
    }
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
