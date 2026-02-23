/**
 * Encryption at Rest — transparent file encryption for sensitive soul data.
 *
 * Uses AES-256-GCM via Node.js built-in crypto.
 * Key from SOUL_ENCRYPTION_KEY environment variable.
 *
 * Sensitive files (encrypted):
 *   - seele/beziehungen/*.md / soul/relationships/*.md
 *   - erinnerungen/emotional/*.md / memories/emotional/*.md
 *   - seele/SCHATTEN.md / soul/SHADOW.md
 *   - conversations/**
 *   - .soul-impulse-state
 *   - .soul-rluf-state
 *
 * Always unencrypted (for tooling compatibility):
 *   - SEED.md
 *   - seele/KERN.md / soul/CORE.md
 *   - heartbeat/*.md
 *   - .soul-pulse, .soul-mood, .soul-state-tick
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, relative, dirname, extname, basename } from 'path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT = 'soul-protocol-v1'; // Fixed salt — key derivation via scrypt
const KEY_LENGTH = 32;

// File patterns that should be encrypted (relative to soulPath)
const SENSITIVE_PATTERNS = [
  /^seele\/beziehungen\//,
  /^soul\/relationships\//,
  /^erinnerungen\/emotional\//,
  /^memories\/emotional\//,
  /^seele\/SCHATTEN\.md$/,
  /^soul\/SHADOW\.md$/,
  /^conversations\//,
  /^\.soul-impulse-state$/,
  /^\.soul-rluf-state$/,
];

// Files that should NEVER be encrypted
const NEVER_ENCRYPT = [
  /^SEED\.md$/,
  /^SOUL\.md$/,
  /^seele\/KERN\.md$/,
  /^soul\/CORE\.md$/,
  /^heartbeat\//,
  /^\.soul-pulse$/,
  /^\.soul-mood$/,
  /^\.soul-state-tick$/,
  /^\.soul-events\//,
  /^\.session-active$/,
  /^\.language$/,
  /^\.mcp\.json$/,
  /^\.env$/,
  /^\.gitignore$/,
  /^knowledge-graph\.jsonl$/,
];

export class EncryptionLayer {
  constructor(soulPath, { bus } = {}) {
    this.soulPath = soulPath;
    this.bus = bus || null;
    this.key = null;
    this.enabled = false;
  }

  /**
   * Initialize the encryption layer.
   * Returns true if encryption is active, false otherwise.
   */
  init() {
    const rawKey = process.env.SOUL_ENCRYPTION_KEY;
    if (!rawKey) {
      this.enabled = false;
      return false;
    }

    // Derive a 256-bit key from the password using scrypt
    this.key = scryptSync(rawKey, SALT, KEY_LENGTH);
    this.enabled = true;

    // Write key hash for chain sync verification
    const keyHash = createHash('sha256').update(this.key).digest('hex').substring(0, 16);
    writeFileSync(resolve(this.soulPath, '.soul-encryption'), `key-hash:${keyHash}\nstatus:active\n`);

    if (this.bus) {
      this.bus.safeEmit('encryption.initialized', {
        source: 'encryption',
        status: 'active',
        keyHash,
      });
    }

    return true;
  }

  /**
   * Check if a file path should be encrypted.
   */
  isSensitive(filePath) {
    const rel = relative(this.soulPath, resolve(this.soulPath, filePath));
    if (NEVER_ENCRYPT.some(p => p.test(rel))) return false;
    return SENSITIVE_PATTERNS.some(p => p.test(rel));
  }

  /**
   * Encrypt data using AES-256-GCM.
   * Returns a Buffer: [IV (16 bytes)][Auth Tag (16 bytes)][Ciphertext]
   */
  encrypt(plaintext) {
    if (!this.key) throw new Error('Encryption not initialized');
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]);
  }

  /**
   * Decrypt data using AES-256-GCM.
   * Input: Buffer with [IV (16)][Auth Tag (16)][Ciphertext]
   */
  decrypt(encryptedBuffer) {
    if (!this.key) throw new Error('Encryption not initialized');
    if (encryptedBuffer.length < IV_LENGTH + TAG_LENGTH + 1) {
      throw new Error('Invalid encrypted data: too short');
    }
    const iv = encryptedBuffer.subarray(0, IV_LENGTH);
    const tag = encryptedBuffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = encryptedBuffer.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
  }

  /**
   * Transparent read: if file has .enc extension, decrypt it.
   * Otherwise read normally.
   */
  wrapRead(filePath) {
    const absPath = resolve(this.soulPath, filePath);
    const encPath = absPath + '.enc';

    if (this.enabled && existsSync(encPath)) {
      const data = readFileSync(encPath);
      return this.decrypt(data);
    }

    if (existsSync(absPath)) {
      return readFileSync(absPath, 'utf-8');
    }

    return null;
  }

  /**
   * Transparent write: if file should be encrypted and encryption is enabled,
   * write to .enc file. Otherwise write normally.
   */
  wrapWrite(filePath, content) {
    const absPath = resolve(this.soulPath, filePath);
    const dir = dirname(absPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (this.enabled && this.isSensitive(filePath)) {
      const encrypted = this.encrypt(content);
      writeFileSync(absPath + '.enc', encrypted);
      // Remove plaintext version if it exists
      if (existsSync(absPath)) {
        unlinkSync(absPath);
      }
      return true;
    }

    writeFileSync(absPath, content, 'utf-8');
    return false;
  }

  /**
   * Encrypt all existing sensitive files that are currently in plaintext.
   */
  encryptAll() {
    if (!this.enabled) return { encrypted: 0 };
    let count = 0;

    const walk = (dir) => {
      if (!existsSync(dir)) return;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && !entry.name.endsWith('.enc')) {
          const rel = relative(this.soulPath, full);
          if (this.isSensitive(rel)) {
            const content = readFileSync(full, 'utf-8');
            const encrypted = this.encrypt(content);
            writeFileSync(full + '.enc', encrypted);
            renameSync(full, full + '.bak'); // Keep backup
            count++;
          }
        }
      }
    };

    walk(this.soulPath);
    return { encrypted: count };
  }

  /**
   * Decrypt all .enc files back to plaintext.
   */
  decryptAll() {
    if (!this.key) return { decrypted: 0 };
    let count = 0;

    const walk = (dir) => {
      if (!existsSync(dir)) return;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.enc')) {
          try {
            const data = readFileSync(full);
            const plaintext = this.decrypt(data);
            const originalPath = full.replace(/\.enc$/, '');
            writeFileSync(originalPath, plaintext, 'utf-8');
            count++;
          } catch (err) {
            console.error(`  [encryption] Failed to decrypt ${full}: ${err.message}`);
          }
        }
      }
    };

    walk(this.soulPath);
    return { decrypted: count };
  }

  /**
   * Get encryption status.
   */
  getStatus() {
    return {
      enabled: this.enabled,
      keyConfigured: !!this.key,
      sensitivePatterns: SENSITIVE_PATTERNS.length,
    };
  }
}
