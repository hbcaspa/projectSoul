// Control-Plane — Vollbild-Operator-View über alle Module (macOS System-Settings).
// Region-Sidebar links (L1), rechts gruppierte Inset-Karten (.card) mit 44px-List-Rows:
// Name · Ich-Form-Klartext · Status-Dot · Live-Kurzwert · macOS-Switch / Schloss.
// Suche + Segmented-Filter oben. Klick auf Zeile → Inspector. Idle steht still.

import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, Lock, Zap, ChevronRight, Command, AlertTriangle, RefreshCw } from "lucide-react";
import { REGIONS } from "../lib/manifest";
import { useRegistry, type ModuleView, type ControlResult } from "../lib/useRegistry";
import { useUI } from "../lib/ui";
import { useSpring } from "../lib/motion";
import ModuleToggle from "./ModuleToggle";
import LiveValue from "./LiveValue";
import { statusDot, statusWord } from "../lib/moduleMeta";
import { explainModule } from "../lib/explain";
import ModuleInspector from "./ModuleInspector";

type Filter = "all" | "active" | "toggleable";

// Kritisch = aus Registry gesperrt ODER explain.kritisch.
function isLocked(m: ModuleView): boolean {
  return m.locked === true || explainModule(m.id, m.name).kritisch === true;
}

