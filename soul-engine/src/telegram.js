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

    // Start long-polling
    this.bot.start({
      onStart: () => {},
      allowed_updates: ['message'],
    });
  }

  async stop() {
    await this.bot.stop();
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
