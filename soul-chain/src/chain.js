import Hyperswarm from 'hyperswarm';
import chokidar from 'chokidar';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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

// Files that must NEVER be overwritten by chain sync (immutable)
const IMMUTABLE_FILES = new Set([
  'KERN.md', 'CORE.md',
]);

const IGNORE = new Set([
  '.env', '.mcp.json', '.soul-pulse', '.session-writes', '.soul-route-log',
  '.git', '.claude', '.soul-chain', '.soul-chain-status',
  'node_modules', 'soul-engine', 'soul-monitor', 'soul-card',
  'soul-chain', 'skills', 'docs', 'hooks',
  'CLAUDE.md', 'HEARTBEAT.md', 'SEED_SPEC.md', 'CHANGELOG.md',
  'README.md', 'README.de.md', 'LICENSE',
  'banner.png', 'logo.png', '.env.example', '.gitignore',
  '.rollback', 'scripts',
]);

const CONFIG_FILE = '.soul-chain';
const FALLBACK_POLL_INTERVAL = 30000; // 30 seconds — fallback for edge cases
const DEBOUNCE_MS = 100; // 100ms debounce for rapid successive changes

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
    this.watcher = null;          // chokidar watcher instance
    this.pollTimer = null;        // fallback poll timer
    this.statusTimer = null;
    this.debounceTimers = new Map(); // filePath → timeout (debounce per file)
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

    // Start chokidar file watcher for instant change detection
    this.startWatcher();

    // Start fallback polling (30s) for edge cases chokidar might miss
    this.startFallbackPolling();

    // Periodic status refresh (every 30s so monitor sees fresh timestamps)
    this.statusTimer = setInterval(() => this.writeStatus(), 30000);

    return true;
  }

  async stop() {
    // Clean up chokidar watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      console.log('  [chain] File watcher closed.');
    }

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

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

      // SAFETY: Don't propagate empty files (except newly created ones)
      if (content.length === 0) {
        console.warn(`  [chain] Skipping send of empty file: ${filePath} (to peer ${peerId})`);
        return;
      }

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

      // SAFETY: Never overwrite immutable files
      if (IMMUTABLE_FILES.has(fileName)) {
        console.warn(`  [chain] BLOCKED: Refusing to overwrite immutable file: ${filePath} (from peer ${peerId})`);
        return;
      }

      // SAFETY: Reject empty content when local file exists and has content
      if (content.length === 0 && existsSync(fullPath)) {
        const localStat = statSync(fullPath);
        if (localStat.size > 0) {
          console.warn(`  [chain] BLOCKED: Refusing empty overwrite of ${filePath} (local: ${localStat.size} bytes, from peer ${peerId})`);
          return;
        }
      }

      // Create directories if needed
      await fs.mkdir(path.dirname(fullPath), { recursive: true });

      // JSONL merge: line-based union instead of overwrite
      if (MERGE_FILES.has(fileName)) {
        await this.mergeJsonl(fullPath, content);
      } else {
        // Atomic write: tmp file + rename prevents 0-byte files on crash
        const tmpPath = fullPath + '.chain-tmp-' + randomBytes(4).toString('hex');
        await fs.writeFile(tmpPath, content);
        await fs.rename(tmpPath, fullPath);
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

    // Write merged result (atomic: tmp + rename)
    const merged = [
      ...Array.from(entities.values()),
      ...relationObjects,
    ];

    const mergedContent = merged.map((obj) => JSON.stringify(obj)).join('\n') + (merged.length > 0 ? '\n' : '');
    const tmpPath = fullPath + '.chain-tmp-' + randomBytes(4).toString('hex');
    await fs.writeFile(tmpPath, mergedContent);
    await fs.rename(tmpPath, fullPath);

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
        // Skip empty files — don't advertise them in manifest
        if (content.length === 0) continue;
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
          // Skip empty files — don't advertise them in manifest
          if (content.length === 0) continue;
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

  // ── File Watching (chokidar) ────────────────────────

  /**
   * Start chokidar file watcher on all SYNC_DIRS and SYNC_FILES.
   * Detects changes within ~100ms (debounced) instead of 5s polling.
   */
  startWatcher() {
    // Build watch paths: existing directories and individual files
    const watchPaths = [];

    for (const dir of SYNC_DIRS) {
      const full = path.resolve(this.soulPath, dir);
      if (existsSync(full)) {
        watchPaths.push(full);
      }
    }

    for (const file of SYNC_FILES) {
      const full = path.resolve(this.soulPath, file);
      // Watch the file even if it doesn't exist yet — chokidar handles creation
      watchPaths.push(full);
    }

    if (watchPaths.length === 0) {
      console.warn('  [chain] No paths to watch — falling back to polling only.');
      return;
    }

    this.watcher = chokidar.watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,           // Don't fire for existing files on startup
      awaitWriteFinish: {            // Wait for writes to complete
        stabilityThreshold: 50,
        pollInterval: 20,
      },
      ignored: (filePath) => {
        const name = path.basename(filePath);
        // Ignore dotfiles, IGNORE set entries, and non-syncable paths
        if (name.startsWith('.') && name !== '.language'
            && name !== '.soul-impulse-state'
            && name !== '.soul-impulse-log'
            && name !== '.soul-state-tick') {
          return true;
        }
        return IGNORE.has(name);
      },
      depth: 10,                     // Reasonable depth for nested dirs
    });

    this.watcher.on('change', (absPath) => this.onWatchEvent('change', absPath));
    this.watcher.on('add', (absPath) => this.onWatchEvent('add', absPath));
    this.watcher.on('unlink', (absPath) => this.onWatchEvent('unlink', absPath));

    this.watcher.on('ready', () => {
      const watched = this.watcher.getWatched();
      const dirCount = Object.keys(watched).length;
      console.log(`  [chain] File watcher ready — watching ${dirCount} directories for instant sync.`);
    });

    this.watcher.on('error', (err) => {
      console.error(`  [chain] Watcher error: ${err.message}`);
    });
  }

  /**
   * Handle a chokidar file event with per-file debouncing.
   * Multiple rapid changes to the same file within DEBOUNCE_MS
   * are collapsed into a single broadcast.
   */
  onWatchEvent(event, absPath) {
    // Convert absolute path to relative path within soulPath
    const relPath = path.relative(this.soulPath, absPath);

    // Safety: skip if the path escapes soulPath
    if (relPath.startsWith('..') || path.isAbsolute(relPath)) return;

    // Skip unlink events — we don't propagate deletions
    if (event === 'unlink') {
      console.log(`  [chain] Watch: ${relPath} deleted (not propagated)`);
      return;
    }

    // Debounce: cancel any pending timer for this file
    const existing = this.debounceTimers.get(relPath);
    if (existing) {
      clearTimeout(existing);
    }

    // Set debounced handler
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(relPath);
      await this.handleFileChange(relPath);
    }, DEBOUNCE_MS);

    this.debounceTimers.set(relPath, timer);
  }

  /**
   * Process a detected file change: update manifest and broadcast to peers.
   */
  async handleFileChange(relPath) {
    const fullPath = path.resolve(this.soulPath, relPath);

    if (!existsSync(fullPath)) return;

    try {
      const content = await fs.readFile(fullPath);
      // Skip empty files
      if (content.length === 0) return;

      const newHash = hashFile(content);
      const stat = statSync(fullPath);
      const old = this.manifest.get(relPath);

      // Only broadcast if the hash actually changed
      if (old && old.hash === newHash) return;

      // Update manifest
      this.manifest.set(relPath, {
        hash: newHash,
        mtime: stat.mtimeMs,
      });

      console.log(`  [chain] Detected: ${relPath} (${old ? 'changed' : 'new'})`);

      // Broadcast to all connected peers
      await this.broadcastFile(relPath);
    } catch (err) {
      console.error(`  [chain] Watch handler error for ${relPath}: ${err.message}`);
    }
  }

  // ── Fallback Polling ──────────────────────────────────

  /**
   * Fallback polling at 30s intervals.
   * Catches edge cases that chokidar might miss (network mounts,
   * files created in new directories, etc.)
   */
  startFallbackPolling() {
    this.pollTimer = setInterval(async () => {
      const oldManifest = new Map(this.manifest);
      await this.buildManifest();

      // Find changed files
      let changesFound = 0;
      for (const [filePath, info] of this.manifest) {
        const old = oldManifest.get(filePath);
        if (!old || old.hash !== info.hash) {
          // File changed locally — broadcast to all peers
          changesFound++;
          this.broadcastFile(filePath);
        }
      }

      if (changesFound > 0) {
        console.log(`  [chain] Fallback poll found ${changesFound} change(s).`);
      }
    }, FALLBACK_POLL_INTERVAL);
  }

  async broadcastFile(filePath) {
    const fullPath = path.resolve(this.soulPath, filePath);
    if (!existsSync(fullPath)) return;

    try {
      const content = await fs.readFile(fullPath);

      // SAFETY: Never broadcast empty files (could be mid-write by another process)
      if (content.length === 0) {
        console.warn(`  [chain] Skipping broadcast of empty file: ${filePath}`);
        return;
      }

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
