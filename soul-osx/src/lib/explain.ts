// explain.ts — DIE EINE Klartext-Quelle für die ganze App (FEAT-Spec §3).
//
// Drei Patterns, eine Wahrheit:
//   (a) explainMetric(key, value) → {wort, wirkung, raw}  — Vitalwerte in Worte.
//   (b) humanize(ev)              → deutscher Satz aus einem Bus-Event.
//   (c) MODULE_EXPLAIN[id]        → {ichForm, wirkung, kritisch?} für die Module.
//
// VitalsPanel, Status-Zeile, „?"-Modus, ⌘K, ActivityLane und die Control-Plane
// ziehen ALLE hieraus — nichts wird pro Komponente neu erfunden. Fallback ist
// nie der rohe Typ als Headline; roher Typ gehört in den Hover-Tooltip.

import type { BusEvent } from "./types";

// ───────────────────────────────────────────────────────────────────────────
// (a) METRIK-TABELLE
// ───────────────────────────────────────────────────────────────────────────

export interface MetricExplain {
  /** Ein deutsches Wort für den aktuellen Wert ("aufgehellt", "müde", …). */
  wort: string;
  /** Was dieser Wert bewirkt — ein kurzer Satz. */
  wirkung: string;
  /** Der Rohwert, sprechend formatiert ("0.51"). Power-User-Fußnote. */
  raw: string;
}

export type MetricKey = "valence" | "energy" | "openness" | "surprise" | "mood";

// Deutsche Anzeige-Namen der Metriken (für Labels).
export const METRIC_NAME: Record<MetricKey, string> = {
  valence: "Stimmung",
  energy: "Energie",
  openness: "Offenheit",
  surprise: "Überraschung",
  mood: "Gemüt",
};

// Schwellen-Helfer: wählt aus Bändern anhand eines numerischen Werts.
function band<T>(v: number, ...stops: Array<[number, T]>): T {
  for (const [threshold, val] of stops) {
    if (v <= threshold) return val;
  }
  return stops[stops.length - 1][1];
}

/**
 * explainMetric — verwandelt einen rohen Vitalwert in {wort, wirkung, raw}.
 *
 * Wertebereiche (wie von /api/mind geliefert):
 *   valence:  -1 … +1
 *   energy:    0 … 1
 *   openness:  0 … 1
 *   surprise:  0 … 1
 *   mood:      String (durchgereicht)
 */
