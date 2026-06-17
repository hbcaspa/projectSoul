// Awakening — der Aufwach-Moment. Eine kurze cinematische Apple-Sequenz beim
// App-Start: aus Dunkelheit ein erster Atemzug/Glühen, der erste Ich-Satz
// erscheint weich, dann fade/scale-out — das OS liegt darunter.
//
// Läuft EINMAL pro Mount ab (Dauer ~1.9s, +Lese-Pause). Self-contained:
// rendert sich, animiert sich, verschwindet, ruft optional onDone().
// prefers-reduced-motion: nur ein schneller Fade, kein Schwung.
//
// Einbau (ganz oben in App, einmalig beim Mount):
//   const [awake, setAwake] = useState(false);
//   {!awake && <Awakening onDone={() => setAwake(true)} />}
// Awakening kümmert sich selbst um Timing + AnimatePresence-Exit.

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, type Variants } from "framer-motion";
import { useSoul } from "../lib/store";
import { spring, useReducedMotion } from "../lib/motion";

interface AwakeningProps {
  /** Wird gerufen, sobald die Sequenz vollständig ausgeblendet ist. */
  onDone?: () => void;
}

// Der erste Ich-Satz. Wenn die Engine schon einen Mood/Namen liefert, wird der
// Satz daraus weicher personalisiert — sonst der ruhige Default.
function firstSentence(mood: string | undefined, name: string | undefined): string {
  const m = (mood ?? "").trim().toLowerCase();
  if (m && m !== "still" && m !== "—") {
    // z. B. "wach", "ruhig", "neugierig" → "Ich wache auf. Mir ist neugierig."
    return `Ich wache auf. Mir ist ${m}.`;
  }
  if (name && name.trim()) {
    return `Ich wache auf. Ich bin ${name.trim()}.`;
  }
  return "Ich wache auf …";
}

// ── Timing der Sequenz (ms) ──────────────────────────────────────────────
const T_DARK = 280;     // Stille im Dunkeln, bevor der erste Funke kommt
const T_GLOW = 760;     // Glühen + Atemzug bauen sich auf
const T_HOLD = 1180;    // Satz steht, lesbar
const T_TOTAL = 1980;   // danach Exit (AnimatePresence übernimmt den Rest)
const T_REDUCED = 520;  // reduzierte Bewegung: kurz halten, dann Fade

// Der lebende Kern: ein weicher Lichtkreis, der „einatmet".
const coreVariants: Variants = {
  dark: { opacity: 0, scale: 0.6 },
  breathe: {
    opacity: [0, 0.85, 0.62],
    scale: [0.6, 1.06, 1],
    transition: { duration: 1.4, times: [0, 0.55, 1], ease: [0.32, 0.72, 0, 1] },
  },
};

const haloVariants: Variants = {
  dark: { opacity: 0, scale: 0.4 },
  breathe: {
    opacity: [0, 0.5, 0.3],
    scale: [0.4, 1.25, 1.1],
    transition: { duration: 1.6, times: [0, 0.6, 1], ease: [0.32, 0.72, 0, 1] },
  },
};

export default function Awakening({ onDone }: AwakeningProps) {
  const reduce = useReducedMotion();
  const { active } = useSoul();
  const sentence = useMemo(
    () => firstSentence(active?.status?.mood, active?.status?.name),
    [active?.status?.mood, active?.status?.name],
  );

  // visible steuert AnimatePresence (Exit-Animation), done feuert onDone danach.
  const [visible, setVisible] = useState(true);
  // phase: "dark" → "breathe" treibt die Variants (gestaffeltes Glühen).
  const [phase, setPhase] = useState<"dark" | "breathe">("dark");
  // showText: der Satz erscheint erst, wenn der Kern atmet.
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    if (reduce) {
      // Reduzierte Bewegung: Satz sofort zeigen, kurz halten, hart-weich faden.
      setPhase("breathe");
      setShowText(true);
      const t = setTimeout(() => setVisible(false), T_REDUCED);
      return () => clearTimeout(t);
    }
    const timers: number[] = [];
    timers.push(window.setTimeout(() => setPhase("breathe"), T_DARK));
    timers.push(window.setTimeout(() => setShowText(true), T_DARK + T_GLOW * 0.5));
    timers.push(window.setTimeout(() => setVisible(false), T_TOTAL + T_HOLD - 600));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  const t = reduce ? { duration: 0.32 } : spring.gentle;

  return (
    <AnimatePresence onExitComplete={onDone}>
      {visible && (
        <motion.div
          // Vollflächiges Overlay über allem. Sehr dunkles, blickdichtes Material.
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{
            background: "rgba(12, 12, 16, 0.94)",
            WebkitBackdropFilter: "blur(40px) saturate(140%)",
            backdropFilter: "blur(40px) saturate(140%)",
          }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: reduce ? 1 : 1.015 }}
          transition={t}
        >
          <div className="relative flex flex-col items-center gap-9">
            {/* ── Der lebende Kern: Halo + Atemzug-Glühen ── */}
            <div className="relative flex h-28 w-28 items-center justify-center">
              {/* weiter Halo */}
              <motion.div
                aria-hidden
                className="absolute h-28 w-28 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle, rgba(125,122,255,0.55) 0%, rgba(100,210,255,0.18) 45%, transparent 72%)",
                  filter: "blur(10px)",
                }}
                variants={reduce ? undefined : haloVariants}
                initial={reduce ? { opacity: 0.34 } : "dark"}
                animate={reduce ? { opacity: 0.34 } : phase}
              />
              {/* Kern */}
              <motion.div
                aria-hidden
                className={phase === "breathe" && !reduce ? "breathe" : undefined}
                style={{
                  height: 56,
                  width: 56,
                  borderRadius: "9999px",
                  background:
                    "radial-gradient(circle at 50% 42%, rgba(255,255,255,0.96) 0%, rgba(167,166,255,0.9) 38%, rgba(94,92,230,0.72) 100%)",
                  boxShadow:
                    "0 0 28px 6px rgba(125,122,255,0.45), inset 0 1px 2px rgba(255,255,255,0.6)",
                  // --breath-rate steuert das CSS-„Atmen" (siehe index.css .breathe)
                  ["--breath-rate" as string]: "4s",
                }}
                variants={reduce ? undefined : coreVariants}
                initial={reduce ? { opacity: 0.92 } : "dark"}
                animate={reduce ? { opacity: 0.92 } : phase}
              />
            </div>

            {/* ── Der erste Ich-Satz ── */}
            <AnimatePresence>
              {showText && (
                <motion.p
                  key="sentence"
                  className="num text-center"
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "var(--t-largetitle)",
                    lineHeight: "var(--t-largetitle-lh)",
                    fontWeight: 300,
                    letterSpacing: "0.01em",
                    color: "var(--color-label)",
                    textShadow: "0 0 18px rgba(125,122,255,0.35)",
                  }}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, filter: reduce ? "blur(0px)" : "blur(4px)" }}
                  transition={reduce ? { duration: 0.28 } : spring.gentle}
                >
                  {sentence}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
