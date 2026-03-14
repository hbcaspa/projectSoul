/**
 * SoulToken — BIP-39 Key Derivation + Per-Device Token Management
 *
 * Das Problem: Das aktuelle Soul Token (16 Wörter) hat kein standardisiertes
 * Key-Derivation-Verfahren. Ein kompromittiertes Token gibt Zugang zu ALLEN
 * Sync-Instanzen gleichzeitig.
 *
 * Lösung:
 *  - BIP-39 Mnemonic → PBKDF2 Key Derivation (Standard, interoperabel)
 *  - Per-Device Tokens: Jedes Gerät hat eigenen abgeleiteten Key
 *  - Device Revocation: Einzelnes Gerät kann widerrufen werden ohne Master zu ändern
 *  - Key Hierarchy: Master → Device → Session → Ephemeral
 *  - Audit-Trail: Wer hat wann welchen Key benutzt
 *
 * Konfiguration:
 *   SOUL_TOKEN="word1 word2 ... word16"  (bestehend, wird weiter unterstützt)
 *   SOUL_TOKEN_KDF=pbkdf2               (aktiviert BIP-39 Derivation)
 *   SOUL_TOKEN_ITERATIONS=600000         (PBKDF2 Iterationen, default 600k)
 */

import { createHash, pbkdf2Sync, randomBytes, createHmac } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_ITERATIONS = 600_000;
const KEY_LENGTH = 32; // 256 bit
const SALT_LENGTH = 16;

export class SoulToken {
  constructor({ soulPath, bus } = {}) {
    this.soulPath = soulPath;
    this.bus      = bus;
    this._masterKey = null;
    this._devices = new Map(); // deviceId → { key, name, created, lastUsed, revoked }
    this._stateFile = join(soulPath, 'connections', 'soul-token-state.json');
    this._useKDF = process.env.SOUL_TOKEN_KDF === 'pbkdf2';
    this._iterations = parseInt(process.env.SOUL_TOKEN_ITERATIONS) || DEFAULT_ITERATIONS;
  }

  async init() {
    const token = process.env.SOUL_TOKEN;
    if (!token) {
      console.log('  [soul-token] No SOUL_TOKEN configured');
      return;
    }

    if (this._useKDF) {
      // BIP-39 style: Mnemonic → Key via PBKDF2
      this._masterKey = this._deriveFromMnemonic(token);
      console.log(`  [soul-token] BIP-39 KDF active (${this._iterations} iterations)`);
    } else {
      // Legacy: Direct SHA-256 hash (backward compatible)
      this._masterKey = createHash('sha256').update(token).digest();
      console.log('  [soul-token] Legacy mode (SHA-256 direct hash)');
    }

    await this._loadDevices();

    // Register this device if not already known
    const nodeName = process.env.SOUL_NODE_NAME || 'unknown';
    if (!this._devices.has(nodeName)) {
      await this.registerDevice(nodeName);
    }

    // Update last used
    const device = this._devices.get(nodeName);
    if (device) {
      device.lastUsed = new Date().toISOString();
      await this._saveDevices();
    }

    console.log(`  [soul-token] ${this._devices.size} device(s) registered`);
  }

  /**
   * Derive key from BIP-39 mnemonic using PBKDF2.
   * Uses the mnemonic as password and "soul-protocol" as base salt.
   */
  _deriveFromMnemonic(mnemonic) {
    const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
    const salt = Buffer.from('soul-protocol-v1', 'utf-8');
    return pbkdf2Sync(normalized, salt, this._iterations, KEY_LENGTH, 'sha512');
  }

  /**
   * Derive a per-device key from the master key.
   * Each device gets a unique key derived deterministically.
   */
  deriveDeviceKey(deviceId) {
    if (!this._masterKey) throw new Error('Master key not initialized');
    return pbkdf2Sync(
      this._masterKey,
      Buffer.from(`device:${deviceId}`, 'utf-8'),
      1000, // Fewer iterations for device derivation (master already hardened)
      KEY_LENGTH,
      'sha256'
    );
  }

