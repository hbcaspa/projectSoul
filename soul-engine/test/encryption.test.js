import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EncryptionLayer } from '../src/encryption.js';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('EncryptionLayer', () => {
  let tmpDir;
  let enc;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-enc-'));
    process.env.SOUL_ENCRYPTION_KEY = 'test-key-for-soul-protocol';
    enc = new EncryptionLayer(tmpDir);
    enc.init();
  });

  after(() => {
    delete process.env.SOUL_ENCRYPTION_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('initializes with a key', () => {
    assert.ok(enc.enabled);
    assert.ok(enc.key);
    assert.equal(enc.key.length, 32);
  });

  it('writes key hash file', () => {
    const content = readFileSync(join(tmpDir, '.soul-encryption'), 'utf-8');
    assert.ok(content.includes('key-hash:'));
    assert.ok(content.includes('status:active'));
  });

  describe('encrypt/decrypt roundtrip', () => {
    it('encrypts and decrypts text', () => {
      const original = 'This is a secret message about the soul';
      const encrypted = enc.encrypt(original);
      assert.ok(Buffer.isBuffer(encrypted));
      assert.ok(encrypted.length > original.length);
      const decrypted = enc.decrypt(encrypted);
      assert.equal(decrypted, original);
    });

    it('encrypts and decrypts unicode text', () => {
      const original = 'Schattenarbeit: Widersprüche und Ängste';
      const encrypted = enc.encrypt(original);
      const decrypted = enc.decrypt(encrypted);
      assert.equal(decrypted, original);
    });

    it('produces different ciphertext for same plaintext (random IV)', () => {
      const text = 'Same text';
      const enc1 = enc.encrypt(text);
      const enc2 = enc.encrypt(text);
      assert.notDeepEqual(enc1, enc2);
    });

    it('fails on tampered ciphertext', () => {
      const encrypted = enc.encrypt('Secret');
      encrypted[encrypted.length - 1] ^= 0xFF; // Flip last byte
      assert.throws(() => enc.decrypt(encrypted));
    });

    it('fails on too-short data', () => {
      assert.throws(() => enc.decrypt(Buffer.from('short')));
    });
  });

  describe('isSensitive', () => {
    it('marks relationship files as sensitive', () => {
      assert.ok(enc.isSensitive('seele/beziehungen/aalm.md'));
      assert.ok(enc.isSensitive('soul/relationships/aalm.md'));
    });

    it('marks emotional memories as sensitive', () => {
      assert.ok(enc.isSensitive('erinnerungen/emotional/test.md'));
      assert.ok(enc.isSensitive('memories/emotional/test.md'));
    });

    it('marks shadow file as sensitive', () => {
      assert.ok(enc.isSensitive('seele/SCHATTEN.md'));
      assert.ok(enc.isSensitive('soul/SHADOW.md'));
    });

    it('marks conversations as sensitive', () => {
      assert.ok(enc.isSensitive('conversations/telegram/123.json'));
    });

    it('does NOT mark SEED.md as sensitive', () => {
      assert.ok(!enc.isSensitive('SEED.md'));
    });

    it('does NOT mark heartbeat as sensitive', () => {
      assert.ok(!enc.isSensitive('heartbeat/2026-02-22.md'));
    });

    it('does NOT mark KERN.md as sensitive', () => {
      assert.ok(!enc.isSensitive('seele/KERN.md'));
    });
  });

  describe('wrapRead/wrapWrite', () => {
    it('writes and reads unencrypted files normally', () => {
      enc.wrapWrite('heartbeat/test.md', 'Heartbeat content');
      const content = enc.wrapRead('heartbeat/test.md');
      assert.equal(content, 'Heartbeat content');
    });

    it('encrypts sensitive files on write', () => {
      mkdirSync(join(tmpDir, 'seele', 'beziehungen'), { recursive: true });
      enc.wrapWrite('seele/beziehungen/aalm.md', 'Private relationship data');
      // .enc file should exist
      assert.ok(existsSync(join(tmpDir, 'seele', 'beziehungen', 'aalm.md.enc')));
    });

    it('reads encrypted files transparently', () => {
      const content = enc.wrapRead('seele/beziehungen/aalm.md');
      assert.equal(content, 'Private relationship data');
    });

    it('returns null for non-existent files', () => {
      const content = enc.wrapRead('nonexistent.md');
      assert.equal(content, null);
    });
  });

  describe('encryptAll/decryptAll', () => {
    it('encrypts existing plaintext sensitive files', () => {
      mkdirSync(join(tmpDir, 'erinnerungen', 'emotional'), { recursive: true });
      writeFileSync(join(tmpDir, 'erinnerungen', 'emotional', 'joy.md'), 'Joy content');
      const result = enc.encryptAll();
      assert.ok(result.encrypted > 0);
      assert.ok(existsSync(join(tmpDir, 'erinnerungen', 'emotional', 'joy.md.enc')));
    });

    it('decrypts all .enc files', () => {
      const result = enc.decryptAll();
      assert.ok(result.decrypted > 0);
    });
  });

  describe('disabled mode', () => {
    it('works without encryption key', () => {
      const noEnc = new EncryptionLayer(tmpDir);
      delete process.env.SOUL_ENCRYPTION_KEY;
      const result = noEnc.init();
      assert.equal(result, false);
      assert.equal(noEnc.enabled, false);
      // Restore for other tests
      process.env.SOUL_ENCRYPTION_KEY = 'test-key-for-soul-protocol';
    });

    it('getStatus reports disabled', () => {
      const noEnc = new EncryptionLayer(tmpDir);
      const status = noEnc.getStatus();
      assert.equal(status.enabled, false);
    });
  });
});
