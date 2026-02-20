import crypto from 'node:crypto';
import { WORDLIST } from './words.js';

const WORD_COUNT = 16; // 16 words × 8 bits = 128 bits entropy
const SALT = 'soul-chain-v1';

// ── Mnemonic ────────────────────────────────────────────

/** Generate a 16-word soul token */
export function generateMnemonic() {
  const entropy = crypto.randomBytes(WORD_COUNT);
  return Array.from(entropy).map((b) => WORDLIST[b]).join(' ');
}

/** Validate a mnemonic string */
export function validateMnemonic(mnemonic) {
  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  if (words.length !== WORD_COUNT) return false;
  return words.every((w) => WORDLIST.includes(w));
}

/** Convert mnemonic back to entropy bytes */
function mnemonicToEntropy(mnemonic) {
  const words = mnemonic.trim().toLowerCase().split(/\s+/);
  return Buffer.from(words.map((w) => WORDLIST.indexOf(w)));
}

// ── Key Derivation ──────────────────────────────────────

/**
 * Derive all keys from a mnemonic:
 * - encryptionKey: 32 bytes for AES-256-GCM file encryption
 * - topic:         32 bytes for Hyperswarm discovery
 */
export function deriveKeys(mnemonic) {
  const entropy = mnemonicToEntropy(mnemonic);

  const encryptionKey = crypto.scryptSync(entropy, SALT + ':enc', 32);
  const topic = crypto.scryptSync(entropy, SALT + ':topic', 32);

  return { encryptionKey, topic };
}

// ── File Encryption (AES-256-GCM) ───────────────────────

export function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);

  const tag = cipher.getAuthTag();

  // Format: iv (12) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]);
}

export function decrypt(data, key) {
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
}

// ── Hashing ─────────────────────────────────────────────

export function hashFile(content) {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}
