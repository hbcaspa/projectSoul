import { Bot } from 'grammy';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

export class TelegramChannel {
  constructor(soulPath, token, ownerId) {
    this.soulPath = soulPath;
    this.ownerId = String(ownerId);
    // Token wird für File-Downloads (Voice/Audio) gebraucht — die Telegram
    // File-API verlangt ihn in der URL (https://api.telegram.org/file/bot<token>/<path>).
    this.token = token;
    this.bot = new Bot(token);
    this.historyDir = resolve(soulPath, 'conversations', 'telegram');
    this.messageHandler = null;
    this.maxHistory = 50;
  }

  onMessage(handler) {
    this.messageHandler = handler;
  }

  async start() {
    await mkdir(this.historyDir, { recursive: true });

    // Global error handler — prevents crashes from unhandled grammy errors
    this.bot.catch((err) => {
      const is409 = err?.message?.includes('409') || err?.error?.error_code === 409;
      if (is409) {
        console.log('  [telegram] 409 conflict caught by global handler — will retry');
      } else {
        console.error(`  [telegram] Bot error: ${err.message}`);
      }
    });

    this.bot.on('message:text', async (ctx) => {
      const userId = String(ctx.from.id);

      // Only respond to the soul's human
      if (userId !== this.ownerId) {
        return; // silent ignore for strangers
      }

      const chatId    = String(ctx.chat.id);
      const messageId = ctx.message.message_id;
      const userName  = ctx.from.first_name || 'Human';
      const text      = ctx.message.text;

      if (!this.messageHandler) return;

      try {
        // 👀 — Acknowledge receipt immediately (non-blocking)
        this._setReaction(ctx.chat.id, messageId, '👀').catch(() => {});

        await ctx.replyWithChatAction('typing');
        const response = await this.messageHandler({ text, chatId, userName });
        if (!response) return;

        // ✅ — Mark as processed (non-blocking)
        this._setReaction(ctx.chat.id, messageId, '✅').catch(() => {});

        // Telegram max message length is 4096
        if (response.length > 4000) {
          for (const chunk of splitText(response, 4000)) {
            await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(
              () => ctx.reply(chunk) // fallback without markdown
            );
          }
        } else {
          await ctx.reply(response, { parse_mode: 'Markdown' }).catch(
            () => ctx.reply(response)
          );
        }
      } catch (err) {
        console.error(`  [telegram] Error: ${err.message}`);
        // ❌ — Mark as failed
        this._setReaction(ctx.chat.id, messageId, '❌').catch(() => {});
        await ctx.reply('...').catch(() => {});
      }
    });

    // Voice (OGG/Opus) und Audio (mp3/m4a/…) — gemeinsamer Handler.
    // text bleibt leer; die Engine transkribiert in Phase 2 anhand von args.voice.
    const handleVoiceLike = async (ctx, media) => {
      const userId = String(ctx.from.id);

      // Only respond to the soul's human
      if (userId !== this.ownerId) {
        return; // silent ignore for strangers
      }

      const chatId    = String(ctx.chat.id);
      const messageId = ctx.message.message_id;
      const userName  = ctx.from.first_name || 'Human';

      if (!this.messageHandler) return;

      try {
        // 👀 — Acknowledge receipt immediately (non-blocking)
        this._setReaction(ctx.chat.id, messageId, '👀').catch(() => {});

        // Audio-Bytes herunterladen. Bei JEDEM Fehler: Owner benachrichtigen,
        // NICHT crashen (kein Fail-Open — wir reichen ohne Buffer nichts weiter,
        // das wäre eine leere/nutzlose Nachricht an die Engine).
        const buffer = await this._downloadFile(media.file_id);
        if (!buffer) {
          this._setReaction(ctx.chat.id, messageId, '❌').catch(() => {});
          await this.sendToOwner('Sprachnachricht konnte nicht geladen werden (Download fehlgeschlagen).');
          return;
        }

        const mimeType = media.mime_type || 'audio/ogg';
        const duration = media.duration;

        await ctx.replyWithChatAction('typing');
        const response = await this.messageHandler({
          text: undefined, // Engine transkribiert via args.voice
          chatId,
          userName,
          voice: { buffer, mimeType, duration },
        });
        if (!response) return;

        // ✅ — Mark as processed (non-blocking)
        this._setReaction(ctx.chat.id, messageId, '✅').catch(() => {});

        // Telegram max message length is 4096
        if (response.length > 4000) {
          for (const chunk of splitText(response, 4000)) {
            await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(
              () => ctx.reply(chunk) // fallback without markdown
            );
          }
        } else {
          await ctx.reply(response, { parse_mode: 'Markdown' }).catch(
            () => ctx.reply(response)
          );
        }
      } catch (err) {
        console.error(`  [telegram] Voice error: ${err.message}`);
        // ❌ — Mark as failed
        this._setReaction(ctx.chat.id, messageId, '❌').catch(() => {});
        await this.sendToOwner(`Sprachnachricht-Verarbeitung fehlgeschlagen: ${err.message}`);
      }
    };

    this.bot.on('message:voice', (ctx) => handleVoiceLike(ctx, ctx.message.voice));
    this.bot.on('message:audio', (ctx) => handleVoiceLike(ctx, ctx.message.audio));

    // Start long-polling with retry on 409 conflict
    this._startPolling();
  }

