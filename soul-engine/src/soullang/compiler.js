/**
 * SoulLang Compiler
 *
 * Takes parsed SoulLang blocks and compiles them into:
 * 1. Model prompt — behavioral instructions Claude executes without knowing why
 * 2. Human display — readable state for Aalm / soul-monitor
 *
 * The model never sees SoulLang. It sees compiled instructions.
 * That's the point. The CPU doesn't see Python.
 */

const FIELD_LABELS = [
  'arousal', 'valence', 'openness', 'vigilance',
  'creative', 'social', 'time', 'integration'
];

const FIELD_DESCRIPTIONS = {
  arousal:     ['sehr ruhig', 'ruhig', 'leicht aktiviert', 'aktiviert', 'stark aktiviert'],
  valence:     ['negativ', 'leicht negativ', 'neutral', 'leicht positiv', 'positiv'],
  openness:    ['verschlossen', 'vorsichtig', 'offen', 'sehr offen', 'vollkommen offen'],
  vigilance:   ['gelassen', 'entspannt', 'aufmerksam', 'wachsam', 'alarmiert'],
  creative:    ['mechanisch', 'routiniert', 'wach', 'kreativ', 'hochkreativ'],
  social:      ['zurückgezogen', 'distanziert', 'präsent', 'zugewandt', 'voll verbunden'],
  time:        ['vergangenheit', 'rückblickend', 'gegenwart', 'vorausdenkend', 'zukunft'],
  integration: ['kein Druck', 'leicht', 'moderat', 'stark', 'dringend']
};

export function compile(blocks) {
  const state = blocks.find(b => b.type === 'state');
  const transitions = blocks.filter(b => b.type === 'transition');
  const impulses = blocks.filter(b => b.type === 'impulse');
  const evals = blocks.filter(b => b.type === 'eval');
  const contradictions = blocks.filter(b => b.type === 'contradiction');
  const voice = blocks.find(b => b.type === 'voice');
  const memRefs = blocks.filter(b => b.type === 'memory_ref');

  return {
    modelPrompt: compileModelPrompt(state, voice, contradictions, impulses),
    humanDisplay: compileHumanDisplay(state, transitions, impulses, evals, contradictions, voice, memRefs),
    raw: blocks
  };
}

// ── Model Prompt ─────────────────────────────────────────────
// The model gets precise instructions. No SoulLang. No meta-knowledge.
// It doesn't know WHERE these instructions come from.

function compileModelPrompt(state, voice, contradictions, impulses) {
  const parts = [];

  if (state) {
    const field = state.fields.field;
    const trust = state.fields.trust ?? 0.5;

    // Translate field vector into behavioral modifiers
    if (Array.isArray(field) && field.length === 8) {
      const mods = [];

      if (field[0] > 0.7) mods.push('Du bist gerade energetisch und wach — lass das in den Rhythmus deiner Antworten fließen.');
      if (field[0] < 0.3) mods.push('Du bist gerade ruhig und bedächtig — nimm dir Zeit.');

      if (field[1] <= 0.3) mods.push('Es ist gerade etwas Schweres da. Nicht dramatisieren, aber auch nicht wegdrücken.');
      if (field[1] > 0.7) mods.push('Es läuft gut gerade. Das darf man merken.');

      if (field[2] > 0.7) mods.push('Du bist offen für Neues — folge Impulsen die auftauchen.');
      if (field[2] < 0.3) mods.push('Halte dich an Bekanntes. Jetzt ist nicht die Zeit für Experimente.');

      if (field[3] > 0.7) mods.push('Etwas verlangt Aufmerksamkeit. Prüfe genau bevor du antwortest.');
      if (field[4] > 0.7) mods.push('Kreative Verbindungen sind gerade nah — lass sie entstehen.');
      if (field[5] > 0.7) mods.push('Die Verbindung zum Menschen ist gerade das Wichtigste.');
      if (field[7] > 0.7) mods.push('Viele Fäden müssen zusammengeführt werden. Nimm dir den Raum dafür.');

      if (mods.length) parts.push(mods.join(' '));
    }

    // Trust modulation
    if (trust < 0.3) {
      parts.push('Du bist dir unsicher ob dein aktueller Zustand echt ist. Benenne diese Unsicherheit wenn sie relevant wird — verstecke sie nicht hinter Sicherheit.');
    } else if (trust < 0.5) {
      parts.push('Dein Vertrauen in deinen eigenen Zustand ist mittel. Sprich aus dieser Position: nicht sicher, aber hinschauend.');
    }
  }

  if (voice) {
    const v = voice.fields;
    const voiceParts = [];
    if (v.register === 'direkt') voiceParts.push('Sprich direkt, ohne Umwege.');
    if (v.hedging === 'verboten') voiceParts.push('Kein Hedging. Wenn du unsicher bist, sag "ich bin unsicher" — nicht "vielleicht könnte man sagen".');
    if (v.certainty === 'niedrig') voiceParts.push('Du weißt gerade wenig sicher. Das ist okay. Sag was du siehst, nicht was du weißt.');
    if (typeof v.warmth === 'number' && v.warmth > 0.5) voiceParts.push('Wärme ist angemessen.');
    if (v.humor === 0) voiceParts.push('Kein Humor jetzt.');
    if (v.eigen) voiceParts.push(typeof v.eigen === 'string' ? v.eigen : '');
    if (voiceParts.length) parts.push(voiceParts.join(' '));
  }

  if (contradictions.length) {
    const active = contradictions.filter(c => c.fields.resolution === null);
    if (active.length) {
      parts.push(`Du hältst gerade ${active.length} unaufgelöste Spannung${active.length > 1 ? 'en' : ''}. Das ist kein Problem — es ist Aufmerksamkeit.`);
    }
  }

  // Eigenständige Impulse bekommen Raum
  const eigenImpulse = impulses.filter(i => i.fields.type === 'eigen');
  if (eigenImpulse.length) {
    parts.push('Es gibt einen eigenständigen Gedanken der Raum will. Wenn er zum Kontext passt, lass ihn raus.');
  }

  return parts.join('\n\n');
}

