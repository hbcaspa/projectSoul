import Hyperswarm from 'hyperswarm';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  generateMnemonic,
  validateMnemonic,
  deriveKeys,
  encrypt,
  decrypt,
  hashFile,
} from './crypto.js';

// Files/dirs to sync (relative to soul path)
const SYNC_DIRS = [
  'seele', 'soul',
  'erinnerungen', 'memories',
  'heartbeat', 'memory',
  'zustandslog', 'statelog',
  'conversations',
];

const SYNC_FILES = [
  'SEED.md', 'SOUL.md', '.language',
];

const IGNORE = new Set([
  '.env', '.mcp.json', '.soul-pulse', '.session-writes',
  '.git', '.claude', '.soul-chain',
  'node_modules', 'soul-engine', 'soul-monitor', 'soul-card',
  'soul-chain', 'skills', 'docs', 'hooks',
  'CLAUDE.md', 'HEARTBEAT.md', 'SEED_SPEC.md', 'CHANGELOG.md',
  'README.md', 'README.de.md', 'LICENSE',
  'banner.png', 'logo.png', '.env.example', '.gitignore',
]);

const CONFIG_FILE = '.soul-chain';
const POLL_INTERVAL = 5000; // 5 seconds

export class SoulChain {
  constructor(soulPath) {
    this.soulPath = soulPath;
    this.configPath = path.resolve(soulPath, CONFIG_FILE);
    this.mnemonic = null;
    this.keys = null;
    this.swarm = null;
    this.peers = new Map();
    this.manifest = new Map(); // path → { hash, mtime }
    this.pollTimer = null;
  }

  // ── Init / Join ─────────────────────────────────────

  /** Create a new chain — generates a soul token */
  async init() {
    if (existsSync(this.configPath)) {
      const cfg = JSON.parse(readFileSync(this.configPath, 'utf-8'));
      this.mnemonic = cfg.mnemonic;
      this.keys = deriveKeys(this.mnemonic);
      return { mnemonic: this.mnemonic, existing: true };
    }

    this.mnemonic = generateMnemonic();
    this.keys = deriveKeys(this.mnemonic);

    await fs.writeFile(this.configPath, JSON.stringify({
      mnemonic: this.mnemonic,
      created: new Date().toISOString(),
    }, null, 2));

    return { mnemonic: this.mnemonic, existing: false };
  }

  /** Join an existing chain with a soul token */
  async join(mnemonic) {
    if (!validateMnemonic(mnemonic)) {
      throw new Error('Invalid soul token. Must be 16 words from the soul wordlist.');
    }

    this.mnemonic = mnemonic.trim().toLowerCase();
    this.keys = deriveKeys(this.mnemonic);

    await fs.writeFile(this.configPath, JSON.stringify({
      mnemonic: this.mnemonic,
      joined: new Date().toISOString(),
    }, null, 2));

    return true;
  }

  // ── Sync ────────────────────────────────────────────

  async start() {
    // Load config if not already loaded
    if (!this.mnemonic) {
      if (!existsSync(this.configPath)) {
        throw new Error('No chain configured. Run init or join first.');
      }
      const cfg = JSON.parse(readFileSync(this.configPath, 'utf-8'));
      this.mnemonic = cfg.mnemonic;
      this.keys = deriveKeys(this.mnemonic);
    }

    // Build initial manifest
    await this.buildManifest();

    // Start Hyperswarm
    this.swarm = new Hyperswarm();

    this.swarm.on('connection', (socket, info) => {
      const peerId = info.publicKey.toString('hex').substring(0, 8);
      console.log(`  [chain] Peer connected: ${peerId}`);
      this.peers.set(peerId, socket);

      this.handlePeer(socket, peerId);

      socket.on('close', () => {
        console.log(`  [chain] Peer disconnected: ${peerId}`);
        this.peers.delete(peerId);
      });

      socket.on('error', (err) => {
        console.error(`  [chain] Peer error (${peerId}): ${err.message}`);
        this.peers.delete(peerId);
      });
    });

    const discovery = this.swarm.join(this.keys.topic, {
      server: true,
      client: true,
    });

    await discovery.flushed();
    console.log(`  [chain] Listening for peers...`);

    // Start file polling
    this.startPolling();

    return true;
  }

