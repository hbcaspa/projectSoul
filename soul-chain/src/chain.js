import Hyperswarm from 'hyperswarm';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
  '.soul-impulse-state', '.soul-impulse-log', '.soul-state-tick',
  'knowledge-graph.jsonl',
];

// Files that use line-based merge instead of overwrite
const MERGE_FILES = new Set([
  'knowledge-graph.jsonl',
]);

const IGNORE = new Set([
  '.env', '.mcp.json', '.soul-pulse', '.session-writes', '.soul-route-log',
  '.git', '.claude', '.soul-chain', '.soul-chain-status',
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
    this.statusPath = path.resolve(soulPath, '.soul-chain-status');
    this.mnemonic = null;
    this.keys = null;
    this.swarm = null;
    this.peers = new Map();       // peerId → { socket, connectedAt, filesReceived, filesSent, lastSync, lastManifestExchange }
    this.manifest = new Map();    // path → { hash, mtime }
    this.pollTimer = null;
    this.statusTimer = null;
    this.totalSynced = 0;
    this.startedAt = null;
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

    this.startedAt = new Date().toISOString();

    this.swarm.on('connection', (socket, info) => {
      const peerId = info.publicKey.toString('hex').substring(0, 8);
      console.log(`  [chain] Peer connected: ${peerId}`);
      this.peers.set(peerId, {
        socket,
        connectedAt: new Date().toISOString(),
        filesReceived: 0,
        filesSent: 0,
        lastSync: null,
        lastManifestExchange: null,
      });

      this.handlePeer(socket, peerId);
      this.writeStatus();

      socket.on('close', () => {
        console.log(`  [chain] Peer disconnected: ${peerId}`);
        this.peers.delete(peerId);
        this.writeStatus();
      });

      socket.on('error', (err) => {
        console.error(`  [chain] Peer error (${peerId}): ${err.message}`);
        this.peers.delete(peerId);
        this.writeStatus();
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

    // Periodic status refresh (every 30s so monitor sees fresh timestamps)
    this.statusTimer = setInterval(() => this.writeStatus(), 30000);

    return true;
  }

  async stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.swarm) await this.swarm.destroy();

    // Write inactive status
    try {
      writeFileSync(this.statusPath, JSON.stringify({
        active: false,
        peers: [],
        totalSynced: this.totalSynced,
        since: this.startedAt,
        lastUpdate: new Date().toISOString(),
      }, null, 2));
    } catch { /* ignore */ }

    console.log('  [chain] Stopped.');
  }

  // ── Peer Protocol ───────────────────────────────────

  handlePeer(socket, peerId) {
    let buffer = '';

    // Send our manifest
    this.sendSocket(socket, {
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
        await this.onNeed(socket, peerId, msg.path);
        break;

      case 'file':
        await this.onFile(peerId, msg.path, msg.data, msg.mtime);
        break;
    }
  }

  async onManifest(socket, peerId, remoteFiles) {
    let filesRequested = 0;
    for (const remote of remoteFiles) {
      const local = this.manifest.get(remote.path);

      if (!local || local.hash !== remote.hash) {
        // We need this file if remote is newer (or we don't have it)
        if (!local || remote.mtime > local.mtime) {
          this.sendSocket(socket, { type: 'need', path: remote.path });
          filesRequested++;
        }
      }
    }

    // Track manifest exchange even if no files were needed (= in sync)
    const peer = this.peers.get(peerId);
    if (peer) {
      const now = new Date().toISOString();
      peer.lastManifestExchange = now;
      peer.lastManifestFiles = remoteFiles.length;
      peer.lastManifestRequested = filesRequested;
      // If no files needed → everything matches → that counts as a sync
      if (filesRequested === 0 && remoteFiles.length > 0) {
        peer.lastSync = now;
      }
    }
    this.writeStatus();
  }

  async onNeed(socket, peerId, filePath) {
    const fullPath = path.resolve(this.soulPath, filePath);
    if (!existsSync(fullPath)) return;

    try {
      const content = await fs.readFile(fullPath);
      const encrypted = encrypt(content, this.keys.encryptionKey);
      const stat = statSync(fullPath);

      this.sendSocket(socket, {
        type: 'file',
        path: filePath,
        data: encrypted.toString('base64'),
        mtime: stat.mtimeMs,
      });

      const peer = this.peers.get(peerId);
      if (peer) {
        peer.filesSent++;
        peer.lastSync = new Date().toISOString();
      }
      this.totalSynced++;
      this.writeStatus();
    } catch (err) {
      console.error(`  [chain] Failed to send ${filePath}: ${err.message}`);
    }
  }

  async onFile(peerId, filePath, encryptedBase64, mtime) {
    try {
      const encrypted = Buffer.from(encryptedBase64, 'base64');
      const content = decrypt(encrypted, this.keys.encryptionKey);

      const fullPath = path.resolve(this.soulPath, filePath);
      const fileName = path.basename(filePath);

      // Create directories if needed
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // JSONL merge: line-based union instead of overwrite
      if (MERGE_FILES.has(fileName)) {
        await this.mergeJsonl(fullPath, content);
      } else {
        await fs.writeFile(fullPath, content);
      }

      // Update manifest with merged result
      const finalContent = await fs.readFile(fullPath);
      this.manifest.set(filePath, {
        hash: hashFile(finalContent),
        mtime: MERGE_FILES.has(fileName) ? Date.now() : mtime,
      });

      const peer = this.peers.get(peerId);
      if (peer) {
        peer.filesReceived++;
        peer.lastSync = new Date().toISOString();
      }
      this.totalSynced++;
      this.writeStatus();

      console.log(`  [chain] Synced: ${filePath}${MERGE_FILES.has(fileName) ? ' (merged)' : ''}`);
    } catch (err) {
      console.error(`  [chain] Failed to receive ${filePath}: ${err.message}`);
    }
  }

  /**
   * Merge JSONL files line-by-line instead of overwriting.
   * Entities merge by name (union of observations).
   * Relations merge by from+to+relationType (deduplicated).
   * No data is ever lost — additive merge only.
   */
  async mergeJsonl(fullPath, remoteContent) {
    // Parse remote lines
    const remoteLines = remoteContent.toString('utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    // Parse local lines (if file exists)
    let localLines = [];
    if (existsSync(fullPath)) {
      try {
        const localContent = await fs.readFile(fullPath, 'utf-8');
        localLines = localContent
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => { try { return JSON.parse(l); } catch { return null; } })
          .filter(Boolean);
      } catch { /* empty or unreadable */ }
    }

    // Build entity map: name → entity (with merged observations)
    const entities = new Map();
    const relations = new Set();
    const relationObjects = [];

    // Process local first, then remote (remote adds what's missing)
    for (const lines of [localLines, remoteLines]) {
      for (const line of lines) {
        if (line.type === 'entity') {
          const existing = entities.get(line.name);
          if (existing) {
            // Merge observations (union, deduplicated)
            const obsSet = new Set(existing.observations || []);
            for (const obs of (line.observations || [])) {
              obsSet.add(obs);
            }
            existing.observations = [...obsSet];
            // Keep the most specific entityType
            if (line.entityType && !existing.entityType) {
              existing.entityType = line.entityType;
            }
          } else {
            entities.set(line.name, { ...line });
          }
        } else if (line.type === 'relation') {
          const key = `${line.from}|${line.to}|${line.relationType}`;
          if (!relations.has(key)) {
            relations.add(key);
            relationObjects.push(line);
          }
        }
      }
    }

    // Write merged result
    const merged = [
      ...Array.from(entities.values()),
      ...relationObjects,
    ];

    await fs.writeFile(
      fullPath,
      merged.map((obj) => JSON.stringify(obj)).join('\n') + (merged.length > 0 ? '\n' : ''),
    );

    const localCount = localLines.length;
    const remoteCount = remoteLines.length;
    const mergedCount = merged.length;
    if (mergedCount > localCount) {
      console.log(`  [chain] JSONL merge: ${localCount} local + ${remoteCount} remote → ${mergedCount} merged`);
    }
  }

  sendSocket(socket, msg) {
    try {
      socket.write(JSON.stringify(msg) + '\n');
    } catch {
      // Socket may be closed
    }
  }

  /**
   * Compute health status based on peer activity.
   * - synced: manifest exchanged recently, all files match
   * - syncing: files are actively being transferred
   * - idle: connected but no manifest exchange in 5+ minutes
   * - stale: connected but no manifest exchange in 30+ minutes
   * - offline: no peers connected
   */
  computeHealth() {
    if (this.peers.size === 0) return 'offline';

    const now = Date.now();
    let hasSyncing = false;
    let hasFresh = false;

    for (const [, peer] of this.peers) {
      // Check if files were transferred recently (last 60s)
      if (peer.lastSync) {
        const sinceLast = now - new Date(peer.lastSync).getTime();
        if (sinceLast < 60000) hasSyncing = true;
      }

      // Check manifest exchange freshness
      if (peer.lastManifestExchange) {
        const sinceManifest = now - new Date(peer.lastManifestExchange).getTime();
        if (sinceManifest < 300000) hasFresh = true; // < 5 minutes
      }
    }

    if (hasSyncing) return 'syncing';
    if (hasFresh) return 'synced';

    // Check if any peer ever had a manifest exchange
    let anyManifest = false;
    for (const [, peer] of this.peers) {
      if (peer.lastManifestExchange) {
        const sinceManifest = now - new Date(peer.lastManifestExchange).getTime();
        if (sinceManifest < 1800000) { anyManifest = true; break; } // < 30 minutes
      }
    }

    return anyManifest ? 'idle' : 'stale';
  }

  writeStatus() {
    const peers = [];
    for (const [id, peer] of this.peers) {
      peers.push({
        id,
        connectedAt: peer.connectedAt,
        filesReceived: peer.filesReceived,
        filesSent: peer.filesSent,
        lastSync: peer.lastSync,
        lastManifestExchange: peer.lastManifestExchange || null,
      });
    }

    const status = {
      active: true,
      health: this.computeHealth(),
      peers,
      totalSynced: this.totalSynced,
      since: this.startedAt,
      lastUpdate: new Date().toISOString(),
    };

    try {
      writeFileSync(this.statusPath, JSON.stringify(status, null, 2));
    } catch {
      // Ignore write errors
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

      for (const [, peer] of this.peers) {
        this.sendSocket(peer.socket, msg);
        peer.filesSent++;
        peer.lastSync = new Date().toISOString();
      }

      if (this.peers.size > 0) {
        this.totalSynced += this.peers.size;
        this.writeStatus();
        console.log(`  [chain] Broadcast: ${filePath} → ${this.peers.size} peer(s)`);
      }
    } catch (err) {
      console.error(`  [chain] Broadcast failed for ${filePath}: ${err.message}`);
    }
  }
}
