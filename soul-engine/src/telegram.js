import { Bot } from 'grammy';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

export class TelegramChannel {
  constructor(soulPath, token, ownerId) {
    this.soulPath = soulPath;
    this.ownerId = String(ownerId);
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

      const chatId = String(ctx.chat.id);
      const userName = ctx.from.first_name || 'Human';
      const text = ctx.message.text;

      if (!this.messageHandler) return;

      try {
        await ctx.replyWithChatAction('typing');
        const response = await this.messageHandler({ text, chatId, userName });

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
        await ctx.reply('...').catch(() => {});
      }
    });

    // Start long-polling with retry on 409 conflict
    this._startPolling();
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
      return data.slice(-this.maxHistory);
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
