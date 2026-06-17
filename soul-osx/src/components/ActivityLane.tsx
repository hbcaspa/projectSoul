import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search, BookOpen, PenLine, Code2, Brain, Heart, Sparkles, Network,
  ShieldCheck, Activity as ActIcon, Waves, Moon,
} from "lucide-react";
import { useSoul } from "../lib/store";
import { humanize } from "../lib/explain";
import { spring, useSpring } from "../lib/motion";
import type { BusEvent } from "../lib/types";

const ICON: Record<string, typeof Search> = {
  search: Search, research: Search, read: BookOpen, write: PenLine, code: Code2,
  think: Brain, analyze: Brain, remember: BookOpen, relate: Heart, reflect: Sparkles,
  plan: Network, dream: Moon, world: Waves, heartbeat: Heart, wake: ActIcon, sleep: Moon,
};
function pickIcon(t = "") {
  for (const k in ICON) if (t.includes(k)) return ICON[k];
  if (t.startsWith("gate") || t.startsWith("hook")) return ShieldCheck;
  if (t.startsWith("pulse")) return Heart;
  if (t.startsWith("cortex") || t.startsWith("mood")) return Sparkles;
  return Network;
}
function accent(t = "") {
  if (t.startsWith("pulse")) return "var(--color-pink)";
  if (t.startsWith("mood") || t.startsWith("cortex")) return "var(--color-orange)";
  if (t.startsWith("gate") || t.startsWith("hook")) return "var(--color-green)";
  if (t.startsWith("memory") || t.startsWith("context")) return "var(--color-teal)";
  if (t.startsWith("capability") || t.startsWith("foundry") || t.startsWith("react")) return "var(--color-violet)";
  return "var(--color-label2)";
}

// Stagger-Container für den Live-Strom: jedes Item fliegt 30ms versetzt ein.
const listVariants = {
  show: { transition: { staggerChildren: 0.03 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: -6 },
  show: { opacity: 1, y: 0, transition: spring.snappy },
};

export default function ActivityLane() {
  const { active, events, lastEvent } = useSoul();
  const t = useSpring("snappy");
  const st = active?.status;
  const pulse = st?.pulse;
  const activity = pulse?.activity || pulse?.type;
  const working = !!st?.isWorking;

  // „Arbeitet gerade" — Shimmer-Ladebalken solange kurz nach dem letzten Event / isWorking
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!lastEvent) return;
    setBusy(true);
    const t = setTimeout(() => setBusy(false), 2400);
    return () => clearTimeout(t);
  }, [lastEvent]);
  const showBar = busy || working;

  const recent = events.slice(-24).reverse();
  const CurIcon = pickIcon(activity || lastEvent?.type);

  // Aktueller Zustand als deutscher Satz (kein roher Typ).
  const headline = activity
    ? humanize({ type: activity, label: pulse?.label } as BusEvent)
    : working
      ? "Ich denke nach"
      : "Ich ruhe";

  return (
    <div className="card surface flex min-h-0 flex-col p-3.5">
      <div className="label mb-2.5">Aktivität</div>

      {/* aktueller Zustand + Ladebalken */}
      <div className="mb-3">
        <div className="flex items-center gap-2.5">
          {/* Kein Infinity-Scale-Loop mehr. Nur ein sanftes Aufleuchten beim
              Wechsel; idle steht still. */}
          <motion.div
            animate={{ opacity: showBar ? 1 : 0.7 }}
            transition={t}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
            style={{ background: "rgba(125,122,255,0.16)", color: "var(--color-violet)" }}
          >
            <CurIcon size={15} />
          </motion.div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-label">
              {headline}
            </div>
            <div className="truncate text-[11px] text-label2">
              {pulse?.label || (showBar ? "verarbeitet…" : "bereit")}
            </div>
          </div>
        </div>
        {/* indeterminierter Ladebalken (Apple-Shimmer) */}
        <div className="relative mt-2.5 h-[3px] overflow-hidden rounded-full bg-white/8">
          {showBar ? (
            <div className="shimmer absolute inset-0 rounded-full" style={{ background: "rgba(125,122,255,0.35)" }} />
          ) : (
            <div className="absolute inset-y-0 left-0 w-1/3 rounded-full" style={{ background: "rgba(255,255,255,0.12)" }} />
          )}
        </div>
      </div>

      {/* Live-Aktivitätsstrom */}
      <div className="label mb-1.5">Soul-Prozesse</div>
      <motion.div
        variants={listVariants}
        animate="show"
        className="-mr-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1"
      >
        <AnimatePresence initial={false}>
          {recent.length === 0 && (
            <div className="py-6 text-center text-[11px] text-label3">— still —</div>
          )}
          {recent.map((ev, i) => {
            const Ic = pickIcon(ev.type);
            const c = accent(ev.type);
            return (
              <motion.div
                key={(ev.id ?? `x${i}`) + "-" + i}
                variants={itemVariants}
                initial="hidden"
                animate="show"
                exit={{ opacity: 0, transition: t }}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5"
                title={ev.type}
              >
                <Ic size={12} style={{ color: c, flexShrink: 0 }} />
                <span className="truncate text-[12px] text-label2">{humanize(ev)}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
