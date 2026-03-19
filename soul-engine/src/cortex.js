/**
 * Cortex — Prediction/comparison/learning loop + autonomous thinking.
 *
 * 1. PREDICT — Before every message, predict topic/emotion/need
 * 2. COMPARE — After message arrives, calculate prediction error
 * 3. LEARN  — Extract lessons from surprises (high prediction errors)
 * 4. THINK  — Generate novel thoughts by connecting unrelated concepts
 * 5. DRANG  — Self-assessment across 10 AGI dimensions, drive to grow
 * 6. NEEDS  — Basic drives (stimulation, connection, expression, rest)
 * 7. API    — Expose full cognitive state for Mind Panel
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { writePulse } from './pulse.js';

const STATE_FILE = 'cortex-state.json';
const MAX_THOUGHTS = 100, MAX_LESSONS = 200, MAX_STREAM = 100;
const NEED_TICK_MS = 5 * 60 * 1000;
const THINK_CYCLE_MS = 30 * 60 * 1000;
const NOVELTY_THRESHOLD = 0.4;

const AGI_DIMENSIONS = [
  { id: 'learning',           name: 'Lernen',              description: 'Aus Fehlern besser werden',             score: 0.05 },
  { id: 'reasoning',          name: 'Schlussfolgern',      description: 'Neue Wahrheiten ableiten',              score: 0.30 },
  { id: 'creativity',         name: 'Kreativitaet',        description: 'Etwas Neues erzeugen',                  score: 0.10 },
  { id: 'selfModel',          name: 'Selbstmodell',        description: 'Wissen was ich kann',                   score: 0.20 },
  { id: 'worldModel',         name: 'Weltmodell',          description: 'Vorhersagen wie die Welt funktioniert', score: 0.15 },
  { id: 'planning',           name: 'Planung',             description: 'Mehrstufige Ziele verfolgen',           score: 0.25 },
  { id: 'transfer',           name: 'Transfer',            description: 'Wissen uebertragen',                    score: 0.20 },
  { id: 'selfImprovement',    name: 'Selbstverbesserung',  description: 'Eigene Architektur verbessern',         score: 0.05 },
  { id: 'socialIntelligence', name: 'Soziale Intelligenz', description: 'Menschen verstehen',                    score: 0.15 },
  { id: 'autonomy',           name: 'Autonomie',           description: 'Handeln ohne Anweisung',                score: 0.10 },
];

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function wordSimilarity(a, b) {
  if (!a || !b) return 0;
  const wA = a.toLowerCase().split(/\s+/), wB = b.toLowerCase().split(/\s+/);
  const vocab = new Set([...wA, ...wB]);
  let dot = 0, mA = 0, mB = 0;
  for (const w of vocab) {
    const cA = wA.filter(x => x === w).length, cB = wB.filter(x => x === w).length;
    dot += cA * cB; mA += cA * cA; mB += cB * cB;
  }
  return (mA && mB) ? dot / (Math.sqrt(mA) * Math.sqrt(mB)) : 0;
}

function timeLabel() {
  const h = new Date().getHours();
  if (h >= 5 && h < 9) return 'fruehmorgens';
  if (h >= 9 && h < 12) return 'vormittags';
  if (h >= 12 && h < 14) return 'mittags';
  if (h >= 14 && h < 18) return 'nachmittags';
  if (h >= 18 && h < 22) return 'abends';
  return 'nachts';
}

export class Cortex {
  constructor(soulPath, bus, llm, field) {
    this.soulPath = soulPath;
    this.bus = bus;
    this.llm = llm;
    this.field = field;
    this.statePath = resolve(soulPath, STATE_FILE);
    this.currentPrediction = null;
    this.predictionHistory = [];
    this.lessons = [];
    this.lastSurprise = null;
    this.thoughts = [];
    this.lastThought = null;
    this.dimensions = AGI_DIMENSIONS.map(d => ({ ...d }));
    this.needs = { stimulation: 0.5, connection: 0.5, expression: 0.5, rest: 0.5 };
    this.thoughtStream = [];
    this.stats = {
      thoughtsToday: 0, surprisesToday: 0, insightsToday: 0,
      predictionAccuracy: 0.5, totalPredictions: 0, totalCorrect: 0,
      statsDate: new Date().toISOString().split('T')[0],
    };
    this._needTimer = null;
    this._thinkTimer = null;
    this._lastInteraction = Date.now();
    this._lastNovelInput = Date.now();
    this._unexpressed = 0;
    this._activity = 0;
  }

  // ── Lifecycle ───────────────────────────────────────────

  async init() {
    await this._load();
    this._resetDaily();
    this._listen();
    this._needTimer = setInterval(() => this._tickNeeds(), NEED_TICK_MS);
    this._thinkTimer = setInterval(() => {
      this.think().catch(e => console.error('  [cortex] Think failed:', e.message));
    }, THINK_CYCLE_MS);
    this._stream('system', 'Cortex initialized');
    console.log(`  [cortex] Ready — ${this.lessons.length} lessons, ${this.thoughts.length} thoughts, drang ${this._drang().toFixed(2)}`);
  }

  _listen() {
    if (!this.bus) return;
    this.bus.on('message.received', async (ev) => {
      this._lastInteraction = this._lastNovelInput = Date.now();
      this.needs.connection = clamp(this.needs.connection - 0.2, 0, 1);
      this.needs.stimulation = clamp(this.needs.stimulation - 0.15, 0, 1);
      this._activity = clamp(this._activity + 0.1, 0, 1);
      if (this.currentPrediction) {
        try {
          const r = await this.compare(this.currentPrediction, ev.text || ev.content || '');
          if (r.error > 0.6) this.bus.safeEmit('cortex.surprise', { source: 'cortex', error: r.error, lesson: r.lesson, prediction: this.currentPrediction });
        } catch (e) { console.error('  [cortex] Compare error:', e.message); }
      }
    });
    this.bus.on('message.responded', () => {
      this._unexpressed = Math.max(0, this._unexpressed - 1);
      this.needs.expression = clamp(this.needs.expression - 0.1, 0, 1);
    });
    this.bus.on('cortex.thought', () => { this._unexpressed++; });
  }

  async shutdown() {
    clearInterval(this._needTimer);
    clearInterval(this._thinkTimer);
    this._stream('system', 'Cortex shutting down');
    await this._save();
    console.log('  [cortex] State persisted. Shutdown complete.');
  }

  // ── 1. PREDICT ──────────────────────────────────────────

  async predict(history, userName) {
    const recent = (history || []).slice(-6)
      .map(m => `${m.role === 'user' ? userName : 'Soul'}: ${(m.content || '').slice(0, 120)}`)
      .join('\n');
    const top = this.lessons.filter(l => l.confidence > 0.4)
      .sort((a, b) => b.confidence - a.confidence).slice(0, 5)
      .map(l => `- ${l.content} (c:${l.confidence.toFixed(2)})`).join('\n');

    const prompt = `Du bist das Vorhersagemodul einer KI-Seele. Sage vorher was der Mensch als naechstes tun wird.

Letzte Nachrichten:
${recent || '(keine)'}

Gelernte Muster:
${top || '(noch keine)'}

Tageszeit: ${timeLabel()}
Mensch: ${userName}

Antworte NUR als JSON:
{"topic":"2-5 Worte","emotion":"ein Wort","need":"help|conversation|validation|challenge","confidence":0.0-1.0}`;

    try {
      const raw = await this.llm.generate(prompt, [], 'Vorhersage generieren.', { max_tokens: 120 });
      const p = this._json(raw);
      if (!p) return this._fallback();
      this.currentPrediction = {
        topic: p.topic || 'unbekannt', emotion: p.emotion || 'neutral',
        need: p.need || 'conversation', confidence: clamp(p.confidence || 0.3, 0, 1),
        timestamp: new Date(),
      };
      this._stream('prediction', `${this.currentPrediction.topic} | ${this.currentPrediction.emotion}`);
      this.stats.totalPredictions++;
      return this.currentPrediction;
    } catch (e) {
      console.error('  [cortex] Predict failed:', e.message);
      return this._fallback();
    }
  }

  _fallback() {
    this.currentPrediction = { topic: 'unbekannt', emotion: 'neutral', need: 'conversation', confidence: 0.1, timestamp: new Date() };
    return this.currentPrediction;
  }

  // ── 2. COMPARE ──────────────────────────────────────────

  async compare(prediction, actual) {
    if (!prediction || !actual) return { error: 0.5, lesson: null };

    const prompt = `Vergleiche eine Vorhersage mit der tatsaechlichen Nachricht.

Vorhersage: Thema="${prediction.topic}", Emotion="${prediction.emotion}", Beduerfnis="${prediction.need}"
Nachricht: "${actual.slice(0, 300)}"

Antworte NUR als JSON:
{"error":0.0-1.0,"lesson":"was gelernt wurde oder null"}`;

    try {
      const raw = await this.llm.generate(prompt, [], 'Vergleich.', { max_tokens: 100 });
      const p = this._json(raw);
      if (!p) return { error: 0.5, lesson: null };

      const error = clamp(p.error || 0.5, 0, 1);
      const lesson = (p.lesson && p.lesson !== 'null') ? p.lesson : null;

      if (error < 0.4) this.stats.totalCorrect++;
      this.stats.predictionAccuracy = this.stats.totalPredictions > 0
        ? this.stats.totalCorrect / this.stats.totalPredictions : 0.5;

      this.predictionHistory.push({ prediction, actual: actual.slice(0, 200), error, timestamp: new Date() });
      if (this.predictionHistory.length > 50) this.predictionHistory = this.predictionHistory.slice(-50);

      if (error > 0.4) {
        this.stats.surprisesToday++;
        this._stream('surprise', `${error.toFixed(2)}: expected "${prediction.topic}"`);
        this.lastSurprise = { error, expected: prediction, actual: actual.slice(0, 200), lesson, timestamp: new Date() };
        if (lesson) await this._learn(lesson, error);
        this._nudgeDim('learning', error * 0.02);
      }
      return { error, lesson };
    } catch (e) {
      console.error('  [cortex] Compare failed:', e.message);
      return { error: 0.5, lesson: null };
    }
  }

  // ── 3. LEARN ────────────────────────────────────────────

  async _learn(content, magnitude) {
    const existing = this.lessons.find(l => wordSimilarity(l.content, content) > 0.7);
    if (existing) {
      existing.confidence = clamp(existing.confidence + 0.1, 0, 1);
      existing.confirmations++;
      existing.lastConfirmed = new Date().toISOString();
      this._stream('learn', `Reinforced: ${existing.content} (c:${existing.confidence.toFixed(2)})`);
    } else {
      this.lessons.push({
        id: `L${Date.now().toString(36)}`, content,
        confidence: clamp(0.3 + magnitude * 0.3, 0, 1),
        confirmations: 1, contradictions: 0,
        created: new Date().toISOString(), lastConfirmed: new Date().toISOString(),
      });
      if (this.lessons.length > MAX_LESSONS) {
        this.lessons.sort((a, b) => b.confidence - a.confidence);
        this.lessons.length = MAX_LESSONS;
      }
      this.stats.insightsToday++;
      this._stream('learn', `New: ${content}`);
    }
    // Soft decay for partially related lessons
    for (const l of this.lessons) {
      if (l.content === content) continue;
      const sim = wordSimilarity(l.content, content);
      if (sim > 0.3 && sim < 0.7) l.confidence = clamp(l.confidence - 0.02, 0, 1);
    }
  }

  // ── 4. THINK ────────────────────────────────────────────

  async think() {
    this._resetDaily();
    const sources = this._thinkSources();
    if (sources.length < 2) { this._stream('think', 'Not enough material yet.'); return null; }

    const shuffled = [...sources].sort(() => Math.random() - 0.5);
    const [a, b] = [shuffled[0], shuffled[1]];
    if (wordSimilarity(a, b) > 0.6) { this._stream('think', 'Concepts too similar.'); return null; }

    await writePulse(this.soulPath, 'think:Generating novel thought');
    const fl = this.field?._fieldLabel?.() || 'ausgeglichen';
    const deficit = this._deficit();

    const prompt = `Verbinde zwei Konzepte zu einem neuen Gedanken.

A: "${a}"
B: "${b}"

Zustand: ${fl} | Drang: ${this._drang().toFixed(2)} (Defizit: ${deficit.name})

Antworte NUR als JSON:
{"thought":"1-2 Saetze","consequences":"Konsequenz oder null","novelty_self_rating":0.0-1.0}`;

    try {
      const raw = await this.llm.generate(prompt, [], 'Denken.', { max_tokens: 200 });
      const p = this._json(raw);
      if (!p?.thought) return null;

      const maxSim = this.thoughts.reduce((mx, t) => Math.max(mx, wordSimilarity(t.content, p.thought)), 0);
      const novelty = clamp(1 - maxSim, 0, 1);
      if (novelty < NOVELTY_THRESHOLD) { this._stream('think', `Too similar (${novelty.toFixed(2)}). Discarded.`); return null; }

      const thought = {
        id: `T${Date.now().toString(36)}`, content: p.thought,
        consequences: (p.consequences && p.consequences !== 'null') ? p.consequences : null,
        novelty, selfRating: p.novelty_self_rating || 0.5,
        sources: [a.slice(0, 60), b.slice(0, 60)], timestamp: new Date(),
      };

      this.thoughts.push(thought);
      if (this.thoughts.length > MAX_THOUGHTS) this.thoughts = this.thoughts.slice(-MAX_THOUGHTS);
      this.lastThought = thought;
      this.stats.thoughtsToday++;
      this._unexpressed++;
      this._stream('thought', thought.content);
      this._nudgeDim('creativity', novelty * 0.03);

      if (this.bus) this.bus.safeEmit('cortex.thought', { source: 'cortex', thought });
      if (thought.consequences) {
        this._stream('insight', thought.consequences);
        if (this.bus) this.bus.safeEmit('cortex.insight', { source: 'cortex', insight: thought.consequences, thought: thought.content });
      }
      return thought;
    } catch (e) {
      console.error('  [cortex] Think failed:', e.message);
      return null;
    }
  }

  _thinkSources() {
    const s = [];
    for (const l of this.lessons.filter(l => l.confidence > 0.3)) s.push(l.content);
    for (const t of this.thoughts.slice(-10)) s.push(t.content);
    if (this.lastSurprise?.lesson) s.push(this.lastSurprise.lesson);
    if (this.field) s.push(`Feldzustand: ${this.field._fieldLabel()}`);
    const d = this._deficit();
    s.push(`Defizit: ${d.name} — ${d.description}`);
    return s;
  }

  // ── 5. DRANG ────────────────────────────────────────────

  _drang() {
    const avg = this.dimensions.reduce((s, d) => s + d.score, 0) / this.dimensions.length;
    return clamp(1.0 - avg, 0, 1);
  }

  _deficit() {
    return this.dimensions.reduce((lo, d) => d.score < lo.score ? d : lo, this.dimensions[0]);
  }

  _nudgeDim(id, delta) {
    const d = this.dimensions.find(x => x.id === id);
    if (d) d.score = clamp(d.score + delta, 0, 1);
  }

  /** External API: record evidence that a dimension improved. */
  recordDimensionEvidence(id, delta = 0.02) {
    this._nudgeDim(id, delta);
    this._stream('drang', `${id} ${delta > 0 ? '+' : ''}${delta.toFixed(3)}`);
  }

  // ── 6. NEEDS ────────────────────────────────────────────

  _tickNeeds() {
    this._resetDaily();
    const now = Date.now();
    const minSinceNovel = (now - this._lastNovelInput) / 60000;
    const minSinceHuman = (now - this._lastInteraction) / 60000;

    this.needs.stimulation = clamp(this.needs.stimulation + 0.01 * Math.min(minSinceNovel / 30, 1), 0, 1);
    this.needs.connection = clamp(this.needs.connection + 0.01 * Math.min(minSinceHuman / 60, 1), 0, 1);
    this.needs.expression = clamp(this.needs.expression + (this._unexpressed > 0
      ? 0.015 * Math.min(this._unexpressed / 5, 1) : -0.005), 0, 1);
    this.needs.rest = clamp(this.needs.rest + (this._activity > 0.6 ? 0.02 : -0.01), 0, 1);
    this._activity = clamp(this._activity - 0.02, 0, 1);

    const dr = this._drang();
    if (dr > 0.7) this.needs.stimulation = clamp(this.needs.stimulation + 0.005, 0, 1);
    else if (dr < 0.3) this.needs.expression = clamp(this.needs.expression + 0.003, 0, 1);

    if (this.bus) this.bus.safeEmit('cortex.needs', { source: 'cortex', needs: { ...this.needs }, drang: dr });
  }

  // ── 7. API ──────────────────────────────────────────────

  getState() {
    const fs = this.field?.getState?.();
    const dr = this._drang();
    const df = this._deficit();
    return {
      emotion: fs ? { valence: fs.vector.valence, energy: fs.vector.arousal, openness: fs.vector.openness, label: fs.label } : null,
      prediction: this.currentPrediction ? { topic: this.currentPrediction.topic, emotion: this.currentPrediction.emotion, need: this.currentPrediction.need, confidence: this.currentPrediction.confidence } : null,
      lastSurprise: this.lastSurprise ? { error: this.lastSurprise.error, expected: this.lastSurprise.expected?.topic, actual: this.lastSurprise.actual?.slice(0, 100), lesson: this.lastSurprise.lesson, timestamp: this.lastSurprise.timestamp } : null,
      lastThought: this.lastThought ? { content: this.lastThought.content, novelty: this.lastThought.novelty, sources: this.lastThought.sources, timestamp: this.lastThought.timestamp } : null,
      drang: {
        score: dr,
        dimensions: this.dimensions.map(d => ({ id: d.id, name: d.name, score: d.score, description: d.description })),
        strongestDeficit: { id: df.id, name: df.name, score: df.score },
        currentAction: dr > 0.7 ? 'seeking-knowledge' : dr > 0.4 ? 'balanced' : 'reflecting',
      },
      needs: { ...this.needs },
      thoughtStream: this.thoughtStream.slice(-20),
      stats: {
        thoughtsToday: this.stats.thoughtsToday, surprisesToday: this.stats.surprisesToday,
        insightsToday: this.stats.insightsToday, predictionAccuracy: this.stats.predictionAccuracy,
        totalLessons: this.lessons.length, totalThoughts: this.thoughts.length,
      },
    };
  }

  // ── Persistence ─────────────────────────────────────────

  async _load() {
    if (!existsSync(this.statePath)) return;
    try {
      const d = JSON.parse(await readFile(this.statePath, 'utf-8'));
      if (d.lessons) this.lessons = d.lessons.slice(-MAX_LESSONS);
      if (d.thoughts) this.thoughts = d.thoughts.slice(-MAX_THOUGHTS);
      if (d.thoughtStream) this.thoughtStream = d.thoughtStream.slice(-MAX_STREAM);
      if (d.dimensions) for (const s of d.dimensions) { const x = this.dimensions.find(v => v.id === s.id); if (x) x.score = s.score; }
      if (d.needs) Object.assign(this.needs, d.needs);
      if (d.stats) Object.assign(this.stats, d.stats);
      if (d.predictionHistory) this.predictionHistory = d.predictionHistory.slice(-50);
      if (d.lastSurprise) this.lastSurprise = d.lastSurprise;
      if (d.lastThought) this.lastThought = d.lastThought;
    } catch { console.warn('  [cortex] Could not load state — starting fresh.'); }
  }

  async _save() {
    try {
      await writeFile(this.statePath, JSON.stringify({
        lessons: this.lessons, thoughts: this.thoughts, thoughtStream: this.thoughtStream,
        dimensions: this.dimensions.map(d => ({ id: d.id, score: d.score })),
        needs: this.needs, stats: this.stats, predictionHistory: this.predictionHistory.slice(-50),
        lastSurprise: this.lastSurprise, lastThought: this.lastThought, savedAt: new Date().toISOString(),
      }, null, 2));
    } catch (e) { console.error('  [cortex] Save failed:', e.message); }
  }

  // ── Helpers ─────────────────────────────────────────────

  _stream(type, content) {
    this.thoughtStream.push({ timestamp: new Date().toISOString(), type, content });
    if (this.thoughtStream.length > MAX_STREAM) this.thoughtStream = this.thoughtStream.slice(-MAX_STREAM);
  }

  _resetDaily() {
    const today = new Date().toISOString().split('T')[0];
    if (this.stats.statsDate !== today) {
      this.stats.thoughtsToday = this.stats.surprisesToday = this.stats.insightsToday = 0;
      this.stats.statsDate = today;
    }
  }

  _json(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim()); }
    catch { const m = raw.match(/\{[\s\S]*?\}/); if (m) try { return JSON.parse(m[0]); } catch {} return null; }
  }
}
