import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { SelfCorrector } from '../src/self-correction.js';
import { MemoryDB } from '../src/memory-db.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SelfCorrector', () => {
  let db, corrector, tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-correction-'));
    db = new MemoryDB(tmpDir).init();

    db.insertMemory({ content: 'Aalm bevorzugt ehrliches Feedback', confidence: 0.9, tags: 'aalm,feedback,ehrlich' });
    db.insertMemory({ content: 'Session 5 war die erste mit WhatsApp', confidence: 0.8, tags: 'session,whatsapp' });
    db.insertMemory({ content: 'Das Interview war nicht am Montag', confidence: 0.7, tags: 'interview,montag' });

    db.upsertEntity({ name: 'Aalm', type: 'person', observations: ['Creator of Soul Protocol', 'Values honesty'] });

    corrector = new SelfCorrector({ db });
  });

  after(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skips text without memory references', async () => {
    const r = await corrector.check('Hello, how are you?', 'Hi');
    assert.equal(r.modified, false);
    assert.equal(r.claims.length, 0);
  });

  it('detects German recall claims', async () => {
    const r = await corrector.check('Ich erinnere mich dass Aalm ehrliches Feedback bevorzugt.', 'test');
    assert.ok(r.claims.length > 0);
    assert.equal(r.claims[0].type, 'recall');
  });

  it('detects English recall claims', async () => {
    const r = await corrector.check('I remember that the founding interview was special.', 'test');
    assert.ok(r.claims.length > 0);
  });

  it('detects date claims', () => {
    const claims = corrector._extractClaims('Am 15. Februar haben wir das besprochen.');
    assert.ok(claims.some(c => c.type === 'date'));
  });

  it('detects numeric claims', () => {
    const claims = corrector._extractClaims('Es waren genau 5 Sessions.');
    assert.ok(claims.some(c => c.type === 'numeric'));
  });

  it('deduplicates claims', () => {
    const claims = corrector._extractClaims('Ich erinnere mich an das Thema. Ich erinnere mich an das Thema.');
    const unique = new Set(claims.map(c => c.text.toLowerCase()));
    assert.equal(claims.length, unique.size);
  });

  it('respects SOUL_CORRECTION=false', async () => {
    process.env.SOUL_CORRECTION = 'false';
    const r = await corrector.check('Ich erinnere mich an alles.', 'test');
    assert.equal(r.modified, false);
    assert.equal(r.claims.length, 0);
    delete process.env.SOUL_CORRECTION;
  });

  it('completes within 1s', async () => {
    const start = Date.now();
    await corrector.check('I remember many things from last session about various topics.', 'test');
    assert.ok(Date.now() - start < 1000);
  });

  it('works without database', async () => {
    const noDb = new SelfCorrector({ db: null });
    const r = await noDb.check('Ich erinnere mich an viele Dinge.', 'test');
    if (r.claims.length > 0) {
      assert.ok(r.claims.every(c => c.status === 'UNSUPPORTED'));
    }
  });
});