export default function ControlPlane() {
  const reg = useRegistry();
  const { inspectId, inspect, togglePalette } = useUI();
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<string | null>(null); // null = alle Regionen
  const [filter, setFilter] = useState<Filter>("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const busyId = reg.busyId;

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return reg.modules.filter((m) => {
      if (region && m.region.id !== region) return false;
      if (filter === "active" && m.enabled !== true) return false;
      if (filter === "toggleable" && !m.toggleable && !m.triggerable) return false;
      if (q && !(`${m.name} ${m.id} ${m.region.name}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [reg.modules, region, filter, q]);

  // Nach Region gruppieren (Reihenfolge = REGIONS), nur Regionen mit Treffern.
  const grouped = useMemo(() => {
    return REGIONS.map((r) => ({
      region: r,
      mods: filtered.filter((m) => m.region.id === r.id),
    })).filter((g) => g.mods.length > 0);
  }, [filtered]);

  const counts = useMemo(() => {
    const byRegion: Record<string, number> = {};
    for (const m of reg.modules) byRegion[m.region.id] = (byRegion[m.region.id] || 0) + 1;
    return { total: reg.modules.length, byRegion };
  }, [reg.modules]);

  const handleControl = (id: string, action: "enable" | "disable" | "trigger"): Promise<ControlResult> =>
    reg.control(id, action);

  const inspected = reg.modules.find((m) => m.id === inspectId) || null;

  return (
    <div className="card surface relative flex h-full min-h-0 overflow-hidden">
      {/* ── Region-Sidebar (L1) ──────────────────────────────── */}
      <nav className="surface-sidebar flex w-[212px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-white/8 p-2.5">
        <div className="px-2 pb-2 pt-1">
          <div className="text-label" style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>Module</div>
          <div className="num text-label3" style={{ fontSize: 11 }}>{counts.total} Organe · 6 Regionen</div>
        </div>
        <RegionItem label="Alle Module" count={counts.total} active={region === null} onClick={() => setRegion(null)} dot="var(--color-label2)" />
        <div className="my-1 h-px bg-white/6" />
        {REGIONS.map((r) => (
          <RegionItem
            key={r.id}
            label={r.name.split(" · ")[0]}
            sub={r.name.split(" · ")[1]}
            count={counts.byRegion[r.id] || 0}
            active={region === r.id}
            onClick={() => setRegion(region === r.id ? null : r.id)}
            dot={r.color}
          />
        ))}
        <div className="mt-auto px-2 pt-3">
          <button
            onClick={togglePalette}
            className="flex w-full items-center justify-center gap-1.5 rounded-[6px] text-label2 transition-colors hover:bg-white/8 hover:text-label"
            style={{ height: 28, fontSize: 11, background: "var(--fill-3)" }}
          >
            <Command size={11} /> Schnellzugriff · ⌘K
          </button>
        </div>
      </nav>

      {/* ── Liste ────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Such-/Filterleiste */}
        <div className="flex shrink-0 items-center gap-2 border-b border-white/8 px-4 py-2.5">
          <div className="flex flex-1 items-center gap-2 rounded-[6px] px-2.5"
            style={{ height: 28, background: "var(--fill-3)", border: "0.5px solid rgba(255,255,255,0.08)" }}>
            <Search size={13} style={{ color: "var(--color-label3)" }} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Module durchsuchen…"
              className="w-full bg-transparent text-label outline-none placeholder:text-label3"
              style={{ fontSize: 13 }}
              spellCheck={false}
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-label3 hover:text-label">✕</button>
            )}
          </div>
          <Segmented
            options={[
              { id: "all", label: "Alle" },
              { id: "active", label: "Aktiv" },
              { id: "toggleable", label: "Steuerbar" },
            ]}
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
          />
          <button
            onClick={reg.refetch}
            className="rounded-[6px] p-1.5 text-label2 transition-colors hover:bg-white/8 hover:text-label"
            title="Neu laden"
          >
            <RefreshCw size={13} className={reg.loading ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Inhalt */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {reg.unsupported ? (
            <Empty
              icon={<AlertTriangle size={22} />}
              title="Registry nicht verfügbar"
              text="Diese Engine kennt /api/modules/registry noch nicht. Engine aktualisieren (module-control.js)."
            />
          ) : reg.error && reg.modules.length === 0 ? (
            <Empty icon={<AlertTriangle size={22} />} title="Verbindungsfehler" text={reg.error.slice(0, 160)} />
          ) : reg.loading && reg.modules.length === 0 ? (
            <SkeletonList />
          ) : grouped.length === 0 ? (
            <Empty title="Keine Treffer" text="Suche oder Filter anpassen." />
          ) : (
            <div className="flex flex-col gap-6">
              {grouped.map((g) => (
                <section key={g.region.id}>
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: g.region.color, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)" }} />
                    <span className="label">{g.region.name}</span>
                    <span className="num text-label3" style={{ fontSize: 10 }}>{g.mods.length}</span>
                  </div>
                  <div className="card overflow-hidden">
                    {g.mods.map((m, i) => (
                      <ModuleRow
                        key={m.id}
                        m={m}
                        first={i === 0}
                        busy={busyId === m.id}
                        onOpen={() => inspect(m.id)}
                        onControl={handleControl}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      <ModuleInspector
        module={inspected}
        busy={busyId === inspectId}
        onClose={() => inspect(null)}
        onControl={handleControl}
      />
    </div>
  );
}

// ── Modul-Zeile (44px List-Row) ───────────────────────────────
function ModuleRow({
  m,
  first,
  busy,
  onOpen,
  onControl,
}: {
  m: ModuleView;
  first: boolean;
  busy: boolean;
  onOpen: () => void;
  onControl: (id: string, action: "enable" | "disable" | "trigger") => Promise<ControlResult>;
}) {
  const dot = statusDot(m);
  const ex = explainModule(m.id, m.name);
  const locked = isLocked(m);
  return (
    <div
      onClick={onOpen}
      className="group flex min-h-[44px] cursor-pointer items-center gap-3 px-3.5 transition-colors hover:bg-white/4"
      style={{ borderTop: first ? "none" : "0.5px solid rgba(255,255,255,0.06)" }}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: dot.color, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)" }}
      />
      <div className="min-w-0 flex-1 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-label" style={{ fontSize: 13, fontWeight: 500 }}>{m.name}</span>
          {locked && <Lock size={10} style={{ color: "var(--color-label3)" }} />}
        </div>
        <span className="block truncate text-label3" style={{ fontSize: 11 }}>{ex.ichForm}</span>
      </div>

      {/* Live-Kurzwert (nur wenn Endpoint vorhanden) — sonst Status-Wort */}
      <div className="hidden shrink-0 sm:block">
        {m.endpoint ? (
          <LiveValue endpoint={m.endpoint} fallback={statusWord(m)} />
        ) : (
          <span className="text-label3" style={{ fontSize: 11 }}>{statusWord(m)}</span>
        )}
      </div>

      {/* Steuerung */}
      <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {m.triggerable && !locked && (
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => onControl(m.id, "trigger")}
            disabled={busy || !m.available}
            title="Auslösen"
            className="flex items-center gap-1 rounded-[6px] px-2.5 transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
            style={{ height: 24, fontSize: 11, fontWeight: 510, background: "var(--color-accent)", color: "#fff" }}
          >
            <Zap size={11} /> Trigger
          </motion.button>
        )}
        {locked ? (
          <ModuleToggle on={true} locked title="Sicherheitskritisch — gesichert" />
        ) : m.toggleable ? (
          <ModuleToggle
            on={m.enabled}
            busy={busy}
            onToggle={(next) => onControl(m.id, next ? "enable" : "disable")}
            title={
              !m.available
                ? "Instanz inaktiv — Flag setzen (wirkt ab nächstem Neustart)"
                : "Umschalten"
            }
          />
        ) : !m.triggerable ? (
          <span className="text-label3" style={{ fontSize: 10 }}>—</span>
        ) : null}
        <ChevronRight size={14} className="text-label3 opacity-0 transition-opacity group-hover:opacity-60" />
      </div>
    </div>
  );
}

// ── Sidebar-Region-Eintrag ────────────────────────────────────
function RegionItem({
  label, sub, count, active, onClick, dot,
}: {
  label: string; sub?: string; count: number; active: boolean; onClick: () => void; dot: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left transition-colors"
      style={{ background: active ? "var(--color-accent)" : "transparent" }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: active ? "#fff" : dot, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)" }} />
      <div className="min-w-0 flex-1">
        <div className="truncate" style={{ fontSize: 12.5, fontWeight: 500, color: active ? "#fff" : "var(--color-label2)" }}>{label}</div>
        {sub && <div className="truncate" style={{ fontSize: 10, color: active ? "rgba(255,255,255,0.7)" : "var(--color-label3)" }}>{sub}</div>}
      </div>
      <span className="num shrink-0 rounded-full px-1.5"
        style={{ fontSize: 10, color: active ? "rgba(255,255,255,0.85)" : "var(--color-label3)", background: active ? "rgba(255,255,255,0.18)" : "var(--fill-2)" }}>{count}</span>
    </button>
  );
}

// ── Segmented Control (gleitender layoutId-Indikator) ─────────
function Segmented({
  options, value, onChange,
}: {
  options: { id: string; label: string }[]; value: string; onChange: (v: string) => void;
}) {
  const indicator = useSpring("snappy");
  return (
    <div className="flex items-center gap-0.5 rounded-[7px] p-0.5" style={{ background: "var(--fill-2)", height: 24 }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className="relative rounded-[6px] px-2.5 transition-colors"
            style={{ height: 20, fontSize: 11.5, fontWeight: on ? 500 : 400, color: on ? "var(--color-label)" : "var(--color-label2)" }}
          >
            {on && (
              <motion.span
                layoutId="cp-filter-seg"
                className="absolute inset-0 rounded-[6px]"
                style={{ background: "var(--fill-1)", boxShadow: "0 1px 2px rgba(0,0,0,0.20), inset 0 0.5px 0 rgba(255,255,255,0.10)" }}
                transition={indicator}
              />
            )}
            <span className="relative z-10">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Empty({ icon, title, text }: { icon?: React.ReactNode; title: string; text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      {icon && <div style={{ color: "var(--color-label3)" }}>{icon}</div>}
      <div className="text-label2" style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
      <div className="max-w-xs text-label3" style={{ fontSize: 12 }}>{text}</div>
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="relative h-11 overflow-hidden rounded-[6px] bg-white/4">
          <div className="shimmer absolute inset-0" />
        </div>
      ))}
    </div>
  );
}
