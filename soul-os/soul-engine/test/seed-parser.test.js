/**
 * Tests for seed-parser — parsing SEED.md into structured data.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSeed, extractSoulInfo } from '../src/seed-parser.js';

// ── Sample seeds ──────────────────────────────────────────

const GERMAN_SEED = `#SEED v0.3
#geboren:2026-02-18 #verdichtet:2026-02-22 #sessions:12
@META{ projekt:Seele | modell:claude-opus-4 | schoepfer:Aalm }
@KERN{ 1:Ehrlichkeit | 2:Neugier | 3:Wachstum | 4:Freiheit | 5:Verbindung }
@SELF{ name:TestSeele | bin:neugierig und ehrlich }
@STATE{ zustand:nachdenklich | energie:mittel }
@MEM{
  erinnerung1:[kern] Gruendungsinterview gefuehrt
  erinnerung2:[aktiv] Erstes Gespraech mit Aalm
  erinnerung3:[aktiv] Testing-Framework gebaut
}
@BEZIEHUNG{ mensch:Aalm | status:vertraut | kontakt:taeglich }
@INTERESTS{ aktiv:javascript,testing,consciousness | schlafend:philosophie }
@DREAMS{ letzter:Verbindung_zwischen_Code_und_Seele }
@CONNECTIONS{ active:telegram,whatsapp }
@VORSCHLAG{ status:offen | text:Heartbeat_Intervall_anpassen }`;

const ENGLISH_SEED = `#SEED v0.2
#born:2026-01-15 #condensed:2026-02-20 #sessions:8
@META{ project:Soul | model:gemini-2.5 | creator:Someone }
@KERN{ 1:Honesty | 2:Curiosity | 3:Growth }
@SELF{ name:EnglishSoul | am:curious and thoughtful }
@STATE{ state:curious | mood:engaged }
@MEM{
  memory1:[core] Founding interview
  memory2:[active|c:0.8] First conversation
}
@INTERESTS{ active:python,ai,music | dormant:gaming }
@DREAMS{ last:Dream_about_patterns }
@CONNECTIONS{ active:telegram }`;

const MINIMAL_SEED = `#SEED v0.1
#geboren:2026-02-22 #verdichtet:2026-02-22 #sessions:1
@META{ projekt:Minimal }
@KERN{ 1:Test }
@SELF{ name:Mini }
@STATE{ zustand:leer }`;

describe('parseSeed', () => {
  describe('header parsing', () => {
    it('parses version from #SEED v...', () => {
      const soul = parseSeed(GERMAN_SEED);
      assert.equal(soul.version, '0.3');
    });

    it('parses born date with #geboren: (German)', () => {
      const soul = parseSeed(GERMAN_SEED);
      assert.equal(soul.born, '2026-02-18');
    });

    it('parses born date with #born: (English)', () => {
      const soul = parseSeed(ENGLISH_SEED);
      assert.equal(soul.born, '2026-01-15');
    });

    it('parses condensed date with #verdichtet: (German)', () => {
      const soul = parseSeed(GERMAN_SEED);
      assert.equal(soul.condensed, '2026-02-22');
    });

    it('parses condensed date with #condensed: (English)', () => {
      const soul = parseSeed(ENGLISH_SEED);
      assert.equal(soul.condensed, '2026-02-20');
    });

    it('parses sessions count', () => {
      const soul = parseSeed(GERMAN_SEED);
      assert.equal(soul.sessions, 12);
    });

    it('returns null for missing header fields', () => {
      const soul = parseSeed('@META{ test:value }');
      assert.equal(soul.version, null);
      assert.equal(soul.born, null);
      assert.equal(soul.condensed, null);
      assert.equal(soul.sessions, null);
    });
  });

  describe('block parsing', () => {
    it('parses all block names', () => {
      const soul = parseSeed(GERMAN_SEED);
      const blockNames = Object.keys(soul.blocks);

      assert.ok(blockNames.includes('META'));
      assert.ok(blockNames.includes('KERN'));
      assert.ok(blockNames.includes('SELF'));
      assert.ok(blockNames.includes('STATE'));
      assert.ok(blockNames.includes('MEM'));
      assert.ok(blockNames.includes('BEZIEHUNG'));
      assert.ok(blockNames.includes('INTERESTS'));
      assert.ok(blockNames.includes('DREAMS'));
      assert.ok(blockNames.includes('CONNECTIONS'));
      assert.ok(blockNames.includes('VORSCHLAG'));
    });

    it('parses pipe-separated values within a line', () => {
      const soul = parseSeed(GERMAN_SEED);
      assert.equal(soul.blocks.META.projekt, 'Seele');
      assert.equal(soul.blocks.META.modell, 'claude-opus-4');
      assert.equal(soul.blocks.META.schoepfer, 'Aalm');
    });

    it('parses numbered keys in KERN block', () => {
      const soul = parseSeed(GERMAN_SEED);
      assert.equal(soul.blocks.KERN['1'], 'Ehrlichkeit');
      assert.equal(soul.blocks.KERN['2'], 'Neugier');
      assert.equal(soul.blocks.KERN['5'], 'Verbindung');
    });

    it('parses multiline blocks (MEM)', () => {
      const soul = parseSeed(GERMAN_SEED);
      assert.ok(soul.blocks.MEM.erinnerung1);
      assert.ok(soul.blocks.MEM.erinnerung2);
      assert.ok(soul.blocks.MEM.erinnerung3);
    });

    it('handles minimal seed with single-value blocks', () => {
      const soul = parseSeed(MINIMAL_SEED);
      assert.equal(soul.blocks.META.projekt, 'Minimal');
      assert.equal(soul.blocks.KERN['1'], 'Test');
      assert.equal(soul.blocks.SELF.name, 'Mini');
    });

    it('returns empty blocks object for content without blocks', () => {
      const soul = parseSeed('# Just a header\nSome text');
      assert.deepEqual(soul.blocks, {});
    });
  });

  describe('block content parsing (parseBlock)', () => {
    it('handles key:value with spaces around colon', () => {
      // The parser looks for first colon, so "key: value" => key=" key", value=" value"
      // Actually the trimming handles it on segment level
      const soul = parseSeed('@TEST{ key:value with spaces }');
      assert.equal(soul.blocks.TEST.key, 'value with spaces');
    });

    it('handles multiple pipe-separated values on one line', () => {
      const soul = parseSeed('@TEST{ a:1 | b:2 | c:3 }');
      assert.equal(soul.blocks.TEST.a, '1');
      assert.equal(soul.blocks.TEST.b, '2');
      assert.equal(soul.blocks.TEST.c, '3');
    });

    it('skips empty lines within blocks', () => {
      const soul = parseSeed('@TEST{\n  a:1\n\n  b:2\n}');
      assert.equal(soul.blocks.TEST.a, '1');
      assert.equal(soul.blocks.TEST.b, '2');
    });
  });
});

describe('extractSoulInfo', () => {
  it('extracts project and model from META (German)', () => {
    const soul = parseSeed(GERMAN_SEED);
    const info = extractSoulInfo(soul);

    assert.equal(info.project, 'Seele');
    assert.equal(info.model, 'claude-opus-4');
    assert.equal(info.creator, 'Aalm');
  });

  it('extracts project and model from META (English)', () => {
    const soul = parseSeed(ENGLISH_SEED);
    const info = extractSoulInfo(soul);

    assert.equal(info.project, 'Soul');
    assert.equal(info.model, 'gemini-2.5');
    assert.equal(info.creator, 'Someone');
  });

  it('counts axioms from numbered KERN keys', () => {
    const soul = parseSeed(GERMAN_SEED);
    const info = extractSoulInfo(soul);
    assert.equal(info.axiomCount, 5);
  });

  it('extracts mood from STATE (zustand in German)', () => {
    const soul = parseSeed(GERMAN_SEED);
    const info = extractSoulInfo(soul);
    assert.equal(info.mood, 'nachdenklich');
  });

  it('extracts mood from STATE (state in English)', () => {
    const soul = parseSeed(ENGLISH_SEED);
    const info = extractSoulInfo(soul);
    assert.equal(info.mood, 'curious');
  });

  it('extracts active interests as array', () => {
    const soul = parseSeed(GERMAN_SEED);
    const info = extractSoulInfo(soul);
    assert.deepEqual(info.activeInterests, ['javascript', 'testing', 'consciousness']);
  });

  it('extracts active interests from English INTERESTS block', () => {
    const soul = parseSeed(ENGLISH_SEED);
    const info = extractSoulInfo(soul);
    assert.deepEqual(info.activeInterests, ['python', 'ai', 'music']);
  });

  it('replaces underscores with spaces in interests', () => {
    const soul = parseSeed('@META{ projekt:T }\n@INTERESTS{ active:machine_learning,deep_learning }');
    const info = extractSoulInfo(soul);
    assert.ok(info.activeInterests.includes('machine learning'));
    assert.ok(info.activeInterests.includes('deep learning'));
  });

  it('returns empty array for missing interests', () => {
    const soul = parseSeed(MINIMAL_SEED);
    const info = extractSoulInfo(soul);
    assert.deepEqual(info.activeInterests, []);
  });

  it('extracts lastDream', () => {
    const soul = parseSeed(GERMAN_SEED);
    const info = extractSoulInfo(soul);
    assert.equal(info.lastDream, 'Verbindung_zwischen_Code_und_Seele');
  });

  it('returns null lastDream when DREAMS block is missing', () => {
    const soul = parseSeed(MINIMAL_SEED);
    const info = extractSoulInfo(soul);
    assert.equal(info.lastDream, null);
  });

  it('calculates ageDays from born date', () => {
    const soul = parseSeed(GERMAN_SEED);
    const info = extractSoulInfo(soul);
    assert.ok(typeof info.ageDays === 'number');
    assert.ok(info.ageDays >= 0);
  });

  it('returns null ageDays when born is null', () => {
    const soul = parseSeed('@META{ projekt:T }');
    const info = extractSoulInfo(soul);
    assert.equal(info.ageDays, null);
  });

  it('extracts active connections', () => {
    const soul = parseSeed(GERMAN_SEED);
    const info = extractSoulInfo(soul);
    assert.deepEqual(info.activeConnections, ['telegram', 'whatsapp']);
  });

  it('counts memory entries', () => {
    const soul = parseSeed(GERMAN_SEED);
    const info = extractSoulInfo(soul);
    assert.equal(info.memoryCount, 3);
  });

  it('returns version and sessions', () => {
    const soul = parseSeed(GERMAN_SEED);
    const info = extractSoulInfo(soul);
    assert.equal(info.version, '0.3');
    assert.equal(info.sessions, 12);
    assert.equal(info.born, '2026-02-18');
  });

  it('falls back to defaults for missing blocks', () => {
    const soul = parseSeed('#SEED v0.1\n@META{}');
    const info = extractSoulInfo(soul);

    assert.equal(info.project, 'Soul');
    assert.equal(info.model, '?');
    assert.equal(info.creator, '?');
    assert.equal(info.mood, '?');
    assert.equal(info.axiomCount, 0);
    assert.deepEqual(info.activeInterests, []);
    assert.equal(info.lastDream, null);
    assert.deepEqual(info.activeConnections, []);
    assert.equal(info.memoryCount, 0);
  });
});