  /**
   * Derive a session key (ephemeral, changes every session).
   */
  deriveSessionKey(deviceId, sessionId) {
    const deviceKey = this.deriveDeviceKey(deviceId);
    return createHmac('sha256', deviceKey)
      .update(`session:${sessionId}:${Date.now()}`)
      .digest();
  }

  /**
   * Register a new device.
   */
  async registerDevice(deviceId, name = null) {
    if (this._devices.has(deviceId)) return this._devices.get(deviceId);

    const deviceKey = this.deriveDeviceKey(deviceId);
    const device = {
      id: deviceId,
      name: name || deviceId,
      keyFingerprint: createHash('sha256').update(deviceKey).digest('hex').slice(0, 16),
      created: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      revoked: false,
    };

    this._devices.set(deviceId, device);
    await this._saveDevices();

    this.bus?.safeEmit?.('token.device_registered', { deviceId, name: device.name });
    return device;
  }

  /**
   * Revoke a device — its key can no longer be used for authentication.
   */
  async revokeDevice(deviceId) {
    const device = this._devices.get(deviceId);
    if (!device) return false;

    device.revoked = true;
    device.revokedAt = new Date().toISOString();
    await this._saveDevices();

    this.bus?.safeEmit?.('token.device_revoked', { deviceId });
    return true;
  }

  /**
   * Verify if a device is authorized.
   */
  isDeviceAuthorized(deviceId) {
    const device = this._devices.get(deviceId);
    return device && !device.revoked;
  }

  /**
   * Verify a token presented by a peer during sync.
   * The peer presents their device ID + HMAC proof.
   */
  verifyPeer(deviceId, challenge, proof) {
    if (!this.isDeviceAuthorized(deviceId)) return false;

    const deviceKey = this.deriveDeviceKey(deviceId);
    const expected = createHmac('sha256', deviceKey).update(challenge).digest('hex');
    return expected === proof;
  }

  /**
   * Create a challenge-response proof for this device.
   */
  createProof(challenge) {
    const nodeName = process.env.SOUL_NODE_NAME || 'unknown';
    const deviceKey = this.deriveDeviceKey(nodeName);
    return {
      deviceId: nodeName,
      proof: createHmac('sha256', deviceKey).update(challenge).digest('hex'),
    };
  }

  /**
   * Get all registered devices.
   */
  getDevices() {
    return [...this._devices.values()];
  }

  /**
   * Rotate the master key (requires updating all devices).
   * This is a manual operation — should be rare.
   */
  async rotateMasterKey(newMnemonic) {
    const oldMaster = this._masterKey;
    this._masterKey = this._useKDF
      ? this._deriveFromMnemonic(newMnemonic)
      : createHash('sha256').update(newMnemonic).digest();

    // Re-derive all device keys (fingerprints change)
    for (const [id, device] of this._devices) {
      const newKey = this.deriveDeviceKey(id);
      device.keyFingerprint = createHash('sha256').update(newKey).digest('hex').slice(0, 16);
      device.lastRotated = new Date().toISOString();
    }

    await this._saveDevices();
    this.bus?.safeEmit?.('token.master_rotated', { devices: this._devices.size });
    return true;
  }

  // ── Persistence ────────────────────────────────────────────

  async _loadDevices() {
    if (!existsSync(this._stateFile)) return;
    try {
      const data = JSON.parse(await readFile(this._stateFile, 'utf-8'));
      for (const device of (data.devices || [])) {
        this._devices.set(device.id, device);
      }
    } catch { /* start fresh */ }
  }

  async _saveDevices() {
    await mkdir(join(this.soulPath, 'connections'), { recursive: true });
    const data = {
      version: 1,
      kdf: this._useKDF ? 'pbkdf2' : 'sha256',
      iterations: this._iterations,
      devices: [...this._devices.values()],
    };
    await writeFile(this._stateFile, JSON.stringify(data, null, 2));
  }
}
