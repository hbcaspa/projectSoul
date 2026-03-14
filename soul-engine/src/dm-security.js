/**
 * DMSecurity — DM-Pairing & Zugriffskontrolle
 *
 * Inspiriert von OpenClaws DM-Policy.
 *
 * Besser als OpenClaw:
 *  - Mehrstufiges Vertrauensmodell (owner → trusted → known → stranger)
 *  - Zeitbasierte Pairing-Codes (TOTP-ähnlich, 5-Minuten-Fenster)
 *  - Rate Limiting pro Sender (verhindert Brute-Force-Pairing)
 *  - Audit-Log aller Zugriffversuche
 *  - Automatische Blockierung nach N fehlgeschlagenen Versuchen
 *  - Policy per Channel konfigurierbar (Telegram offen, WhatsApp strikt)
 *
 * Trust-Levels:
 *   owner    — voller Zugriff, konfiguriert in TELEGRAM_OWNER_ID
 *   trusted  — gepairt, kann Befehle senden
 *   known    — hat sich gemeldet, wartet auf Pairing
 *   stranger — unbekannt, bekommt nur Pairing-Prompt
 *   blocked  — dauerhaft gesperrt
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomInt, createHash } from 'node:crypto';

const PAIRING_CODE_TTL   = 5 * 60_000;  // 5 Minuten
const MAX_FAILED_ATTEMPTS = 5;
const BLOCK_DURATION      = 24 * 60 * 60_000; // 24 Stunden
const RATE_LIMIT_WINDOW   = 60_000;      // 1 Minute
const RATE_LIMIT_MAX      = 10;          // Max 10 Nachrichten pro Minute

export class DMSecurity {
  constructor({ soulPath, bus, telegram } = {}) {
    this.soulPath = soulPath;
    this.bus      = bus;
    this.telegram = telegram;
    this._contacts  = new Map(); // id → { level, name, paired, blocked, failedAttempts, ... }
    this._codes     = new Map(); // id → { code, expires }
    this._rateLimits = new Map(); // id → { count, windowStart }
    this._auditLog  = [];
    this._stateFile = join(soulPath, 'connections', 'dm-security.json');
    this._policy    = {
      telegram: 'pairing',  // 'open' | 'pairing' | 'owner_only'
      whatsapp: 'pairing',
      api:      'open',
    };
  }

  async init() {
    await mkdir(join(this.soulPath, 'connections'), { recursive: true });
    await this._load();

    // Register owner from env
    const ownerId = process.env.TELEGRAM_OWNER_ID;
    if (ownerId && !this._contacts.has(ownerId)) {
      this._contacts.set(ownerId, {
        id: ownerId,
        level: 'owner',
        name: 'Owner',
        paired: new Date().toISOString(),
        blocked: false,
        failedAttempts: 0,
      });
      await this._save();
    }

    console.log(`  [dm-sec] Active — ${this._contacts.size} contacts, policy: ${JSON.stringify(this._policy)}`);
  }

  /**
   * Check if a message from a user should be processed.
   * @param {string} userId - Sender ID
   * @param {string} channel - 'telegram' | 'whatsapp' | 'api'
   * @param {string} text - Message text (for pairing code check)
   * @param {string} name - Sender display name
   * @returns {{ allowed: boolean, response?: string, level: string }}
   */
  checkAccess(userId, channel = 'telegram', text = '', name = 'Unknown') {
    const id = String(userId);
    const policy = this._policy[channel] || 'pairing';

    // Rate limiting
    if (this._isRateLimited(id)) {
      this._audit(id, channel, 'rate_limited');
      return { allowed: false, level: 'rate_limited' };
    }
    this._trackRate(id);

    // Check blocked
    const contact = this._contacts.get(id);
    if (contact?.blocked) {
      if (contact.blockedUntil && Date.now() > new Date(contact.blockedUntil).getTime()) {
        // Block expired
        contact.blocked = false;
        contact.blockedUntil = null;
        contact.failedAttempts = 0;
      } else {
        this._audit(id, channel, 'blocked');
        return { allowed: false, level: 'blocked' };
      }
    }

    // Owner always passes
    if (contact?.level === 'owner') {
      return { allowed: true, level: 'owner' };
    }

    // Trusted users pass
    if (contact?.level === 'trusted') {
      return { allowed: true, level: 'trusted' };
    }

    // Open policy — allow everyone
    if (policy === 'open') {
      if (!contact) {
        this._contacts.set(id, { id, level: 'known', name, paired: null, blocked: false, failedAttempts: 0 });
        this._saveDebounced();
      }
      return { allowed: true, level: contact?.level || 'known' };
    }

    // Owner-only policy
    if (policy === 'owner_only') {
      this._audit(id, channel, 'denied_owner_only');
      return { allowed: false, level: 'stranger', response: 'This bot is private.' };
    }

    // Pairing policy — check for pairing code in message
    if (text?.trim()) {
      const codeMatch = text.trim().match(/^\d{6}$/);
      if (codeMatch) {
        return this._attemptPairing(id, codeMatch[0], name, channel);
      }
    }

    // Unknown user — generate pairing code and prompt
    if (!contact || contact.level === 'stranger' || contact.level === 'known') {
      const code = this._generatePairingCode(id);
      this._contacts.set(id, {
        id, level: 'known', name,
        paired: null, blocked: false,
        failedAttempts: contact?.failedAttempts || 0,
        firstSeen: contact?.firstSeen || new Date().toISOString(),
      });
      this._saveDebounced();
      this._audit(id, channel, 'pairing_prompted');

      // Notify owner about new contact
      this.bus?.safeEmit?.('dm.new_contact', { id, name, channel });

      return {
        allowed: false,
        level: 'known',
        response: `🔐 Pairing erforderlich\n\nIch bin ein privater Bot. Bitte gib den 6-stelligen Pairing-Code ein, den du vom Besitzer erhalten hast.\n\nCode gültig für 5 Minuten.`,
        pairingCode: code, // Sent to owner for relay
      };
    }

    return { allowed: false, level: 'stranger' };
  }

  /**
   * Generate a pairing code for a specific user.
   * Owner can request this to share with someone.
   */
  generateCodeFor(userId) {
    return this._generatePairingCode(String(userId));
  }

  /**
   * Directly trust a user (owner command).
   */
  trustUser(userId, name = 'Unknown') {
    const id = String(userId);
    this._contacts.set(id, {
      id, level: 'trusted', name,
      paired: new Date().toISOString(),
      blocked: false, failedAttempts: 0,
    });
    this._saveDebounced();
    this._audit(id, 'manual', 'trusted');
    return true;
  }

  /**
   * Block a user.
   */
  blockUser(userId, permanent = false) {
    const id = String(userId);
    const contact = this._contacts.get(id) || { id, level: 'stranger', name: 'Unknown' };
    contact.blocked = true;
    contact.blockedUntil = permanent ? null : new Date(Date.now() + BLOCK_DURATION).toISOString();
    contact.level = 'blocked';
    this._contacts.set(id, contact);
    this._saveDebounced();
    this._audit(id, 'manual', 'blocked');
    return true;
  }

  /**
   * Set policy for a channel.
   */
  setPolicy(channel, policy) {
    if (['open', 'pairing', 'owner_only'].includes(policy)) {
      this._policy[channel] = policy;
      this._saveDebounced();
      return true;
    }
    return false;
  }

  getContacts() {
    return [...this._contacts.values()];
  }

  getAuditLog(limit = 50) {
    return this._auditLog.slice(-limit);
  }

  // ── Pairing Logic ─────────────────────────────────────────

  _generatePairingCode(userId) {
    const code = String(randomInt(100000, 999999));
    this._codes.set(userId, {
      code,
      expires: Date.now() + PAIRING_CODE_TTL,
    });

    // Notify owner
    const contact = this._contacts.get(userId);
    const name = contact?.name || userId;
    this.telegram?.sendToOwner?.(
      `🔐 Neuer Pairing-Versuch\n\nVon: ${name} (${userId})\nCode: \`${code}\`\nGültig: 5 Min.\n\nTeile diesen Code mit der Person wenn du sie kennen willst.`
    ).catch(() => {});

    return code;
  }

  _attemptPairing(userId, code, name, channel) {
    const stored = this._codes.get(userId);

    if (!stored || Date.now() > stored.expires) {
      this._audit(userId, channel, 'pairing_expired');
      const contact = this._contacts.get(userId);
      if (contact) {
        contact.failedAttempts = (contact.failedAttempts || 0) + 1;
        if (contact.failedAttempts >= MAX_FAILED_ATTEMPTS) {
          contact.blocked = true;
          contact.blockedUntil = new Date(Date.now() + BLOCK_DURATION).toISOString();
          this._audit(userId, channel, 'auto_blocked');
        }
        this._saveDebounced();
      }
      return {
        allowed: false,
        level: 'known',
        response: 'Code abgelaufen oder ungültig. Neuen Code anfordern.',
      };
    }

    if (stored.code !== code) {
      this._audit(userId, channel, 'pairing_failed');
      const contact = this._contacts.get(userId);
      if (contact) contact.failedAttempts = (contact.failedAttempts || 0) + 1;
      if (contact?.failedAttempts >= MAX_FAILED_ATTEMPTS) {
        contact.blocked = true;
        contact.blockedUntil = new Date(Date.now() + BLOCK_DURATION).toISOString();
        this._audit(userId, channel, 'auto_blocked');
        this._saveDebounced();
        return { allowed: false, level: 'blocked', response: 'Zu viele Fehlversuche. Zugriff temporär gesperrt.' };
      }
      this._saveDebounced();
      return { allowed: false, level: 'known', response: 'Falscher Code. Versuche es erneut.' };
    }

    // Success!
    this._codes.delete(userId);
    this._contacts.set(userId, {
      id: userId, level: 'trusted', name,
      paired: new Date().toISOString(),
      blocked: false, failedAttempts: 0,
    });
    this._saveDebounced();
    this._audit(userId, channel, 'paired');

    this.telegram?.sendToOwner?.(
      `✅ Pairing erfolgreich!\n\n${name} (${userId}) ist jetzt ein vertrauenswürdiger Kontakt.`
    ).catch(() => {});

    this.bus?.safeEmit?.('dm.paired', { userId, name, channel });

    return { allowed: true, level: 'trusted', response: '✅ Pairing erfolgreich! Du kannst jetzt mit mir sprechen.' };
  }

  // ── Rate Limiting ──────────────────────────────────────────

  _isRateLimited(id) {
    const entry = this._rateLimits.get(id);
    if (!entry) return false;
    if (Date.now() - entry.windowStart > RATE_LIMIT_WINDOW) return false;
    return entry.count >= RATE_LIMIT_MAX;
  }

  _trackRate(id) {
    const entry = this._rateLimits.get(id);
    if (!entry || Date.now() - entry.windowStart > RATE_LIMIT_WINDOW) {
      this._rateLimits.set(id, { count: 1, windowStart: Date.now() });
    } else {
      entry.count++;
    }
  }

  // ── Persistence ────────────────────────────────────────────

  _audit(userId, channel, action) {
    this._auditLog.push({
      timestamp: new Date().toISOString(),
      userId, channel, action,
    });
    if (this._auditLog.length > 500) this._auditLog = this._auditLog.slice(-500);
  }

  async _load() {
    if (!existsSync(this._stateFile)) return;
    try {
      const data = JSON.parse(await readFile(this._stateFile, 'utf-8'));
      for (const contact of (data.contacts || [])) {
        this._contacts.set(contact.id, contact);
      }
      if (data.policy) this._policy = { ...this._policy, ...data.policy };
      this._auditLog = data.auditLog || [];
    } catch { /* start fresh */ }
  }

  async _save() {
    const data = {
      contacts: [...this._contacts.values()],
      policy: this._policy,
      auditLog: this._auditLog.slice(-200),
    };
    await writeFile(this._stateFile, JSON.stringify(data, null, 2));
  }

  _saveDebounced() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save().catch(() => {}), 2000);
  }
}
