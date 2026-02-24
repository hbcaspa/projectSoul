/**
 * Tests for SecretManager — .env encryption at rest.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SecretManager } from '../src/secret-manager.js';

const TEST_ENV_CONTENT = `# Test env file
OPENAI_API_KEY=sk-test-12345
GEMINI_API_KEY=gem-test-67890
SOUL_ENCRYPTION_KEY=my-encryption-key
EMPTY_VAR=
QUOTED_VAR="hello world"
`;

// ── Encrypt / Decrypt ────────────────────────────────────────

describe('SecretManager — encrypt/decrypt roundtrip', () => {
  let tmpDir, sm;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-secret-'));
    process.env.SOUL_SECRET_KEY = 'test-secret-key-2026';
    sm = new SecretManager(tmpDir);
  });

  after(() => {
    delete process.env.SOUL_SECRET_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('encrypts .env to .env.enc', () => {
    writeFileSync(join(tmpDir, '.env'), TEST_ENV_CONTENT, 'utf-8');
    const ok = sm.encryptEnv();
    assert.equal(ok, true);
    assert.ok(existsSync(join(tmpDir, '.env.enc')));
    assert.ok(!existsSync(join(tmpDir, '.env'))); // original removed
  });

  it('decrypts .env.enc back to .env', () => {
    const ok = sm.decryptEnv();
    assert.equal(ok, true);
    assert.ok(existsSync(join(tmpDir, '.env')));

    const content = readFileSync(join(tmpDir, '.env'), 'utf-8');
    assert.equal(content, TEST_ENV_CONTENT);
  });

  it('encrypted file is not plaintext', () => {
    writeFileSync(join(tmpDir, '.env'), TEST_ENV_CONTENT, 'utf-8');
    sm.encryptEnv();

    const encrypted = readFileSync(join(tmpDir, '.env.enc'));
    const asText = encrypted.toString('utf-8');
    assert.ok(!asText.includes('OPENAI_API_KEY'));
    assert.ok(!asText.includes('sk-test-12345'));
  });
});

// ── Load into process.env ────────────────────────────────────

describe('SecretManager — load()', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-secret-load-'));
    // Clean up test keys from process.env
    delete process.env.OPENAI_API_KEY_TEST;
    delete process.env.SOUL_SECRET_KEY;
  });

  after(() => {
    delete process.env.SOUL_SECRET_KEY;
  });

  it('loads plaintext .env into process.env', () => {
    writeFileSync(join(tmpDir, '.env'), 'MY_TEST_SECRET_A=hello123\n', 'utf-8');
    const sm = new SecretManager(tmpDir);
    const result = sm.load();

    assert.equal(result.source, 'plaintext');
    assert.equal(result.keyCount, 1);
    assert.equal(process.env.MY_TEST_SECRET_A, 'hello123');

    delete process.env.MY_TEST_SECRET_A;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('auto-migrates .env to .env.enc when key is set', () => {
    process.env.SOUL_SECRET_KEY = 'migrate-test-key';
    writeFileSync(join(tmpDir, '.env'), 'MY_TEST_SECRET_B=migrated\n', 'utf-8');
    const sm = new SecretManager(tmpDir);
    const result = sm.load();

    assert.equal(result.source, 'migrated');
    assert.ok(existsSync(join(tmpDir, '.env.enc')));
    assert.ok(!existsSync(join(tmpDir, '.env')));
    assert.equal(process.env.MY_TEST_SECRET_B, 'migrated');

    delete process.env.MY_TEST_SECRET_B;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads from .env.enc when both exist', () => {
    process.env.SOUL_SECRET_KEY = 'enc-test-key';
    // Write and encrypt
    writeFileSync(join(tmpDir, '.env'), 'MY_TEST_SECRET_C=encrypted\n', 'utf-8');
    const sm = new SecretManager(tmpDir);
    sm.encryptEnv();

    // Re-create a different .env (should be ignored because .env.enc exists)
    writeFileSync(join(tmpDir, '.env'), 'MY_TEST_SECRET_C=plaintext\n', 'utf-8');

    const sm2 = new SecretManager(tmpDir);
    sm2._derivedKey = null; // Reset cached key
    const result = sm2.load();

    assert.equal(result.source, 'encrypted');
    assert.equal(process.env.MY_TEST_SECRET_C, 'encrypted');

    delete process.env.MY_TEST_SECRET_C;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns none when no env files exist', () => {
    const sm = new SecretManager(tmpDir);
    const result = sm.load();
    assert.equal(result.source, 'none');
    assert.equal(result.keyCount, 0);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not overwrite existing env vars', () => {
    process.env.MY_TEST_SECRET_D = 'original';
    writeFileSync(join(tmpDir, '.env'), 'MY_TEST_SECRET_D=from_file\n', 'utf-8');
    const sm = new SecretManager(tmpDir);
    sm.load();

    assert.equal(process.env.MY_TEST_SECRET_D, 'original');

    delete process.env.MY_TEST_SECRET_D;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles quoted values', () => {
    writeFileSync(join(tmpDir, '.env'), 'MY_TEST_SECRET_E="hello world"\n', 'utf-8');
    const sm = new SecretManager(tmpDir);
    sm.load();

    assert.equal(process.env.MY_TEST_SECRET_E, 'hello world');

    delete process.env.MY_TEST_SECRET_E;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips comments and empty lines', () => {
    writeFileSync(join(tmpDir, '.env'), '# comment\n\nMY_TEST_SECRET_F=yes\n', 'utf-8');
    const sm = new SecretManager(tmpDir);
    const result = sm.load();

    assert.equal(result.keyCount, 1);
    assert.equal(process.env.MY_TEST_SECRET_F, 'yes');

    delete process.env.MY_TEST_SECRET_F;
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Key Rotation ─────────────────────────────────────────────

describe('SecretManager — rotate key', () => {
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-secret-rotate-'));
    process.env.SOUL_SECRET_KEY = 'old-key';
  });

  after(() => {
    delete process.env.SOUL_SECRET_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('re-encrypts with new key', () => {
    // Encrypt with old key
    writeFileSync(join(tmpDir, '.env'), 'MY_ROTATE_SECRET=rotate_me\n', 'utf-8');
    const sm = new SecretManager(tmpDir);
    sm.encryptEnv();

    // Rotate to new key
    const ok = sm.rotateKey('new-key-2026');
    assert.equal(ok, true);

    // Can't decrypt with old key anymore
    // Create new manager with new key
    delete process.env.SOUL_SECRET_KEY;
    process.env.SOUL_SECRET_KEY = 'new-key-2026';
    const sm2 = new SecretManager(tmpDir);
    const decrypted = sm2.decryptEnv();
    assert.equal(decrypted, true);

    const content = readFileSync(join(tmpDir, '.env'), 'utf-8');
    assert.ok(content.includes('rotate_me'));
  });
});

// ── Status ───────────────────────────────────────────────────

describe('SecretManager — getStatus', () => {
  it('reports correct status', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-secret-status-'));
    process.env.SOUL_SECRET_KEY = 'status-key';

    writeFileSync(join(tmpDir, '.env'), 'X=1\n', 'utf-8');
    const sm = new SecretManager(tmpDir);
    const status = sm.getStatus();

    assert.equal(status.hasEnv, true);
    assert.equal(status.hasEncrypted, false);
    assert.equal(status.hasKey, true);

    delete process.env.SOUL_SECRET_KEY;
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── Error cases ──────────────────────────────────────────────

describe('SecretManager — error handling', () => {
  it('fails to encrypt without key', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-secret-err-'));
    delete process.env.SOUL_SECRET_KEY;

    writeFileSync(join(tmpDir, '.env'), 'X=1\n', 'utf-8');
    const sm = new SecretManager(tmpDir);
    const ok = sm.encryptEnv();
    assert.equal(ok, false);

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails to decrypt without key', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'soul-secret-err2-'));
    delete process.env.SOUL_SECRET_KEY;

    const sm = new SecretManager(tmpDir);
    const ok = sm.decryptEnv();
    assert.equal(ok, false);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});