  async stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.swarm) await this.swarm.destroy();
    console.log('  [chain] Stopped.');
  }

  // ── Peer Protocol ───────────────────────────────────

  handlePeer(socket, peerId) {
    let buffer = '';

    // Send our manifest
    this.send(socket, {
      type: 'manifest',
      files: this.getManifestList(),
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.handleMessage(socket, peerId, JSON.parse(line));
        } catch (err) {
          console.error(`  [chain] Bad message from ${peerId}: ${err.message}`);
        }
      }
    });
  }

  async handleMessage(socket, peerId, msg) {
    switch (msg.type) {
      case 'manifest':
        await this.onManifest(socket, peerId, msg.files);
        break;

      case 'need':
        await this.onNeed(socket, msg.path);
        break;

      case 'file':
        await this.onFile(msg.path, msg.data, msg.mtime);
        break;
    }
  }

  async onManifest(socket, peerId, remoteFiles) {
    for (const remote of remoteFiles) {
      const local = this.manifest.get(remote.path);

      if (!local || local.hash !== remote.hash) {
        // We need this file if remote is newer (or we don't have it)
        if (!local || remote.mtime > local.mtime) {
          this.send(socket, { type: 'need', path: remote.path });
        }
      }
    }
  }

  async onNeed(socket, filePath) {
    const fullPath = path.resolve(this.soulPath, filePath);
    if (!existsSync(fullPath)) return;

    try {
      const content = await fs.readFile(fullPath);
      const encrypted = encrypt(content, this.keys.encryptionKey);
      const stat = statSync(fullPath);

      this.send(socket, {
        type: 'file',
        path: filePath,
        data: encrypted.toString('base64'),
        mtime: stat.mtimeMs,
      });
    } catch (err) {
      console.error(`  [chain] Failed to send ${filePath}: ${err.message}`);
    }
  }

  async onFile(filePath, encryptedBase64, mtime) {
    try {
      const encrypted = Buffer.from(encryptedBase64, 'base64');
      const content = decrypt(encrypted, this.keys.encryptionKey);

      const fullPath = path.resolve(this.soulPath, filePath);

      // Create directories if needed
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content);

      // Update manifest
      this.manifest.set(filePath, {
        hash: hashFile(content),
        mtime,
      });

      console.log(`  [chain] Synced: ${filePath}`);
    } catch (err) {
      console.error(`  [chain] Failed to receive ${filePath}: ${err.message}`);
    }
  }

  send(socket, msg) {
    try {
      socket.write(JSON.stringify(msg) + '\n');
    } catch {
      // Socket may be closed
    }
  }

  // ── File Manifest ───────────────────────────────────

  async buildManifest() {
    this.manifest.clear();

    // Single files
    for (const file of SYNC_FILES) {
      const full = path.resolve(this.soulPath, file);
      if (existsSync(full)) {
        const content = await fs.readFile(full);
        const stat = statSync(full);
        this.manifest.set(file, {
          hash: hashFile(content),
          mtime: stat.mtimeMs,
        });
      }
    }

    // Directories
    for (const dir of SYNC_DIRS) {
      const full = path.resolve(this.soulPath, dir);
      if (!existsSync(full)) continue;
      await this.walkDir(full, dir);
    }
  }

  async walkDir(absDir, relDir) {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      const relPath = path.join(relDir, entry.name);
      const absPath = path.join(absDir, entry.name);

      if (entry.name.startsWith('.') || IGNORE.has(entry.name)) continue;

      if (entry.isDirectory()) {
        await this.walkDir(absPath, relPath);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(absPath);
          const stat = statSync(absPath);
          this.manifest.set(relPath, {
            hash: hashFile(content),
            mtime: stat.mtimeMs,
          });
        } catch { /* skip unreadable files */ }
      }
    }
  }

  getManifestList() {
    return Array.from(this.manifest.entries()).map(([p, info]) => ({
      path: p,
      hash: info.hash,
      mtime: info.mtime,
    }));
  }

  // ── File Polling ────────────────────────────────────

  startPolling() {
    this.pollTimer = setInterval(async () => {
      const oldManifest = new Map(this.manifest);
      await this.buildManifest();

      // Find changed files
      for (const [filePath, info] of this.manifest) {
        const old = oldManifest.get(filePath);
        if (!old || old.hash !== info.hash) {
          // File changed locally — broadcast to all peers
          this.broadcastFile(filePath);
        }
      }
    }, POLL_INTERVAL);
  }

  async broadcastFile(filePath) {
    const fullPath = path.resolve(this.soulPath, filePath);
    if (!existsSync(fullPath)) return;

    try {
      const content = await fs.readFile(fullPath);
      const encrypted = encrypt(content, this.keys.encryptionKey);
      const stat = statSync(fullPath);

      const msg = {
        type: 'file',
        path: filePath,
        data: encrypted.toString('base64'),
        mtime: stat.mtimeMs,
      };

      for (const [, socket] of this.peers) {
        this.send(socket, msg);
      }

      if (this.peers.size > 0) {
        console.log(`  [chain] Broadcast: ${filePath} → ${this.peers.size} peer(s)`);
      }
    } catch (err) {
      console.error(`  [chain] Broadcast failed for ${filePath}: ${err.message}`);
    }
  }
}
