// ⌘K Command-Palette — Raycast/Linear-Logik. Fuzzy-Suche über alle Module + Aktionen.
// Tastatur-first: ↑↓ navigieren, ⏎ primär (toggle/öffnen), ⌘⏎ trigger, Esc raus.
// Apple: .material-popover, AnimatePresence + spring.gentle (gleitet herab),
// List-Rows 44px, Klartext (Ich-Form) aus explain.ts, Accent-Selection.

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, Power, PowerOff, Zap, Lock, Eye, CornerDownLeft } from "lucide-react";
import { useRegistry, type ModuleView } from "../lib/useRegistry";
import { useUI } from "../lib/ui";
import { statusDot } from "../lib/moduleMeta";
import { explainModule } from "../lib/explain";
import { useSpring } from "../lib/motion";

interface Cmd {
  key: string;
  module: ModuleView;
  kind: "toggle" | "trigger" | "open";
  title: string;
  hint: string; // rechte Spalte (Aktion)
  score: number;
}

// Sehr leichte Fuzzy-Bewertung: Prefix > Substring-Wortanfang > enthält.
function fuzzy(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const i = t.indexOf(q);
  if (i === 0) return 100;
  if (i > 0) {
    // Wortanfang höher werten
    return t[i - 1] === " " ? 70 : 40 - Math.min(i, 30);
  }
  // verstreute Zeichen (acronym-artig)
  let qi = 0;
  for (let k = 0; k < t.length && qi < q.length; k++) if (t[k] === q[qi]) qi++;
  return qi === q.length ? 10 : -1;
}

export default function CommandPalette() {
  const { paletteOpen, setPaletteOpen, inspect } = useUI();
  const reg = useRegistry();
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sheet = useSpring("gentle");

  // Beim Öffnen: Feld leeren, Fokus, Auswahl zurück.
  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setSel(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  const q = query.trim().toLowerCase();

  const cmds = useMemo<Cmd[]>(() => {
    const out: Cmd[] = [];
    for (const m of reg.modules) {
      const base = fuzzy(q, m.name) * 1.0 + fuzzy(q, m.id) * 0.6;
      if (q && base <= 0) continue;
      // Primär-Befehl je nach Steuerbarkeit
      if (m.toggleable) {
        out.push({
          key: `${m.id}:toggle`,
          module: m,
          kind: "toggle",
          title: m.name,
          hint: m.enabled === true ? "Deaktivieren" : "Aktivieren",
          score: base + (m.enabled === true ? 1 : 0),
        });
      } else if (m.triggerable) {
        out.push({ key: `${m.id}:trigger`, module: m, kind: "trigger", title: m.name, hint: "Auslösen", score: base });
      } else {
        out.push({ key: `${m.id}:open`, module: m, kind: "open", title: m.name, hint: m.locked ? "Gesichert" : "Anzeigen", score: base });
      }
      // Zusatz: Trigger als eigener Befehl, falls toggleable UND triggerable (selten)
      if (m.toggleable && m.triggerable) {
        out.push({ key: `${m.id}:trigger2`, module: m, kind: "trigger", title: `${m.name} auslösen`, hint: "Trigger", score: base - 1 });
      }
    }
    out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return out.slice(0, 40);
  }, [reg.modules, q]);

  useEffect(() => setSel(0), [q]);

  // Ausgewähltes Element ins Sichtfeld scrollen.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${sel}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = async (cmd: Cmd, forceTrigger = false) => {
    const m = cmd.module;
    if (forceTrigger && m.triggerable) {
      await reg.control(m.id, "trigger");
      setPaletteOpen(false);
      return;
    }
    if (cmd.kind === "toggle") {
      await reg.control(m.id, m.enabled === true ? "disable" : "enable");
      setPaletteOpen(false);
    } else if (cmd.kind === "trigger") {
      await reg.control(m.id, "trigger");
      setPaletteOpen(false);
    } else {
      inspect(m.id);
      setPaletteOpen(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, cmds.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = cmds[sel];
      if (cmd) run(cmd, e.metaKey || e.ctrlKey);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setPaletteOpen(false);
    }
  };

  return (
    <AnimatePresence>
      {paletteOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{ background: "rgba(0,0,0,0.32)", paddingTop: "14vh" }}
          onMouseDown={() => setPaletteOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={sheet}
            className="material-popover w-[600px] max-w-[90vw] overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Eingabe */}
            <div className="flex items-center gap-3 border-b border-white/8 px-4" style={{ height: 52 }}>
              <Search size={17} style={{ color: "var(--color-label3)" }} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="Modul oder Aktion…"
                className="w-full bg-transparent text-label outline-none placeholder:text-label3"
                style={{ fontSize: 15 }}
                spellCheck={false}
                autoComplete="off"
              />
              <kbd className="rounded px-1.5 py-0.5 text-[10px] text-label3" style={{ background: "var(--fill-2)" }}>esc</kbd>
            </div>

            {/* Trefferliste */}
            <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1.5">
              {cmds.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-label3">Keine Treffer</div>
              ) : (
                cmds.map((cmd, i) => <Row key={cmd.key} cmd={cmd} active={i === sel} idx={i} onHover={() => setSel(i)} onRun={() => run(cmd)} />)
              )}
            </div>

            {/* Fußleiste */}
            <div className="flex items-center gap-4 border-t border-white/8 px-4 py-2 text-[10.5px] text-label3">
              <Hint k="↑↓" t="navigieren" />
              <Hint k="⏎" t="primär" />
              <Hint k="⌘⏎" t="auslösen" />
              <span className="num ml-auto">{cmds.length} Treffer</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Row({
  cmd, active, idx, onHover, onRun,
}: {
  cmd: Cmd; active: boolean; idx: number; onHover: () => void; onRun: () => void;
}) {
  const m = cmd.module;
  const dot = statusDot(m);
  const ex = explainModule(m.id, m.name);
  const Icon = m.locked ? Lock : cmd.kind === "trigger" ? Zap : cmd.kind === "open" ? Eye : m.enabled === true ? PowerOff : Power;
  return (
    <div
      data-idx={idx}
      onMouseMove={onHover}
      onClick={onRun}
      className="mx-1.5 flex min-h-[44px] cursor-pointer items-center gap-3 rounded-[6px] px-3"
      style={{ background: active ? "var(--color-accent)" : "transparent" }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot.color, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)" }} />
      <Icon size={14} style={{ color: active ? "#fff" : "var(--color-label2)" }} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium" style={{ color: active ? "#fff" : "var(--color-label)" }}>{cmd.title}</div>
        <div className="truncate text-[10.5px]" style={{ color: active ? "rgba(255,255,255,0.75)" : "var(--color-label3)" }}>{ex.ichForm}</div>
      </div>
      <span className="shrink-0 text-[11px] font-medium" style={{ color: active ? "#fff" : "var(--color-label3)" }}>{cmd.hint}</span>
      {active && <CornerDownLeft size={12} style={{ color: "#fff" }} />}
    </div>
  );
}

function Hint({ k, t }: { k: string; t: string }) {
  return (
    <span className="flex items-center gap-1">
      <kbd className="rounded px-1 py-0.5 text-[10px] text-label2" style={{ background: "var(--fill-2)" }}>{k}</kbd>
      {t}
    </span>
  );
}
