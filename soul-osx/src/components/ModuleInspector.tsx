// Modul-Inspector — Slide-over von rechts (Linear/Xcode-Inspector-Logik).
// Apple: gleitet mit spring.gentle herein, Material wie .material-popover,
// gefüllte Status-Punkte ohne Glow, Klartext (Ich-Form + Wirkung) aus explain.ts,
// kritische Module → Schloss statt Schalter. Ein Modul tief: Live-Endpoint-Daten,
// zugehörige Bus-Events und Aktions-Buttons passend zum control-Typ.

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Zap, Power, PowerOff, Lock, RefreshCw, Radio } from "lucide-react";
import { usePoll } from "../lib/usePoll";
import { useSoul } from "../lib/store";
import JsonView from "./JsonView";
import ModuleToggle from "./ModuleToggle";
import type { ControlResult, ModuleView } from "../lib/useRegistry";
import { controlLabel, statusDot, statusWord } from "../lib/moduleMeta";
import { explainModule, humanize } from "../lib/explain";
import { useSpring } from "../lib/motion";
import type { BusEvent } from "../lib/types";

function timeAgo(ts?: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export default function ModuleInspector({
  module,
  busy,
  onClose,
  onControl,
}: {
  module: ModuleView | null;
  busy: boolean;
  onClose: () => void;
  onControl: (id: string, action: "enable" | "disable" | "trigger") => Promise<ControlResult>;
}) {
  const slide = useSpring("gentle");
  return (
    <AnimatePresence>
      {module && (
        <>
          {/* Backdrop — nur klick-zum-schließen, dezent (kein schwerer Dimm) */}
          <motion.div
            className="fixed inset-0 z-30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            style={{ background: "rgba(0,0,0,0.18)" }}
          />
          <motion.aside
            key={module.id}
            className="material-popover fixed right-0 top-0 z-40 flex h-full w-[360px] flex-col"
            style={{ borderRadius: 0, borderLeft: "0.5px solid rgba(255,255,255,0.12)" }}
            initial={{ x: 380 }}
            animate={{ x: 0 }}
            exit={{ x: 380 }}
            transition={slide}
          >
            <InspectorBody module={module} busy={busy} onClose={onClose} onControl={onControl} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function InspectorBody({
  module: m,
  busy,
  onClose,
  onControl,
}: {
  module: ModuleView;
  busy: boolean;
  onClose: () => void;
  onControl: (id: string, action: "enable" | "disable" | "trigger") => Promise<ControlResult>;
}) {
  const { events } = useSoul();
  const { data, error, loading } = usePoll(m.endpoint ?? null, 6000);
  const dot = statusDot(m);
  const ex = explainModule(m.id, m.name);
  // Kritisch = Schloss; locked aus Registry ODER kritisch aus explain.ts.
  const locked = m.locked || ex.kritisch === true;

  // Bus-Events, die dieses Modul betreffen (manifest events) — aus dem Live-Ringpuffer.
  const eventSet = useMemo(() => new Set(m.events), [m.events]);
  const related = useMemo(
    () => events.filter((e: BusEvent) => e.type && eventSet.has(e.type)).slice(-12).reverse(),
    [events, eventSet]
  );

  return (
    <>
      {/* Kopf */}
      <div className="flex items-start gap-3 px-5 pb-3 pt-5">
        <span
          className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: dot.color, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)" }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-label" style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>{m.name}</h2>
            {locked && <Lock size={12} style={{ color: "var(--color-label3)" }} />}
          </div>
          {/* Klartext — Ich-Form (was dieses Organ tut) */}
          <div className="mt-1 text-label2" style={{ fontSize: 12, lineHeight: "16px" }}>{ex.ichForm}</div>
          <div className="mt-1.5 flex items-center gap-2 text-label3" style={{ fontSize: 10 }}>
            <span className="font-mono">{m.id}</span>
            <span>·</span>
            <span>{m.region.name.split(" · ")[0]}</span>
            <span>·</span>
            <span>{controlLabel(m.control)}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-[6px] p-1.5 text-label2 transition-colors hover:bg-white/10 hover:text-label"
          title="Schließen (Esc)"
        >
          <X size={15} />
        </button>
      </div>

      {/* Status-Karte + Schalter */}
      <div className="card mx-5 mb-4 flex items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <div className="label">Status</div>
          <div className="mt-0.5" style={{ fontSize: 14, fontWeight: 510, color: dot.color }}>{statusWord(m)}</div>
          {ex.wirkung && <div className="mt-0.5 truncate text-label3" style={{ fontSize: 11 }}>{ex.wirkung}</div>}
        </div>
        {locked ? (
          <ModuleToggle on={true} locked title="Sicherheitskritisch — gesichert" />
        ) : m.toggleable ? (
          <ModuleToggle
            on={m.enabled}
            busy={busy}
            onToggle={(next) => onControl(m.id, next ? "enable" : "disable")}
            title="Modul umschalten"
          />
        ) : null}
      </div>

      {/* Scroll-Bereich */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {/* Aktionen */}
        <div className="mb-4 flex flex-wrap gap-2">
          {m.triggerable && (
            <ActionBtn
              icon={<Zap size={13} />}
              label="Auslösen"
              busy={busy}
              onClick={() => onControl(m.id, "trigger")}
            />
          )}
          {!locked && m.toggleable && m.enabled !== true && (
            <ActionBtn
              icon={<Power size={13} />}
              label="Aktivieren"
              busy={busy}
              onClick={() => onControl(m.id, "enable")}
            />
          )}
          {!locked && m.toggleable && m.enabled === true && (
            <ActionBtn
              icon={<PowerOff size={13} />}
              label="Deaktivieren"
              variant="secondary"
              busy={busy}
              onClick={() => onControl(m.id, "disable")}
            />
          )}
          {locked && (
            <div className="flex items-center gap-1.5 rounded-[6px] px-3 text-label3"
              style={{ height: 28, fontSize: 12, background: "var(--fill-3)" }}>
              <Lock size={12} /> Sicherheitskritisch — nicht abschaltbar
            </div>
          )}
          {!m.toggleable && !m.triggerable && !locked && (
            <div className="text-label3" style={{ fontSize: 12 }}>Nur-Lese-Modul — kein sicherer Schalter.</div>
          )}
        </div>

        {/* Live-Daten */}
        {m.endpoint ? (
          <Section title="Live-Daten" sub={m.endpoint}>
            {error ? (
              <div style={{ fontSize: 12, color: "var(--color-red)" }}>{error.slice(0, 120)}</div>
            ) : loading && !data ? (
              <div className="relative h-12 overflow-hidden rounded-[6px] bg-white/5">
                <div className="shimmer absolute inset-0" />
              </div>
            ) : data != null ? (
              <div className="card p-3">
                <JsonView data={data} />
              </div>
            ) : (
              <div className="text-label3" style={{ fontSize: 12 }}>— keine Daten —</div>
            )}
          </Section>
        ) : (
          <Section title="Live-Daten">
            <div className="text-label3" style={{ fontSize: 12 }}>Dieses Modul stellt keinen Snapshot-Endpunkt bereit.</div>
          </Section>
        )}

        {/* Zugehörige Events */}
        {m.events.length > 0 && (
          <Section title="Bus-Events" sub={m.events.join(" · ")}>
            {related.length === 0 ? (
              <div className="flex items-center gap-2 text-label3" style={{ fontSize: 12 }}>
                <Radio size={12} /> wartet auf Signale…
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <AnimatePresence initial={false}>
                  {related.map((e, i) => (
                    <motion.div
                      key={(e.id ?? i) + "-" + i}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5"
                      style={{ background: "var(--fill-3)" }}
                    >
                      <span className="truncate text-label2" style={{ fontSize: 11 }}>{humanize(e)}</span>
                      <span className="num shrink-0 text-label3" style={{ fontSize: 10 }}>{timeAgo(e.ts)}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </Section>
        )}
      </div>
    </>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="label">{title}</span>
        {sub && <span className="truncate font-mono text-[10px] text-label3">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  variant = "primary",
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  variant?: "primary" | "secondary";
  busy: boolean;
  onClick: () => void;
}) {
  const primary = variant === "primary";
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      disabled={busy}
      className="flex items-center gap-1.5 rounded-[6px] px-3 transition-[filter,opacity] hover:brightness-110 disabled:opacity-50"
      style={{
        height: 28,
        fontSize: 12,
        fontWeight: 510,
        background: primary ? "var(--color-accent)" : "var(--fill-1)",
        color: primary ? "#fff" : "var(--color-label)",
      }}
    >
      {busy ? <RefreshCw size={13} className="animate-spin" /> : icon}
      {label}
    </motion.button>
  );
}
