// Geteilte Status-Semantik für Modul-Zeilen (Control-Plane + Palette + Inspector).
// Farbe nur als Signal — Apple: gefüllter Punkt, KEIN Glow (an=grün, aus=neutral,
// unbekannt=gedämpft). Der Klartext (Ich-Form/Wirkung) lebt zentral in explain.ts —
// hier nur durchgereicht, damit alle Modul-Konsumenten EINE Anlaufstelle haben.

import type { ControlKind, ModuleView } from "./useRegistry";

// Klartext-Quelle bleibt explain.ts (MODULE_EXPLAIN). Re-Export statt Duplikat.
export { explainModule, MODULE_EXPLAIN } from "./explain";
export type { ModuleExplain } from "./explain";

export interface DotStyle {
  color: string;
  /** Beibehalten für API-Stabilität der Konsumenten — Apple leuchtet nichts, daher stets false. */
  glow: boolean;
}

export function statusDot(m: ModuleView): DotStyle {
  if (!m.available) return { color: "rgba(255,255,255,0.22)", glow: false }; // nicht instanziiert
  if (m.enabled === true) return { color: "var(--color-green)", glow: false };
  if (m.enabled === false) return { color: "rgba(255,255,255,0.30)", glow: false };
  return { color: "var(--color-orange)", glow: false }; // null = unbekannt
}

// Kurzes, ruhiges Status-Wort für die rechte Spalte (wenn kein Live-Wert da ist).
export function statusWord(m: ModuleView): string {
  if (m.locked) return "gesichert";
  if (m.control === "readonly") return "nur lesen";
  if (m.control === "action") return m.available ? "auslösbar" : "n/v";
  if (!m.available) return "inaktiv";
  if (m.enabled === true) return "aktiv";
  if (m.enabled === false) return "aus";
  return "unbekannt";
}

const CONTROL_LABEL: Record<ControlKind, string> = {
  runtime: "Laufzeit",
  env: "Boot-Flag",
  action: "Aktion",
  readonly: "Nur lesen",
  critical_locked: "Gesichert",
};
export function controlLabel(k: ControlKind): string {
  return CONTROL_LABEL[k] ?? k;
}

// Zieht einen kurzen, sprechenden Live-Wert aus einer beliebigen Endpoint-Antwort.
// Bewusst defensiv — die 76 Module liefern höchst unterschiedliche Shapes.
export function shortLiveValue(data: unknown): string | null {
  if (data == null || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
    return undefined;
  };
  const fmt = (v: unknown): string => {
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
    if (typeof v === "boolean") return v ? "an" : "aus";
    if (typeof v === "string") return v.length > 22 ? v.slice(0, 22) + "…" : v;
    return "";
  };
  // gängige sprechende Felder
  const status = pick("status", "state", "mood", "phase", "label");
  if (typeof status === "string") return fmt(status);
  const count = pick("count", "total", "size", "queued", "pending", "active", "n");
  if (typeof count === "number") return fmt(count);
  const rate = pick("rate", "hz", "valence", "energy", "load", "score");
  if (typeof rate === "number") return fmt(rate);
  // letzte Rettung: erstes primitives Feld
  for (const v of Object.values(o)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") {
      const s = fmt(v);
      if (s) return s;
    }
  }
  return null;
}