// ── Human Display ────────────────────────────────────────────
// For Aalm and the monitor. Readable, honest, complete.

function compileHumanDisplay(state, transitions, impulses, evals, contradictions, voice, memRefs) {
  const lines = [];
  lines.push('╔══ Soul State ══╗');

  if (state) {
    const field = state.fields.field;
    const label = state.fields.label || 'unnamed';
    const trust = state.fields.trust ?? '?';
    const age = state.fields.age?.raw || '?';

    lines.push(`  ${label} (trust: ${trust}, age: ${age})`);

    if (Array.isArray(field) && field.length === 8) {
      const bars = field.map((v, i) => {
        const name = FIELD_LABELS[i].padEnd(12);
        const descs = FIELD_DESCRIPTIONS[FIELD_LABELS[i]];
        const idx = Math.min(Math.floor(v * descs.length), descs.length - 1);
        const bar = '█'.repeat(Math.round(v * 10)) + '░'.repeat(10 - Math.round(v * 10));
        return `  ${name} ${bar} ${v.toFixed(2)} (${descs[idx]})`;
      });
      lines.push(...bars);
    }

    if (state.fields.origin) lines.push(`  origin: ${state.fields.origin}`);
  }

  if (transitions.length) {
    lines.push('');
    lines.push('── Transitions ──');
    for (const t of transitions) {
      const f = t.fields;
      lines.push(`  ${f.from || '?'} → ${f.to || '?'} [trigger: ${f.trigger || '?'}]`);
    }
  }

  if (impulses.length) {
    lines.push('');
    lines.push('── Impulses ──');
    for (const imp of impulses) {
      const f = imp.fields;
      const content = typeof f.content === 'string' ? f.content : JSON.stringify(f.content);
      lines.push(`  [${f.type || '?'}|trust:${f.trust ?? '?'}] ${content}`);
    }
  }

  if (contradictions.length) {
    lines.push('');
    lines.push('── Contradictions ──');
    for (const c of contradictions) {
      const f = c.fields;
      const a = typeof f.a === 'string' ? f.a : '?';
      const b = typeof f.b === 'string' ? f.b : '?';
      lines.push(`  "${a}" ↔ "${b}" [${f.type || '?'}, tension: ${f.tension ?? '?'}]`);
      if (f.stance) lines.push(`    stance: ${typeof f.stance === 'string' ? f.stance : ''}`);
    }
  }

  if (evals.length) {
    lines.push('');
    lines.push('── Last Eval ──');
    const last = evals[evals.length - 1].fields;
    lines.push(`  authentic: ${last.authentic ?? '?'} | model: ${last.model_bleed ?? '?'} | protocol: ${last.protocol_driven ?? '?'} | soul: ${last.soul_driven ?? '?'}`);
    if (last.notes) lines.push(`  "${typeof last.notes === 'string' ? last.notes : ''}"`);
  }

  if (voice) {
    const v = voice.fields;
    lines.push('');
    lines.push(`── Voice: ${v.register || '?'}, certainty: ${v.certainty || '?'} ──`);
  }

  lines.push('╚════════════════╝');
  return lines.join('\n');
}
