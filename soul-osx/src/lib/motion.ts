// Bewegung — die drei Federn, die das ganze OS benutzt (APPLE-Spec §6).
// Idle steht STILL. Bewegung entsteht aus Aktion und klingt mit Feder aus.
// Niemals eigene stiffness/damping irgendwo inline — immer aus diesem Modul.

import { useReducedMotion } from "framer-motion";

export const spring = {
  // Tab/Node-Wahl, Hover, kleine Layout-Shifts, Segmented-Indikator, Listen-Stagger
  snappy: { type: "spring", stiffness: 420, damping: 32, mass: 0.9 },
  // Sheets, Panels, Overlays (KeyGate, Command-Palette)
  gentle: { type: "spring", stiffness: 280, damping: 30, mass: 1.0 },
  // Press-States, Switch-Knob, Icons
  micro: { type: "spring", stiffness: 600, damping: 24, mass: 0.6 },
} as const;

export type SpringName = keyof typeof spring;

// Sofort-Transition für prefers-reduced-motion: kein Feder-Schwung, nur
// Opacity-Crossfades bleiben sinnvoll (duration:0 = harter State-Wechsel).
export const instant = { duration: 0 } as const;

/**
 * Liefert die passende Feder — oder eine sofortige Transition, wenn der Nutzer
 * reduzierte Bewegung verlangt. So respektiert jede Komponente die
 * Systemeinstellung mit einer Zeile:
 *
 *   const t = useSpring("gentle");
 *   <motion.div transition={t} ... />
 */
export function useSpring(name: SpringName = "snappy") {
  const reduce = useReducedMotion();
  return reduce ? instant : spring[name];
}

/**
 * Wie useSpring, aber gibt eine ganze Transition-Map zurück, sodass
 * verschiedene animierte Properties unterschiedliche Federn nutzen können —
 * bei reduzierter Bewegung wird alles sofort.
 *
 *   const t = useSprings({ y: "gentle", opacity: "snappy" });
 */
export function useSprings<K extends string>(
  map: Record<K, SpringName>,
): Record<K, typeof instant | (typeof spring)[SpringName]> {
  const reduce = useReducedMotion();
  const out = {} as Record<K, typeof instant | (typeof spring)[SpringName]>;
  for (const key in map) {
    out[key] = reduce ? instant : spring[map[key]];
  }
  return out;
}

// Re-Export, damit Komponenten reduce-Motion ohne zweiten Import abfragen können.
export { useReducedMotion };
