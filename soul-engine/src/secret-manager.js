/**
 * Secret Manager — encrypts .env secrets at rest.
 *
 * Encrypts .env to .env.enc (AES-256-GCM). At startup, decrypts
 * into process.env in memory — never writes plaintext back to disk.
 *
 * Key derivation: scrypt from SOUL_SECRET_KEY environment variable
 * or from a file-based key at .soul-secret-key.
 *
 * CLI commands:
 *   soul-engine encrypt-env  — Encrypt .env → .env.enc, remove .env
 *   soul-engine decrypt-env  — Decrypt .env.enc → .env
 *   soul-engine rotate-key   — Re-encrypt with a new key
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, existsSync, unlinkSync, renameSync } from 'fs';
import { resolve } from 'path';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT = 'soul-secret-manager-v1';
const KEY_LENGTH = 32;
const KEY_FILE = '.soul-secret-key';
const ENV_FILE = '.env';
const ENC_FILE = '.env.enc';

export class SecretManager {
  constructor(soulPath) {
    this.soulPath = soulPath;
    this.envPath = resolve(soulPath, ENV_FILE);
    this.encPath = resolve(soulPath, ENC_FILE);
    this.keyFilePath = resolve(soulPath, KEY_FILE);
    this._derivedKey = null;
  }

  /**
   * Load secrets into process.env.
   *
   * Priority:
   * 1. If .env.enc exists and key available → decrypt to memory
   * 2. If .env exists → load plaintext and auto-encrypt if key available
   * 3. Neither exists → no-op
   *
   * @returns {{ source: string, keyCount: number }}
   */
  load() {
    const key = this._getKey();

    // Case 1: Encrypted file exists
    if (existsSync(this.encPath)) {
      if (!key) {
        console.error('  [secrets] .env.enc exists but no SOUL_SECRET_KEY — cannot decrypt');
        return { source: 'none', keyCount: 0 };
      }

      const envContent = this._decrypt(key);
      const count = this._loadIntoEnv(envContent);
      console.log(`  [secrets] Loaded ${count} secret(s) from .env.enc`);
      return { source: 'encrypted', keyCount: count };
    }

    // Case 2: Plaintext .env exists
    if (existsSync(this.envPath)) {
      const envContent = readFileSync(this.envPath, 'utf-8');
      const count = this._loadIntoEnv(envContent);

      // Auto-encrypt if key is available
      if (key) {
        this._encrypt(key, envContent);
        unlinkSync(this.envPath);
        console.log(`  [secrets] Migrated .env → .env.enc (${count} secrets encrypted)`);
      } else {
        console.warn('  [secrets] Loaded .env in plaintext — set SOUL_SECRET_KEY to encrypt');
      }

      return { source: key ? 'migrated' : 'plaintext', keyCount: count };
    }

    // Case 3: No env files
    return { source: 'none', keyCount: 0 };
  }

  /**
   * Encrypt the current .env file to .env.enc.
   * Removes .env after successful encryption.
   * @returns {boolean}
   */
  encryptEnv() {
    const key = this._getKey();
    if (!key) {
      console.error('  [secrets] No SOUL_SECRET_KEY set — cannot encrypt');
      return false;
    }

    if (!existsSync(this.envPath)) {
      console.error('  [secrets] No .env file found');
      return false;
    }

    const envContent = readFileSync(this.envPath, 'utf-8');
    this._encrypt(key, envContent);
    unlinkSync(this.envPath);
    console.log('  [secrets] .env encrypted to .env.enc');
    return true;
  }

  /**
   * Decrypt .env.enc back to plaintext .env.
   * @returns {boolean}
   */
  decryptEnv() {
    const key = this._getKey();
    if (!key) {
      console.error('  [secrets] No SOUL_SECRET_KEY set — cannot decrypt');
      return false;
    }

    if (!existsSync(this.encPath)) {
      console.error('  [secrets] No .env.enc file found');
      return false;
    }

    const envContent = this._decrypt(key);
    writeFileSync(this.envPath, envContent, 'utf-8');
    console.log('  [secrets] .env.enc decrypted to .env');
    return true;
  }

  /**
   * Re-encrypt .env.enc with a new key.
   * Requires the old key to be available, and SOUL_SECRET_KEY_NEW
   * to contain the new key.
   * @param {string} newKeyStr - The new key string
   * @returns {boolean}
   */
  rotateKey(newKeyStr) {
    const oldKey = this._getKey();
    if (!oldKey) {
      console.error('  [secrets] No current SOUL_SECRET_KEY — cannot rotate');
      return false;
    }

    if (!newKeyStr) {
      console.error('  [secrets] No new key provided');
      return false;
    }

    if (!existsSync(this.encPath)) {
      console.error('  [secrets] No .env.enc to rotate');
      return false;
    }

    // Decrypt with old key
    const envContent = this._decrypt(oldKey);

    // Encrypt with new key
    const newKey = scryptSync(newKeyStr, SALT, KEY_LENGTH);
    this._encrypt(newKey, envContent);

    console.log('  [secrets] .env.enc re-encrypted with new key');
    return true;
  }

  /**
   * Check the current state of secret management.
   * @returns {{ hasEnv: boolean, hasEncrypted: boolean, hasKey: boolean }}
   */
  getStatus() {
    return {
      hasEnv: existsSync(this.envPath),
      hasEncrypted: existsSync(this.encPath),
      hasKey: !!this._getKey(),
    };
  }

  // ── Internal ───────────────────────────────────────────

  _getKey() {
    if (this._derivedKey) return this._derivedKey;

    // Try environment variable first
    let keyStr = process.env.SOUL_SECRET_KEY;

    // Fall back to key file
    if (!keyStr && existsSync(this.keyFilePath)) {
      keyStr = readFileSync(this.keyFilePath, 'utf-8').trim();
    }

    if (!keyStr) return null;

    this._derivedKey = scryptSync(keyStr, SALT, KEY_LENGTH);
    return this._derivedKey;
  }

  _encrypt(key, plaintext) {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Format: IV (16) + Tag (16) + Ciphertext
    const combined = Buffer.concat([iv, tag, encrypted]);
    writeFileSync(this.encPath, combined);
  }

  _decrypt(key) {
    const data = readFileSync(this.encPath);

    if (data.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('.env.enc is too short — corrupted?');
    }

    const iv = data.subarray(0, IV_LENGTH);
    const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = data.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    return decipher.update(encrypted) + decipher.final('utf-8');
  }

  /**
   * Parse .env content and load into process.env.
   * Does NOT overwrite existing env vars.
   * @returns {number} Number of keys loaded
   */
  _loadIntoEnv(content) {
    let count = 0;
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;

      const key = trimmed.substring(0, eqIdx).trim();
      let value = trimmed.substring(eqIdx + 1).trim();

      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      // Don't overwrite existing env vars (they take precedence)
      if (!(key in process.env)) {
        process.env[key] = value;
        count++;
      }
    }
    return count;
  }
}
