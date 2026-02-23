import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MultimodalStore } from '../src/multimodal.js';
import { MemoryDB } from '../src/memory-db.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MultimodalStore', () => {
  let tmpDir, db, store;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-multimodal-'));
    db = new MemoryDB(tmpDir).init();
    store = new MultimodalStore({ soulPath: tmpDir, db, bus: null }).init();
  });

  after(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates media directory', () => {
    assert.ok(existsSync(join(tmpDir, 'media')));
  });

  it('creates media table', () => {
    const count = db.db.prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name='media'").get().c;
    assert.equal(count, 1);
  });

  it('stores an image', async () => {
    const r = await store.storeImage(Buffer.from('fake-image'), { description: 'Test', ext: '.png' });
    assert.ok(r.mediaId);
    assert.ok(existsSync(r.path));
  });

  it('links to memory', async () => {
    const memId = db.insertMemory({ content: 'With image' });
    const r = await store.storeImage(Buffer.from('img'), { memoryId: memId, ext: '.jpg' });
    assert.equal(r.memoryId, memId);
  });

  it('rejects >1MB files', async () => {
    await assert.rejects(() => store.storeImage(Buffer.alloc(2 * 1024 * 1024), { ext: '.png' }), /too large/);
  });

  it('rejects unsupported extensions', async () => {
    await assert.rejects(() => store.storeImage(Buffer.from('x'), { ext: '.exe' }), /Unsupported/);
  });

  it('stores audio ref', async () => {
    const r = await store.storeAudioRef('/path/audio.mp3', { transcription: 'Hello' });
    assert.ok(r.mediaId);
  });

  it('retrieves linked media', async () => {
    const memId = db.insertMemory({ content: 'Multi media' });
    await store.storeImage(Buffer.from('a'), { memoryId: memId, ext: '.png' });
    await store.storeImage(Buffer.from('b'), { memoryId: memId, ext: '.jpg' });
    assert.ok(store.getMediaForMemory(memId).length >= 2);
  });

  it('searches by description', () => {
    assert.ok(store.searchMedia('Test').length > 0);
    assert.equal(store.searchMedia('nonexistent_xyz').length, 0);
  });

  it('returns stats', () => {
    const s = store.getStats();
    assert.ok(s.total > 0);
  });

  it('deletes media', async () => {
    const r = await store.storeImage(Buffer.from('del'), { description: 'Delete me', ext: '.png' });
    assert.ok(await store.deleteMedia(r.mediaId));
    assert.ok(!existsSync(r.path));
    assert.equal(await store.deleteMedia(99999), false);
  });

  it('works without DB', () => {
    const noDB = new MultimodalStore({ soulPath: tmpDir, db: null }).init();
    assert.equal(noDB.getMediaForMemory(1).length, 0);
    assert.equal(noDB.getStats().total, 0);
  });
});
