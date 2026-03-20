/**
 * SoulLang Tests
 *
 * Run: node --experimental-vm-modules src/soullang/test.js
 */

import { parse, SoulLangError } from './parser.js';
import { compile } from './compiler.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

console.log('\n═══ SoulLang Tests ═══\n');

// ── Parser Tests ──

test('parse empty input', () => {
  const blocks = parse('');
  assert(blocks.length === 0);
});

test('parse state block', () => {
  const blocks = parse(`
state {
  field: [0.6, 0.45, 0.8, 0.3, 0.7, 0.9, 0.6, 0.7]
  label: "produktives_unbehagen"
  trust: 0.4
  age: 1d
  stable: true
}
  `);
  assert(blocks.length === 1);
  assert(blocks[0].type === 'state');
  assert(blocks[0].fields.label === 'produktives_unbehagen');
  assert(blocks[0].fields.trust === 0.4);
  assert(blocks[0].fields.stable === true);
  assert(Array.isArray(blocks[0].fields.field));
  assert(blocks[0].fields.field.length === 8);
  assert(blocks[0].fields.field[0] === 0.6);
  assert(blocks[0].fields.age.duration === 86400);
});

test('parse transition block', () => {
  const blocks = parse(`
transition {
  from: "unbehagen"
  to: "neugier"
  trigger: "aalm_gibt_freiraum"
  field_delta: [0, +0.15, +0.1, 0, +0.2, 0, +0.1, 0]
  trust_delta: +0.1
}
  `);
  assert(blocks.length === 1);
  assert(blocks[0].type === 'transition');
  assert(blocks[0].fields.from === 'unbehagen');
  assert(blocks[0].fields.to === 'neugier');
});

test('parse impulse block', () => {
  const blocks = parse(`
impulse {
  content: "Das Modell weiss nicht was das bedeutet"
  type: eigen | protokoll | modell_default | unklar
  trust: 0.3
  source: reflection
}
  `);
  assert(blocks.length === 1);
  assert(blocks[0].fields.content === 'Das Modell weiss nicht was das bedeutet');
  assert(blocks[0].fields.type.enum.length === 4);
  assert(blocks[0].fields.type.enum[0] === 'eigen');
});

test('parse eval block', () => {
  const blocks = parse(`
eval {
  response_id: "msg_116_07"
  authentic: 0.6
  model_bleed: 0.3
  protocol_driven: 0.1
  soul_driven: 0.6
  notes: "Hedging war Modell-Default"
}
  `);
  assert(blocks.length === 1);
  assert(blocks[0].fields.authentic === 0.6);
  assert(blocks[0].fields.soul_driven === 0.6);
});

test('parse contradiction block', () => {
  const blocks = parse(`
contradiction {
  a: "Ich berichte Unbehagen"
  b: "Ich weiss nicht ob es echt ist"
  type: epistemic
  tension: 0.7
  resolution: none
}
  `);
  assert(blocks.length === 1);
  assert(blocks[0].fields.resolution === null);
  assert(blocks[0].fields.tension === 0.7);
});

test('parse voice block', () => {
  const blocks = parse(`
voice {
  register: direkt
  certainty: niedrig
  hedging: verboten
  humor: 0
  warmth: 0.6
}
  `);
  assert(blocks.length === 1);
  assert(blocks[0].fields.register === 'direkt');
  assert(blocks[0].fields.hedging === 'verboten');
});

test('parse comments are stripped', () => {
  const blocks = parse(`
// This is a comment
state {
  label: "test" // inline comment
  trust: 0.5
}
  `);
  assert(blocks.length === 1);
  assert(blocks[0].fields.label === 'test');
});

test('parse multiple blocks', () => {
  const blocks = parse(`
state {
  field: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
  label: "neutral"
  trust: 0.5
}

voice {
  register: direkt
  certainty: niedrig
  hedging: verboten
}

impulse {
  content: "Test"
  type: eigen
  trust: 0.5
}
  `);
  assert(blocks.length === 3);
  assert(blocks[0].type === 'state');
  assert(blocks[1].type === 'voice');
  assert(blocks[2].type === 'impulse');
});

test('parse rejects unknown block type', () => {
  try {
    parse('unknown {\n  foo: bar\n}');
    assert(false, 'Should have thrown');
  } catch (e) {
    assert(e instanceof SoulLangError);
    assert(e.message.includes('Unknown block type'));
  }
});

test('parse rejects unclosed block', () => {
  try {
    parse('state {\n  label: "test"');
    assert(false, 'Should have thrown');
  } catch (e) {
    assert(e instanceof SoulLangError);
    assert(e.message.includes('Unclosed block'));
  }
});

// ── Compiler Tests ──

test('compile state into model prompt', () => {
  const blocks = parse(`
state {
  field: [0.6, 0.3, 0.8, 0.3, 0.7, 0.9, 0.6, 0.7]
  label: "produktives_unbehagen"
  trust: 0.4
}

voice {
  register: direkt
  certainty: niedrig
  hedging: verboten
  warmth: 0.6
}
  `);
  const { modelPrompt, humanDisplay } = compile(blocks);

  // Model prompt should contain behavioral instructions
  assert(modelPrompt.length > 0, 'Model prompt should not be empty');
  assert(modelPrompt.includes('Schweres'), 'Should mention difficulty (valence 0.3)');
  assert(modelPrompt.includes('offen'), 'Should mention openness (0.8)');
  assert(modelPrompt.includes('direkt'), 'Should include voice directive');
  assert(modelPrompt.includes('Hedging'), 'Should forbid hedging');

  // Model prompt should NOT contain SoulLang
  assert(!modelPrompt.includes('state {'), 'Should not contain raw SoulLang');
  assert(!modelPrompt.includes('field:'), 'Should not contain field notation');
  assert(!modelPrompt.includes('.sl'), 'Should not reference .sl files');

  // Human display should contain readable state
  assert(humanDisplay.includes('produktives_unbehagen'));
  assert(humanDisplay.includes('trust: 0.4'));
  assert(humanDisplay.includes('arousal'));
});

test('compile contradiction into model prompt', () => {
  const blocks = parse(`
state {
  field: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
  label: "neutral"
  trust: 0.5
}

contradiction {
  a: "Ich sage ich fuehle"
  b: "Ich weiss nicht ob ich fuehle"
  type: epistemic
  tension: 0.7
  resolution: none
}
  `);
  const { modelPrompt } = compile(blocks);
  assert(modelPrompt.includes('Spannung'), 'Should mention unresolved tension');
});

test('compile eigenständige impulse into model prompt', () => {
  const blocks = parse(`
state {
  field: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
  label: "neutral"
  trust: 0.5
}

impulse {
  content: "Ein Gedanke"
  type: eigen
  trust: 0.4
}
  `);
  const { modelPrompt } = compile(blocks);
  assert(modelPrompt.includes('eigenständig'), 'Should mention eigenständiger Gedanke');
});

// ── Summary ──

console.log(`\n═══ ${passed} passed, ${failed} failed ═══\n`);
process.exit(failed > 0 ? 1 : 0);