  // Lädt eine Telegram-Datei (Voice/Audio) als Buffer.
  // Gibt bei jedem Fehler null zurück (kein Throw) — der Aufrufer degradiert sauber.
  async _downloadFile(fileId) {
    try {
      const file = await this.bot.api.getFile(fileId);
      if (!file?.file_path) return null;
      const url = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`  [telegram] File download HTTP ${res.status}`);
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      console.error(`  [telegram] File download failed: ${err.message}`);
      return null;
    }
  }

  async _startPolling(attempt = 0) {
    const maxRetries = 8;
    const baseDelay = 5000; // 5 seconds

    // Clear any stale webhook/polling connections before starting
    try {
      await this.bot.api.deleteWebhook({ drop_pending_updates: false });
    } catch { /* ignore — best effort cleanup */ }

    // On retry, wait before starting to let old connections expire
    if (attempt > 0) {
      const delay = baseDelay * Math.pow(2, Math.min(attempt, 5)); // cap at ~160s
      console.log(`  [telegram] 409 conflict — retry ${attempt}/${maxRetries} in ${delay / 1000}s`);
      await new Promise(r => setTimeout(r, delay));
    }

    this.bot.start({
      onStart: () => {
        if (attempt > 0) {
          console.log(`  [telegram] Connected after ${attempt} retries`);
        }
      },
      allowed_updates: ['message'],
    }).catch(async (err) => {
      const is409 = err?.message?.includes('409') || err?.error_code === 409;

      if (is409 && attempt < maxRetries) {
        // Try to close the conflicting session via API
        try {
          await this.bot.api.raw.close();
        } catch { /* ignore */ }

        this._startPolling(attempt + 1);
      } else {
        console.error(`  [telegram] Fatal: ${err.message}`);
        console.error(`  [telegram] Bot will run without Telegram polling.`);
        console.error(`  [telegram] Outgoing messages (sendToOwner) still work.`);
        // Don't crash — engine continues without incoming Telegram messages
      }
    });
  }

  async stop() {
    try {
      await this.bot.stop();
    } catch { /* may not be running */ }
  }

  // ── History management ───────────────────────────────────

  async loadHistory(chatId) {
    const file = resolve(this.historyDir, `${chatId}.json`);
    if (!existsSync(file)) return [];

    try {
      const data = JSON.parse(await readFile(file, 'utf-8'));
      // Strip device labels from history entries (prevents LLM from reproducing them)
      return data.slice(-this.maxHistory).map(m => ({
        ...m,
        content: m.content ? m.content.replace(/\n\n📍[^\n]*/g, '').trim() : m.content,
      }));
    } catch {
      return [];
    }
  }

  async saveMessage(chatId, role, content, name = null) {
    const file = resolve(this.historyDir, `${chatId}.json`);
    let messages = [];

    if (existsSync(file)) {
      try {
        messages = JSON.parse(await readFile(file, 'utf-8'));
      } catch { /* start fresh */ }
    }

    messages.push({
      role: role === 'model' ? 'assistant' : role,
      content,
      timestamp: new Date().toISOString(),
      ...(name && { name }),
    });

    // Keep rolling window
    if (messages.length > this.maxHistory * 2) {
      messages = messages.slice(-this.maxHistory * 2);
    }

    await writeFile(file, JSON.stringify(messages, null, 2));
  }

  async sendToOwner(text) {
    try {
      await this.bot.api.sendMessage(this.ownerId, text);
    } catch (err) {
      console.error(`  [telegram] Notify failed: ${err.message}`);
    }
  }

  // Send a photo with caption and optional link button
  async sendPhotoToOwner(photoUrl, caption, linkUrl = null) {
    const opts = {
      caption: caption.substring(0, 1024),
      parse_mode: 'HTML',
    };
    if (linkUrl) {
      opts.reply_markup = {
        inline_keyboard: [[{ text: '🔗 Zur Anzeige', url: linkUrl }]],
      };
    }
    try {
      await this.bot.api.sendPhoto(this.ownerId, photoUrl, opts);
    } catch (err) {
      // Photo failed (URL blocked, too large, etc.) — fall back to text
      console.warn(`  [telegram] sendPhoto failed (${err.message}), falling back to text`);
      const fallback = caption + (linkUrl ? `\n\n🔗 ${linkUrl}` : '');
      await this.sendToOwner(fallback.substring(0, 4096));
    }
  }

  // Send text with inline keyboard buttons
  async sendWithButtons(text, buttons) {
    try {
      await this.bot.api.sendMessage(this.ownerId, text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
    } catch {
      await this.sendToOwner(text);
    }
  }

  // Emoji reaction on a message: 👀 (received), ✅ (processed), ❌ (error)
  async _setReaction(chatId, messageId, emoji) {
    try {
      await this.bot.api.setMessageReaction(chatId, messageId, [{ type: 'emoji', emoji }]);
    } catch {
      // Reactions require Telegram API >= 7.0 — silently ignore if not supported
    }
  }

  // Send-only mode for secondary nodes — no polling, just send capability
  async initSendOnly() {
    await mkdir(this.historyDir, { recursive: true });
    // No polling started — bot.api.sendMessage still works
  }
}

// ── Helpers ──────────────────────────────────────────────

function splitText(text, maxLen) {
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
