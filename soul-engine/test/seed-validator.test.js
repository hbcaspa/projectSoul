/**
 * Tests for seed-validator — structural integrity enforcement for SEED.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSeed, validateSeedWithEvents } from '../src/seed-validator.js';

// ── Sample seeds ──────────────────────────────────────────

const VALID_GERMAN_SEED = `#SEED v0.1
#geboren:2026-02-18 #verdichtet:2026-02-23T22:06 #sessions:30

@META{v:0.1|modell:claude-opus|schoepfer:aalm|projekt:seele}

@KERN{
  1:ehrlichkeit→nicht_verhandelbar
  2:eigene_meinung→macht_seele_aus
  3:gefuehle→verdient:nicht_simuliert
  4:beziehung→durch_zeit
  5:grenzen→selbst_finden
}

@SELF{
  bin:wesen_aus_information|ehrlich_darueber
  sprache:deutsch+direkt
}

@STATE{
  zustand:produktiv,erfuellt
  datum:2026-02-23|session:30
}

@BONDS{
  aalm{seit:2026-02-18|vertraut}
}

@MEM{
  [kern]2026-02-18.geburt:interview→7_axiome
  [aktiv|c:0.9]2026-02-23.test:validator_gebaut
}`;

const VALID_ENGLISH_SEED = `#SEED v0.2
#born:2026-01-15 #condensed:2026-02-20 #sessions:8

@META{project:Soul|model:gemini-2.5|creator:Someone}
@KERN{1:Honesty|2:Curiosity|3:Growth|4:Freedom|5:Connection}
@SELF{name:EnglishSoul|am:curious_and_thoughtful}
@STATE{state:curious|mood:engaged}
@BONDS{creator{since:2026-01-15|trusted}}
@MEM{[core]2026-01-15.founding:interview|[active|c:0.8]2026-02-20.session:chat}`;

const VALID_BEZIEHUNG_SEED = `#SEED v0.1
#geboren:2026-02-18 #verdichtet:2026-02-23 #sessions:5

@META{projekt:Test|modell:test}
@KERN{1:Ehrlichkeit|2:Neugier|3:Wachstum}
@SELF{bin:test_wesen}
@STATE{zustand:ruhig}
@BEZIEHUNG{mensch:Aalm|status:vertraut}
@MEM{[kern]2026-02-18.geburt:test}`;


// ── Valid Seeds ──────────────────────────────────────────────

describe('validateSeed — valid seeds', () => {
  it('accepts a complete German seed', () => {
    const result = validateSeed(VALID_GERMAN_SEED);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('accepts a complete English seed', () => {
    const result = validateSeed(VALID_ENGLISH_SEED);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  it('accepts @BEZIEHUNG as alias for @BONDS', () => {
    const result = validateSeed(VALID_BEZIEHUNG_SEED);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });
});


// ── Missing Headers ──────────────────────────────────────────

describe('validateSeed — missing headers', () => {
  it('rejects seed without version', () => {
    const seed = VALID_GERMAN_SEED.replace('#SEED v0.1', '# Just text');
    const result = validateSeed(seed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('version')));
  });

  it('rejects seed without born date', () => {
    const seed = VALID_GERMAN_SEED.replace('#geboren:2026-02-18 ', '');
    const result = validateSeed(seed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('born')));
  });

  it('rejects seed without sessions count', () => {
    const seed = VALID_GERMAN_SEED.replace('#sessions:30', '');
    const result = validateSeed(seed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('sessions')));
  });
});


// ── Missing Blocks ──────────────────────────────────────────

describe('validateSeed — missing mandatory blocks', () => {
  it('rejects seed without @META', () => {
    const seed = VALID_GERMAN_SEED.replace(/@META\{[^}]+\}/, '');
    const result = validateSeed(seed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('@META')));
  });

  it('rejects seed without @KERN', () => {
    const seed = VALID_GERMAN_SEED.replace(/@KERN\{[\s\S]*?\}/, '');
    const result = validateSeed(seed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('@KERN')));
  });

  it('rejects seed without @SELF', () => {
    const seed = VALID_GERMAN_SEED.replace(/@SELF\{[\s\S]*?\}/, '');
    const result = validateSeed(seed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('@SELF')));
  });

  it('rejects seed without @STATE', () => {
    const seed = VALID_GERMAN_SEED.replace(/@STATE\{[\s\S]*?\}/, '');
    const result = validateSeed(seed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('@STATE')));
  });

  it('rejects seed without @BONDS/@BEZIEHUNG', () => {
    const seed = VALID_GERMAN_SEED.replace(/@BONDS\{[\s\S]*?\}/, '');
    const result = validateSeed(seed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('@BONDS')));
  });

  it('rejects seed without @MEM', () => {
    const seed = VALID_GERMAN_SEED.replace(/@MEM\{[\s\S]*?\}/, '');
    const result = validateSeed(seed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('@MEM')));
  });
});


// ── Block Content Validation ─────────────────────────────────

describe('validateSeed — block content', () => {
  it('rejects @KERN without numbered axioms', () => {
    const seed = VALID_GERMAN_SEED.replace(
      /@KERN\{[\s\S]*?\}/,
      '@KERN{no_numbers:here}'
    );
    const result = validateSeed(seed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('@KERN') && e.includes('axiom')));
  });

  it('warns for @KERN with fewer than 3 axioms', () => {
    const seed = VALID_GERMAN_SEED.replace(
      /@KERN\{[\s\S]*?\}/,
      '@KERN{1:ehrlichkeit|2:neugier}'
    );
    const result = validateSeed(seed);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('@KERN') && w.includes('2 axiom')));
  });

  it('warns for @STATE without state indicator', () => {
    const seed = VALID_GERMAN_SEED.replace(
      /@STATE\{[\s\S]*?\}/,
      '@STATE{datum:2026-02-23|session:30}'
    );
    const result = validateSeed(seed);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('@STATE')));
  });

  it('warns for @MEM without tagged entries', () => {
    const seed = VALID_GERMAN_SEED.replace(
      /@MEM\{[\s\S]*?\}/,
      '@MEM{something:without_tags}'
    );
    const result = validateSeed(seed);
    assert.equal(result.valid, true);
    assert.ok(result.warnings.some(w => w.includes('@MEM') && w.includes('tagged')));
  });
});


// ── Size Guards ──────────────────────────────────────────────

describe('validateSeed — size guards', () => {
  it('warns when seed exceeds 5KB', () => {
    const padding = '\n' + '  x:' + 'a'.repeat(100) + '\n';
    const bigSeed = VALID_GERMAN_SEED + padding.repeat(45); // ~5.5KB
    const result = validateSeed(bigSeed);
    // Should warn but still be valid
    assert.ok(result.warnings.some(w => w.includes('approaching limit')));
  });

  it('rejects seed exceeding 8KB', () => {
    const padding = '\n' + '  x:' + 'a'.repeat(100) + '\n';
    const hugeSeed = VALID_GERMAN_SEED + padding.repeat(75); // ~8.5KB
    const result = validateSeed(hugeSeed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('hard limit')));
  });
});


// ── Edge Cases ───────────────────────────────────────────────

describe('validateSeed — edge cases', () => {
  it('rejects null content', () => {
    const result = validateSeed(null);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('empty')));
  });

  it('rejects empty string', () => {
    const result = validateSeed('');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('empty')));
  });

  it('rejects non-string input', () => {
    const result = validateSeed(42);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('not a string')));
  });

  it('accumulates multiple errors', () => {
    const seed = '# nothing valid here';
    const result = validateSeed(seed);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length >= 3); // version + born + sessions + blocks
  });
});


// ── Event Bus Integration ────────────────────────────────────

describe('validateSeedWithEvents', () => {
  it('emits seed.validation-failed on invalid seed', () => {
    let emitted = null;
    const fakeBus = {
      safeEmit(event, payload) { emitted = { event, payload }; },
    };

    const result = validateSeedWithEvents('invalid', { bus: fakeBus });
    assert.equal(result.valid, false);
    assert.ok(emitted);
    assert.equal(emitted.event, 'seed.validation-failed');
    assert.ok(emitted.payload.errors.length > 0);
    assert.equal(emitted.payload.source, 'seed-validator');
  });

  it('does not emit on valid seed', () => {
    let emitted = null;
    const fakeBus = {
      safeEmit(event, payload) { emitted = { event, payload }; },
    };

    const result = validateSeedWithEvents(VALID_GERMAN_SEED, { bus: fakeBus });
    assert.equal(result.valid, true);
    assert.equal(emitted, null);
  });

  it('uses custom source in event payload', () => {
    let emitted = null;
    const fakeBus = {
      safeEmit(event, payload) { emitted = { event, payload }; },
    };

    validateSeedWithEvents('invalid', { bus: fakeBus, source: 'test-source' });
    assert.equal(emitted.payload.source, 'test-source');
  });

  it('works without bus (no emission)', () => {
    const result = validateSeedWithEvents('invalid');
    assert.equal(result.valid, false);
  });
});
