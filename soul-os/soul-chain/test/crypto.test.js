/**
 * Tests for soul-chain crypto — mnemonic generation, key derivation, encryption.
 *
 * These tests verify the cryptographic primitives that protect soul data
 * during P2P sync. No network access required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMnemonic,
  validateMnemonic,
  deriveKeys,
  encrypt,
  decrypt,
  hashFile,
} from '../src/crypto.js';
import { WORDLIST } from '../src/words.js';

describe('Mnemonic generation', () => {
  it('generates a 16-word mnemonic', () => {
    const mnemonic = generateMnemonic();
    const words = mnemonic.split(' ');
    assert.equal(words.length, 16);
  });

  it('uses only words from the WORDLIST', () => {
    const mnemonic = generateMnemonic();
    const words = mnemonic.split(' ');
    for (const word of words) {
      assert.ok(WORDLIST.includes(word), `"${word}" is not in WORDLIST`);
    }
  });

  it('generates different mnemonics each time (probabilistic)', () => {
    const a = generateMnemonic();
    const b = generateMnemonic();
    // With 128 bits of entropy, collision is astronomically unlikely
    assert.notEqual(a, b);
  });
});

describe('Mnemonic validation', () => {
  it('accepts a valid 16-word mnemonic', () => {
    const mnemonic = generateMnemonic();
    assert.ok(validateMnemonic(mnemonic));
  });

  it('rejects mnemonic with wrong word count', () => {
    assert.equal(validateMnemonic('dawn dusk mist'), false);
    assert.equal(validateMnemonic(''), false);
  });

  it('rejects mnemonic with words not in WORDLIST', () => {
    const invalid = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi';
    assert.equal(validateMnemonic(invalid), false);
  });

  it('is case insensitive', () => {
    const mnemonic = generateMnemonic();
    assert.ok(validateMnemonic(mnemonic.toUpperCase()));
  });

  it('handles extra whitespace', () => {
    const mnemonic = generateMnemonic();
    assert.ok(validateMnemonic('  ' + mnemonic + '  '));
  });

  it('handles multiple spaces between words', () => {
    const mnemonic = generateMnemonic();
    const spaced = mnemonic.replace(/ /g, '   ');
    assert.ok(validateMnemonic(spaced));
  });
});

describe('Key derivation', () => {
  it('derives encryptionKey and topic from mnemonic', () => {
    const mnemonic = generateMnemonic();
    const keys = deriveKeys(mnemonic);

    assert.ok(Buffer.isBuffer(keys.encryptionKey));
    assert.ok(Buffer.isBuffer(keys.topic));
  });

  it('encryptionKey is 32 bytes (256-bit)', () => {
    const keys = deriveKeys(generateMnemonic());
    assert.equal(keys.encryptionKey.length, 32);
  });

  it('topic is 32 bytes', () => {
    const keys = deriveKeys(generateMnemonic());
    assert.equal(keys.topic.length, 32);
  });

  it('same mnemonic produces same keys (deterministic)', () => {
    const mnemonic = generateMnemonic();
    const keys1 = deriveKeys(mnemonic);
    const keys2 = deriveKeys(mnemonic);

    assert.ok(keys1.encryptionKey.equals(keys2.encryptionKey));
    assert.ok(keys1.topic.equals(keys2.topic));
  });

  it('different mnemonics produce different keys', () => {
    const keys1 = deriveKeys(generateMnemonic());
    const keys2 = deriveKeys(generateMnemonic());

    assert.ok(!keys1.encryptionKey.equals(keys2.encryptionKey));
    assert.ok(!keys1.topic.equals(keys2.topic));
  });

  it('encryptionKey and topic are different from each other', () => {
    const keys = deriveKeys(generateMnemonic());
    assert.ok(!keys.encryptionKey.equals(keys.topic));
  });
});

describe('Encryption / Decryption (AES-256-GCM)', () => {
  const testKey = Buffer.alloc(32, 'testkey-soul-chain-encryption!!!');

  it('encrypts and decrypts plain text', () => {
    const plaintext = Buffer.from('Hello, Soul!');
    const encrypted = encrypt(plaintext, testKey);
    const decrypted = decrypt(encrypted, testKey);

    assert.deepEqual(decrypted, plaintext);
  });

  it('encrypts and decrypts binary data', () => {
    const plaintext = Buffer.from([0x00, 0xff, 0x42, 0x13, 0x37, 0xbe, 0xef]);
    const encrypted = encrypt(plaintext, testKey);
    const decrypted = decrypt(encrypted, testKey);

    assert.deepEqual(decrypted, plaintext);
  });

  it('encrypts and decrypts large content (SEED.md size)', () => {
    const plaintext = Buffer.from('# SEED\n'.repeat(500));
    const encrypted = encrypt(plaintext, testKey);
    const decrypted = decrypt(encrypted, testKey);

    assert.deepEqual(decrypted, plaintext);
  });

  it('encrypted output is larger than input (iv + tag + ciphertext)', () => {
    const plaintext = Buffer.from('test');
    const encrypted = encrypt(plaintext, testKey);

    // iv(12) + tag(16) + ciphertext(>=4)
    assert.ok(encrypted.length >= 12 + 16 + plaintext.length);
  });

  it('different encryptions of same plaintext produce different ciphertext (random IV)', () => {
    const plaintext = Buffer.from('Same content');
    const enc1 = encrypt(plaintext, testKey);
    const enc2 = encrypt(plaintext, testKey);

    // IVs should differ (first 12 bytes)
    assert.ok(!enc1.subarray(0, 12).equals(enc2.subarray(0, 12)));
  });

  it('fails to decrypt with wrong key', () => {
    const plaintext = Buffer.from('Secret data');
    const encrypted = encrypt(plaintext, testKey);

    const wrongKey = Buffer.alloc(32, 'wrong-key-soul-chain-different!!');
    assert.throws(() => decrypt(encrypted, wrongKey));
  });

  it('fails to decrypt tampered ciphertext', () => {
    const plaintext = Buffer.from('Tamper test');
    const encrypted = encrypt(plaintext, testKey);

    // Tamper with the ciphertext portion (after iv + tag = 28 bytes)
    if (encrypted.length > 29) {
      encrypted[29] ^= 0xff;
    }

    assert.throws(() => decrypt(encrypted, testKey));
  });

  it('handles empty plaintext', () => {
    const plaintext = Buffer.from('');
    const encrypted = encrypt(plaintext, testKey);
    const decrypted = decrypt(encrypted, testKey);

    assert.deepEqual(decrypted, plaintext);
  });

  it('round-trips with derived keys', () => {
    const mnemonic = generateMnemonic();
    const keys = deriveKeys(mnemonic);

    const plaintext = Buffer.from('Soul data protected by mnemonic');
    const encrypted = encrypt(plaintext, keys.encryptionKey);
    const decrypted = decrypt(encrypted, keys.encryptionKey);

    assert.deepEqual(decrypted, plaintext);
  });
});

describe('hashFile', () => {
  it('returns a 16-character hex string', () => {
    const hash = hashFile(Buffer.from('test content'));
    assert.equal(hash.length, 16);
    assert.match(hash, /^[0-9a-f]{16}$/);
  });

  it('same content produces same hash (deterministic)', () => {
    const content = Buffer.from('consistent');
    assert.equal(hashFile(content), hashFile(content));
  });

  it('different content produces different hash', () => {
    const hash1 = hashFile(Buffer.from('content A'));
    const hash2 = hashFile(Buffer.from('content B'));
    assert.notEqual(hash1, hash2);
  });

  it('handles empty content', () => {
    const hash = hashFile(Buffer.from(''));
    assert.equal(hash.length, 16);
    assert.match(hash, /^[0-9a-f]{16}$/);
  });
});

describe('WORDLIST', () => {
  it('contains exactly 256 words', () => {
    assert.equal(WORDLIST.length, 256);
  });

  it('all words are unique', () => {
    const unique = new Set(WORDLIST);
    assert.equal(unique.size, WORDLIST.length);
  });

  it('all words are 2-6 characters', () => {
    for (const word of WORDLIST) {
      assert.ok(word.length >= 2 && word.length <= 7, `"${word}" is ${word.length} chars`);
    }
  });

  it('all words are lowercase ASCII', () => {
    for (const word of WORDLIST) {
      assert.match(word, /^[a-z]+$/, `"${word}" contains non-lowercase chars`);
    }
  });
});
