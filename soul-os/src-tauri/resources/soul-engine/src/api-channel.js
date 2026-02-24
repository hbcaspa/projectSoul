/**
 * API Channel — conversation history management for the Soul App.
 * Parallel to telegram.js but for REST/WebSocket clients.
 */

import fs from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const MAX_HISTORY = 100;
const WINDOW_SIZE = 50;

export class APIChannel {
  constructor(soulPath) {
    this.soulPath = soulPath;
    this.historyDir = path.resolve(soulPath, 'conversations', 'app');
    this.messageHandler = null;

    if (!existsSync(this.historyDir)) {
      mkdirSync(this.historyDir, { recursive: true });
    }
  }

  onMessage(handler) {
    this.messageHandler = handler;
  }

  historyPath(sessionId = 'default') {
    return path.join(this.historyDir, `${sessionId}.json`);
  }

  async loadHistory(sessionId = 'default') {
    const filePath = this.historyPath(sessionId);
    if (!existsSync(filePath)) return [];

    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      return data.slice(-WINDOW_SIZE);
    } catch {
      return [];
    }
  }

  async saveMessage(sessionId = 'default', role, content, name = null) {
    const filePath = this.historyPath(sessionId);
    let history = [];

    if (existsSync(filePath)) {
      try {
        history = JSON.parse(await fs.readFile(filePath, 'utf-8'));
      } catch { /* start fresh */ }
    }

    history.push({
      role: role === 'model' ? 'assistant' : role,
      content,
      timestamp: new Date().toISOString(),
      ...(name && { name }),
    });

    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY);
    }

    await fs.writeFile(filePath, JSON.stringify(history, null, 2));
  }

  async getFullHistory(sessionId = 'default') {
    const filePath = this.historyPath(sessionId);
    if (!existsSync(filePath)) return [];

    try {
      return JSON.parse(await fs.readFile(filePath, 'utf-8'));
    } catch {
      return [];
    }
  }
}
