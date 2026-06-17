import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search, BookOpen, PenLine, Code2, Brain, Heart, Sparkles, Network,
  ShieldCheck, Activity as ActIcon, Waves, Moon,
} from "lucide-react";
import { useSoul } from "../lib/store";
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
function evLabel(ev: BusEvent): string {
  const p = ev as Record<string, unknown>;
  return ((p.label || p.activity || p.description || p.reason || p.type || "") as string).toString();
}

export default function ActivityLane() {
  const { active, events, lastEvent } = useSoul();
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

  return (
    <div className="card surface flex min-h-0 flex-col p-3.5">
      <div className="label mb-2.5">Aktivität</div>

      {/* aktueller Zustand + Ladebalken */}
      <div className="mb-3">
        <div className="flex items-center gap-2.5">
          <motion.div
            animate={showBar ? { scale: [1, 1.12, 1] } : { scale: 1 }}
            transition={{ duration: 1.2, repeat: showBar ? Infinity : 0, ease: "easeInOut" }}
            className="flex h-8 w-8 items-center justify-center rounded-full"
            style={{ background: "rgba(125,122,255,0.16)", color: "var(--color-violet)" }}
          >
            <CurIcon size={15} />
          </motion.div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-label">
              {activity ? activity : working ? "denkt nach" : "ruht"}
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
      <div className="-mr-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
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
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/5"
              >
                <Ic size={12} style={{ color: c, flexShrink: 0 }} />
                <span className="truncate text-[12px] text-label2">{evLabel(ev)}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