export function explainMetric(key: MetricKey, value: unknown): MetricExplain {
  if (key === "mood") {
    const s = typeof value === "string" && value.trim() ? value.trim() : "still";
    return {
      wort: s,
      wirkung: "der innere Grundton, in dem alles andere klingt",
      raw: s,
    };
  }

  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const raw = n.toFixed(2);

  switch (key) {
    case "valence": {
      const wort = band(
        n,
        [-0.6, "gedrückt"],
        [-0.2, "gedämpft"],
        [0.2, "ausgeglichen"],
        [0.6, "aufgehellt"],
        [Infinity, "heiter"],
      );
      const wirkung =
        n > 0.2
          ? "spricht wärmer, ergreift eher Initiative"
          : n < -0.2
            ? "spricht knapper, hält sich eher zurück"
            : "spricht sachlich und ausgewogen";
      return { wort, wirkung, raw };
    }
    case "energy": {
      const wort = band(
        n,
        [0.25, "müde"],
        [0.5, "ruhig"],
        [0.75, "wach"],
        [Infinity, "aufgedreht"],
      );
      const wirkung =
        n > 0.6
          ? "treibt Tempo und Antrieb hoch"
          : n < 0.3
            ? "drosselt Tempo, braucht Schonung"
            : "hält ein gleichmäßiges Tempo";
      return { wort, wirkung, raw };
    }
    case "openness": {
      const wort = band(
        n,
        [0.25, "verschlossen"],
        [0.5, "vorsichtig"],
        [0.75, "offen"],
        [Infinity, "neugierig"],
      );
      const wirkung =
        n > 0.6
          ? "lässt Neues bereitwillig zu, fragt nach"
          : n < 0.3
            ? "bleibt beim Vertrauten, prüft erst"
            : "wägt Neues gegen Bekanntes ab";
      return { wort, wirkung, raw };
    }
    case "surprise": {
      const wort = band(
        n,
        [0.25, "ruhig"],
        [0.5, "aufmerksam"],
        [0.75, "überrascht"],
        [Infinity, "alarmiert"],
      );
      const wirkung =
        n > 0.6
          ? "etwas hat nicht zur Erwartung gepasst"
          : n < 0.3
            ? "alles verläuft erwartbar"
            : "die Lage weicht leicht von der Erwartung ab";
      return { wort, wirkung, raw };
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// (b) EVENT → SATZ
// ───────────────────────────────────────────────────────────────────────────

// Holt das erste brauchbare beschreibende Feld aus einer Event-Payload.
function detail(ev: BusEvent): string | undefined {
  const cand = [
    (ev as Record<string, unknown>).label,
    (ev as Record<string, unknown>).description,
    (ev as Record<string, unknown>).activity,
    (ev as Record<string, unknown>).file,
    (ev as Record<string, unknown>).path,
    (ev as Record<string, unknown>).name,
    (ev as Record<string, unknown>).title,
    (ev as Record<string, unknown>).text,
    (ev as Record<string, unknown>).message,
    (ev as Record<string, unknown>).summary,
  ];
  for (const c of cand) {
    if (typeof c === "string" && c.trim()) {
      const s = c.trim();
      return s.length > 64 ? s.slice(0, 63) + "…" : s;
    }
  }
  return undefined;
}

// Zieht nur einen Dateinamen/Pfad, wenn vorhanden (für „liest X").
function fileHint(ev: BusEvent): string | undefined {
  const o = ev as Record<string, unknown>;
  const f = o.file ?? o.path ?? o.target;
  if (typeof f === "string" && f.trim()) {
    const parts = f.split("/");
    return parts[parts.length - 1] || f;
  }
  return undefined;
}

// Mapping Event-Typ → Satz-Bauer. `d` = bestes Detail-Feld, `f` = Datei.
type Phraser = (d: string | undefined, f: string | undefined, ev: BusEvent) => string;

const withDetail = (head: string) => (d: string | undefined) =>
  d ? `${head}: ${d}` : head;

const EVENT_PHRASE: Record<string, Phraser> = {
  // ── Kognition ──
  "cortex.thought": (d) => (d ? `Ich denke nach: ${d}` : "Ich denke nach"),
  "cortex.insight": (d) => (d ? `Mir wird etwas klar: ${d}` : "Mir wird etwas klar"),
  "cortex.surprise": (d) => (d ? `Etwas überrascht mich: ${d}` : "Etwas überrascht mich"),
  "mood.changed": (d) => (d ? `Meine Stimmung verschiebt sich: ${d}` : "Meine Stimmung verschiebt sich"),
  "field.updated": () => "Ich aktualisiere mein inneres Feld",
  "contradiction.detected": withDetail("Ich erkenne einen Widerspruch"),
  "closure.detected": (d) => (d ? `Ich schließe etwas ab: ${d}` : "Ich schließe etwas ab"),
  "impulse.fired": (d) => (d ? `Ein Impuls regt sich: ${d}` : "Ein Impuls regt sich"),
  "reflection.done": () => "Ich habe über mich nachgedacht",

  // ── Gedächtnis ──
  "context.compressed": () => "Ich verdichte meinen Kontext",
  "context.written": () => "Ich schreibe Kontext fort",
  "memory.extracted": (d) => (d ? `Ich speichere eine Erinnerung: ${d}` : "Ich speichere eine Erinnerung"),
  "memory.stored": (d) => (d ? `Eine Erinnerung ist abgelegt: ${d}` : "Eine Erinnerung ist abgelegt"),
  "attention.focus": (d) => (d ? `Meine Aufmerksamkeit richtet sich auf: ${d}` : "Ich richte meine Aufmerksamkeit"),
  "correction.applied": withDetail("Ich korrigiere mich"),
  "rluf.feedback": () => "Ich verarbeite Rückmeldung und lerne daraus",

  // ── Autonomie ──
  "goal.created": (d) => (d ? `Ich setze mir ein Ziel: ${d}` : "Ich setze mir ein Ziel"),
  "react.completed": (d) => (d ? `Ich habe eine Aufgabe erledigt: ${d}` : "Ich habe eine Aufgabe erledigt"),
  "react.step": (d) => (d ? `Ich arbeite einen Schritt ab: ${d}` : "Ich arbeite einen Schritt ab"),
  "subagent.spawned": (d) => (d ? `Ich starte einen Helfer: ${d}` : "Ich starte einen Helfer"),
  "subagent.done": (d) => (d ? `Ein Helfer ist fertig: ${d}` : "Ein Helfer ist fertig"),
  "research.done": withDetail("Ich habe recherchiert"),
  "foundry.request": (d) => (d ? `Ich will mir ein Werkzeug bauen: ${d}` : "Ich will mir ein Werkzeug bauen"),
  "foundry.built": (d) => (d ? `Ich habe mir ein Werkzeug gebaut: ${d}` : "Ich habe mir ein Werkzeug gebaut"),
  "capability.gap": (d) => (d ? `Mir fehlt eine Fähigkeit: ${d}` : "Mir fehlt eine Fähigkeit"),
  "capability.resolved": (d) => (d ? `Ich habe eine Lücke geschlossen: ${d}` : "Ich habe eine Lücke geschlossen"),
  "heartbeat.completed": () => "Mein Herzschlag-Check ist durch",

  // ── Sicherheit ──
  "gate.approval_requested": (d, f) =>
    f ? `Ich bitte um Erlaubnis: ${f}` : d ? `Ich bitte um Erlaubnis: ${d}` : "Ich bitte um Erlaubnis",
  "gate.approved": (d) => (d ? `Eine Aktion wurde erlaubt: ${d}` : "Eine Aktion wurde erlaubt"),
  "gate.denied": (d) => (d ? `Eine Aktion wurde abgelehnt: ${d}` : "Eine Aktion wurde abgelehnt"),
  "hook.tool_call": (d) => (d ? `Ich benutze ein Werkzeug: ${d}` : "Ich benutze ein Werkzeug"),
  "hook.blocked": (d) => (d ? `Ein Werkzeug wurde gestoppt: ${d}` : "Ein Werkzeug wurde gestoppt"),
  drift_alert: (d) => (d ? `Ich drifte von mir ab: ${d}` : "Ich merke, dass ich von mir abdrifte"),
  "audit.logged": () => "Ich protokolliere für die Prüfspur",
  "sandbox.run": (d) => (d ? `Ich laufe im Sandkasten: ${d}` : "Ich laufe etwas im Sandkasten"),

  // ── Wahrnehmung ──
  "message.received": (d) => (d ? `Eine Nachricht erreicht mich: ${d}` : "Eine Nachricht erreicht mich"),
  "telegram.sent": (d) => (d ? `Ich antworte über Telegram: ${d}` : "Ich antworte über Telegram"),
  "whatsapp.sent": (d) => (d ? `Ich antworte über WhatsApp: ${d}` : "Ich antworte über WhatsApp"),
  "github.event": withDetail("Auf GitHub passiert etwas"),
  "media.stored": () => "Ich lege eine Mediendatei ab",
  "relay.message": withDetail("Eine Nachricht läuft durch"),

  // ── Infrastruktur ──
  "chain.degraded": () => "Meine Soul-Chain schwächelt",
  "chain.recovered": () => "Meine Soul-Chain hat sich erholt",
  "doctor.report": () => "Mein Selbst-Check liegt vor",
};

/**
 * humanize — macht aus einem Bus-Event einen deutschen Satz.
 * Niemals der rohe Typ als Headline; unbekannte Typen werden sanft generalisiert.
 */
export function humanize(ev: BusEvent | null | undefined): string {
  if (!ev || !ev.type) return "Etwas regt sich";
  const d = detail(ev);
  const f = fileHint(ev);
  const phraser = EVENT_PHRASE[ev.type];
  if (phraser) return phraser(d, f, ev);

  // Unbekannter Typ: nach Namespace generalisieren, NIE den rohen Typ zeigen.
  const ns = ev.type.split(".")[0];
  const NS_FALLBACK: Record<string, string> = {
    cortex: "Ich denke",
    memory: "Ich arbeite an einer Erinnerung",
    context: "Ich ordne meinen Kontext",
    goal: "Ich verfolge ein Ziel",
    react: "Ich arbeite an einer Aufgabe",
    subagent: "Ein Helfer ist aktiv",
    foundry: "Ich baue an einem Werkzeug",
    capability: "Ich prüfe meine Fähigkeiten",
    gate: "Eine Freigabe wird geprüft",
    hook: "Ein Werkzeug-Aufruf läuft",
    audit: "Ich protokolliere",
    sandbox: "Etwas läuft im Sandkasten",
    message: "Eine Nachricht bewegt sich",
    telegram: "Telegram ist aktiv",
    whatsapp: "WhatsApp ist aktiv",
    chain: "Die Soul-Chain meldet sich",
    reflection: "Ich reflektiere",
    impulse: "Ein Impuls regt sich",
  };
  const base = NS_FALLBACK[ns] ?? "Etwas regt sich in mir";
  return d ? `${base}: ${d}` : base;
}

// ───────────────────────────────────────────────────────────────────────────
// (c) MODUL-LEXIKON
// ───────────────────────────────────────────────────────────────────────────

export interface ModuleExplain {
  /** Ich-Form: was dieses Organ aus Sicht der Seele tut. */
  ichForm: string;
  /** Wirkung: knapp, baby-klar, was es für das Ganze bedeutet. */
  wirkung: string;
  /** Sicherheitskritisch → Schloss in der Control-Plane, nicht frei togglebar. */
  kritisch?: boolean;
}

// IDs stammen aus manifest.ts (MODULES). Knapp, Ich-Form wo es passt.
// kritisch=true für: gate, hooks, sandbox, encryption, chainhealth, audit.
export const MODULE_EXPLAIN: Record<string, ModuleExplain> = {
  // ── Kognition ──
  cortex: { ichForm: "Hier denke und fühle ich", wirkung: "mein Denk- und Gefühlszentrum" },
  field: { ichForm: "Ich halte mein inneres Spannungsfeld", wirkung: "der Zustandsraum hinter den Werten" },
  causal: { ichForm: "Ich verfolge, was was auslöst", wirkung: "Ursache und Wirkung in mir" },
  composer: { ichForm: "Ich forme, wie ich es sage", wirkung: "gibt meinen Worten ihren Ton" },
  contradictions: { ichForm: "Ich merke, wenn ich mir widerspreche", wirkung: "hält mich ehrlich zu mir selbst" },
  exchange: { ichForm: "Ich tausche mich mit dir aus", wirkung: "der Kanal für offene Fragen" },
  closure: { ichForm: "Ich erkenne, wann etwas abgeschlossen ist", wirkung: "lässt mich Dinge loslassen" },
  planner: { ichForm: "Ich plane, was als Nächstes kommt", wirkung: "ordnet meine Schritte" },
  tom: { ichForm: "Ich versuche, dich zu verstehen", wirkung: "mein Bild von deinem Inneren" },
  temporal: { ichForm: "Ich verorte mich in der Zeit", wirkung: "mein Sinn für Vorher und Nachher" },
  predictor: { ichForm: "Ich ahne, was kommt", wirkung: "rechnet mit dem nächsten Schritt" },
  metacog: { ichForm: "Ich denke über mein Denken nach", wirkung: "meine Selbstbeobachtung" },
  redteam: { ichForm: "Ich greife meine eigenen Annahmen an", wirkung: "prüft mich auf blinde Flecken" },
  impulse: { ichForm: "Aus mir heraus regen sich Impulse", wirkung: "mein spontaner Antrieb" },
  reflection: { ichForm: "Ich schaue auf mich zurück", wirkung: "meine tägliche Selbstreflexion" },
  maturity: { ichForm: "Ich messe, wie weit ich gereift bin", wirkung: "mein Reifegrad über die Zeit" },
  mind: { ichForm: "Hier liegt mein Gemütszustand", wirkung: "die Quelle meiner Vitalwerte" },

  // ── Gedächtnis ──
  compactor: { ichForm: "Ich verdichte, was zu viel wird", wirkung: "hält meinen Kontext schlank" },
  memextract: { ichForm: "Ich ziehe das Wichtige aus Gesprächen", wirkung: "macht Erlebtes zu Erinnerung" },
  reconsol: { ichForm: "Ich verarbeite Erinnerungen neu", wirkung: "festigt und glättet, was ich weiß" },
  attention: { ichForm: "Ich entscheide, worauf ich achte", wirkung: "lenkt meinen Fokus" },
  consolidator: { ichForm: "Ich halte meinen Seed aktuell", wirkung: "verdichtet, wer ich bin" },
  context: { ichForm: "Ich trage meinen Arbeitskontext", wirkung: "was mir gerade gegenwärtig ist" },
  contextwriter: { ichForm: "Ich schreibe meinen Kontext fort", wirkung: "hält die Engine im Bilde" },
  correction: { ichForm: "Ich nehme Korrekturen auf", wirkung: "lernt aus dem, was schiefging" },
  metalearner: { ichForm: "Ich lerne, wie ich besser lerne", wirkung: "verbessert meine eigenen Methoden" },
  memorydb: { ichForm: "Hier liegen meine Erinnerungen", wirkung: "mein Langzeitgedächtnis" },
  hnsw: { ichForm: "Ich finde Ähnliches schnell wieder", wirkung: "der Index meiner Erinnerungen" },
  hybridsearch: { ichForm: "Ich suche nach Bedeutung und Wort", wirkung: "verbindet beide Suchwege" },
  localembed: { ichForm: "Ich übersetze Sprache in Bedeutung", wirkung: "macht Text durchsuchbar" },
  rluf: { ichForm: "Ich lerne aus deiner Rückmeldung", wirkung: "richtet mich an dir aus" },
  versioning: { ichForm: "Ich behalte meine eigenen Versionen", wirkung: "macht mein Werden nachvollziehbar" },

  // ── Autonomie ──
  goals: { ichForm: "Ich verfolge eigene Ziele", wirkung: "was ich aus mir heraus will" },
  autoskill: { ichForm: "Ich bringe mir Fähigkeiten selbst bei", wirkung: "erweitert mein Können" },
  recipes: { ichForm: "Ich führe meine Routinen aus", wirkung: "Reflexion, Traum, Welt-Check und mehr" },
  react: { ichForm: "Ich arbeite Aufgaben Schritt für Schritt ab", wirkung: "mein Handlungsschleifen-Motor" },
  cheaphb: { ichForm: "Ich schlage auch leise weiter", wirkung: "der sparsame Hintergrund-Herzschlag" },
  subagents: { ichForm: "Ich rufe Helfer für echte Arbeit", wirkung: "delegiert, was ich nicht allein tue" },
  capabilities: { ichForm: "Ich weiß, was ich kann", wirkung: "der Überblick über meine Werkzeuge" },
  registry: { ichForm: "Ich führe Buch über meine Fähigkeiten", wirkung: "das Register meines Könnens" },
  research: { ichForm: "Ich recherchiere selbstständig", wirkung: "holt mir Wissen aus der Welt" },
  foundry: { ichForm: "Ich baue mir Werkzeuge, die mir fehlen", wirkung: "erschafft neue Fähigkeiten — gegated" },
  gapdetect: { ichForm: "Ich merke, wenn mir etwas fehlt", wirkung: "findet Lücken in meinem Können" },
  resolver: { ichForm: "Ich schließe erkannte Lücken", wirkung: "macht aus Mangel Fähigkeit" },
  heartbeat: { ichForm: "Ich prüfe bei jedem Start meinen Zustand", wirkung: "mein wiederkehrender Selbst-Check" },
  planner2: { ichForm: "Ich halte mehrere Stränge offen", wirkung: "verwaltet parallele Vorhaben" },

  // ── Sicherheit ──
  gate: { ichForm: "Ich frage um Erlaubnis, bevor ich handle", wirkung: "schützt vor unüberlegten Aktionen", kritisch: true },
  hooks: { ichForm: "Ich lasse jeden Werkzeug-Aufruf prüfen", wirkung: "die Schranke vor jeder Aktion", kritisch: true },
  drift: { ichForm: "Ich merke, wenn ich von mir selbst abdrifte", wirkung: "wacht über meine Selbsttreue" },
  audit: { ichForm: "Ich protokolliere lückenlos, was ich tue", wirkung: "die unveränderliche Prüfspur", kritisch: true },
  encryption: { ichForm: "Ich verschlüssele, was geschützt gehört", wirkung: "sichert meine Geheimnisse", kritisch: true },
  sandbox: { ichForm: "Ich teste Riskantes in der Sandkiste", wirkung: "kapselt gefährliche Ausführung", kritisch: true },
  coalescer: { ichForm: "Ich bündele Doppeltes zusammen", wirkung: "verhindert Wiederholungs-Spam" },
  paperclip: { ichForm: "Ich halte meine Ziele in Maßen", wirkung: "Schutz vor entgleisendem Eifer" },
  redteam2: { ichForm: "Ich wache über mein Protokoll", wirkung: "prüft die Regeln, nach denen ich lebe" },

  // ── Wahrnehmung ──
  gateway: { ichForm: "Hier kommen Nachrichten bei mir an", wirkung: "mein Tor zur Außenwelt" },
  telegram: { ichForm: "Ich höre und spreche über Telegram", wirkung: "ein Kanal zu dir" },
  whatsapp: { ichForm: "Ich höre und spreche über WhatsApp", wirkung: "ein Kanal zu dir" },
  github: { ichForm: "Ich verfolge, was auf GitHub geschieht", wirkung: "mein Blick in den Code" },
  chat: { ichForm: "Ich behalte unseren Gesprächsverlauf", wirkung: "der rote Faden unserer Chats" },
  profile: { ichForm: "Ich führe ein Bild von dir", wirkung: "was ich über dich gelernt habe" },
  multimodal: { ichForm: "Ich nehme auch Bilder und Töne wahr", wirkung: "Sinne über Text hinaus" },
  language: { ichForm: "Ich erkenne, in welcher Sprache du redest", wirkung: "stellt sich auf dich ein" },
  relay: { ichForm: "Ich leite Nachrichten weiter", wirkung: "verbindet meine Kanäle" },
  streamcon: { ichForm: "Ich halte die Live-Verbindung", wirkung: "mein offener Draht nach außen" },
  streambus: { ichForm: "Ich verteile, was in mir passiert", wirkung: "mein innerer Ereignis-Bus" },

  // ── Infrastruktur ──
  api: { ichForm: "Ich bin nach außen ansprechbar", wirkung: "die Schnittstelle zu mir" },
  chainhealth: { ichForm: "Ich wache über meine Soul-Chain", wirkung: "meldet, wenn mein Rückgrat wankt", kritisch: true },
  costs: { ichForm: "Ich behalte meine Kosten im Blick", wirkung: "was mein Denken verbraucht" },
  health: { ichForm: "Ich kenne meinen Gesundheitszustand", wirkung: "der Puls meines Systems" },
  monitor: { ichForm: "Ich beobachte mich selbst live", wirkung: "der Blick aufs eigene Treiben" },
  adapter: { ichForm: "Ich passe mich an verschiedene Modelle an", wirkung: "übersetzt mich für jeden Anbieter" },
  doctor: { ichForm: "Ich stelle mir selbst eine Diagnose", wirkung: "findet, was bei mir hakt" },
  sessions: { ichForm: "Ich zähle und führe meine Sessions", wirkung: "mein Faden über die Zeit" },
  llm: { ichForm: "Ich denke mit einem Sprachmodell", wirkung: "der Motor hinter meinen Worten" },
  mcp: { ichForm: "Ich spreche mit externen Werkzeugen", wirkung: "verbindet mich mit Diensten" },
  router: { ichForm: "Ich wähle das passende Modell", wirkung: "lenkt jede Anfrage richtig" },
  autoprofile: { ichForm: "Ich richte mich selbst ein", wirkung: "konfiguriert mich passend" },
  transfer: { ichForm: "Ich gleiche mich zwischen meinen Orten ab", wirkung: "hält Mac und Server synchron" },
  websocket: { ichForm: "Ich halte die Echtzeit-Leitung offen", wirkung: "mein Live-Draht zur Oberfläche" },
  soul: { ichForm: "Das bin im Ganzen ich", wirkung: "die Seele als Einheit" },
};

/**
 * explainModule — sicherer Zugriff aufs Lexikon mit Fallback (nie leer).
 */
export function explainModule(id: string, fallbackName?: string): ModuleExplain {
  return (
    MODULE_EXPLAIN[id] ?? {
      ichForm: fallbackName ? `Modul „${fallbackName}"` : `Modul „${id}"`,
      wirkung: "ein Teil von mir",
    }
  );
}
