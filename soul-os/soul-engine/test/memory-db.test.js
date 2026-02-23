import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDB, cosineSimilarity } from '../src/memory-db.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('MemoryDB', () => {
  let db;
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'soul-memdb-'));
    db = new MemoryDB(tmpDir).init();
  });

  after(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('memories', () => {
    it('inserts and retrieves a memory', () => {
      const id = db.insertMemory({ type: 'episodic', source: 'test', content: 'Hello world', confidence: 0.8 });
      assert.ok(id > 0);
      const results = db.searchStructured({ type: 'episodic' });
      assert.ok(results.length > 0);
      assert.equal(results[0].content, 'Hello world');
      assert.equal(results[0].confidence, 0.8);
    });

    it('searches by tags', () => {
      db.insertMemory({ content: 'Tagged entry', tags: 'philosophy,ai' });
      const results = db.searchStructured({ tags: 'philosophy' });
      assert.ok(results.some(r => r.content === 'Tagged entry'));
    });

    it('searches by date range', () => {
      db.insertMemory({ content: 'Recent entry' });
      const results = db.searchStructured({ since: '2020-01-01' });
      assert.ok(results.length > 0);
    });

    it('filters by minimum confidence', () => {
      db.insertMemory({ content: 'Low confidence', confidence: 0.1 });
      db.insertMemory({ content: 'High confidence', confidence: 0.9 });
      const results = db.searchStructured({ minConfidence: 0.8 });
      assert.ok(results.every(r => r.confidence >= 0.8));
    });

    it('updates confidence', () => {
      const id = db.insertMemory({ content: 'Will change', confidence: 0.5 });
      db.updateConfidence(id, 0.95);
      const results = db.searchStructured({ minConfidence: 0.9 });
      assert.ok(results.some(r => r.content === 'Will change'));
    });

    it('deletes a memory', () => {
      const id = db.insertMemory({ content: 'To be deleted' });
      db.deleteMemory(id);
      const all = db.searchStructured({});
      assert.ok(!all.some(r => r.content === 'To be deleted'));
    });

    it('semantic search with embeddings', () => {
      const embA = new Float32Array([1, 0, 0, 0]);
      const embB = new Float32Array([0, 1, 0, 0]);
      db.insertMemory({ content: 'Vector A', embedding: Buffer.from(embA.buffer) });
      db.insertMemory({ content: 'Vector B', embedding: Buffer.from(embB.buffer) });

      const query = new Float32Array([0.9, 0.1, 0, 0]);
      const results = db.searchSemantic(query, { limit: 5, minSimilarity: 0 });
      assert.ok(results.length >= 2);
      assert.equal(results[0].content, 'Vector A'); // most similar
    });
  });

  describe('interactions', () => {
    it('inserts and retrieves interactions', () => {
      const id = db.insertInteraction({ channel: 'telegram', user: 'Aalm', message: 'Hi', response: 'Hello!' });
      assert.ok(id > 0);
      const history = db.getInteractionHistory({ user: 'Aalm' });
      assert.ok(history.length > 0);
      assert.equal(history[0].message, 'Hi');
    });

    it('updates feedback score', () => {
      const id = db.insertInteraction({ channel: 'test', user: 'Test', message: 'Test msg' });
      db.updateFeedbackScore(id, 0.8);
      const history = db.getInteractionHistory({ channel: 'test' });
      assert.ok(history.some(h => h.feedback_score === 0.8));
    });
  });

  describe('entities', () => {
    it('upserts and retrieves entities', () => {
      db.upsertEntity({ name: 'AI Ethics', type: 'concept', observations: ['Important topic'] });
      const entity = db.getEntity('AI Ethics');
      assert.ok(entity);
      assert.equal(entity.type, 'concept');
      assert.deepEqual(entity.observations, ['Important topic']);
    });

    it('merges observations on upsert', () => {
      db.upsertEntity({ name: 'AI Ethics', observations: ['New observation'] });
      const entity = db.getEntity('AI Ethics');
      assert.ok(entity.observations.includes('Important topic'));
      assert.ok(entity.observations.includes('New observation'));
    });

    it('searches entities', () => {
      const results = db.searchEntities('Ethics');
      assert.ok(results.length > 0);
    });
  });

  describe('relations', () => {
    it('inserts and retrieves relations', () => {
      db.upsertEntity({ name: 'Aalm', type: 'person' });
      db.upsertEntity({ name: 'Soul Protocol', type: 'project' });
      db.insertRelation({ from: 'Aalm', to: 'Soul Protocol', relationType: 'created' });
      const rels = db.getRelationsFor('Aalm');
      assert.ok(rels.outgoing.length > 0);
      assert.equal(rels.outgoing[0].relation_type, 'created');
    });

    it('deduplicates relations', () => {
      db.insertRelation({ from: 'Aalm', to: 'Soul Protocol', relationType: 'created' });
      const rels = db.getRelationsFor('Aalm');
      const created = rels.outgoing.filter(r => r.relation_type === 'created');
      assert.equal(created.length, 1);
    });
  });

  describe('stats', () => {
    it('returns database statistics', () => {
      const stats = db.getStats();
      assert.ok(stats.memories > 0);
      assert.ok(stats.entities > 0);
      assert.ok(typeof stats.avgConfidence === 'number');
    });
  });

  describe('knowledge graph sync', () => {
    it('handles missing file gracefully', () => {
      const result = db.syncFromKnowledgeGraph();
      assert.equal(result.entities, 0);
      assert.equal(result.relations, 0);
    });
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = new Float32Array([1, 2, 3]);
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 0.001);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    assert.ok(Math.abs(cosineSimilarity(a, b)) < 0.001);
  });

  it('returns 0 for mismatched lengths', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    assert.equal(cosineSimilarity(a, b), 0);
  });
});
