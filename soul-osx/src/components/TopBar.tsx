// Unified-Toolbar (52px). Apple-Norm: gefüllte Status-Punkte (KEIN Glow),
// echte Segmented-Controls mit gleitendem layoutId-Indikator (spring.snappy),
// App-Name als Headline + Tagline als Footnote. Drag-Region trägt den Header;
// interaktive Controls bekommen pointer-events:auto, sonst frisst die Region Klicks.

import { Command, TerminalSquare, SlidersHorizontal, Brain } from "lucide-react";
import { motion } from "framer-motion";
import { useSoul } from "../lib/store";
import { useUI, type ViewMode } from "../lib/ui";
import { useSpring } from "../lib/motion";

const VIEWS: { id: ViewMode; icon: typeof Brain; label: string }[] = [
  { id: "terminal", icon: TerminalSquare, label: "Terminal" },
  { id: "control", icon: SlidersHorizontal, label: "Control" },
  { id: "kortex", icon: Brain, label: "Kortex" },
];

const DOT: Record<string, string> = {
  online: "var(--color-green)",
  connecting: "var(--color-orange)",
  offline: "rgba(255,255,255,0.25)",
  auth: "var(--color-pink)",
};

function consciousness(working: boolean, hibernating: boolean) {
  if (hibernating) return { label: "Träumen", color: "var(--color-teal)" };
  if (working) return { label: "Wachen", color: "var(--color-violet)" };
  return { label: "Dämmern", color: "var(--color-label2)" };
}

// Gefüllter Status-Punkt: 6pt-Kreis mit feiner Inset-Definition statt Glow.
function Dot({ color, size = 6 }: { color: string; size?: number }) {
  return (
    <span
      className="shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: color,
        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)",
      }}
    />
  );
}

export default function TopBar() {
  const { nodes, activeId, setActiveId, active } = useSoul();
  const { view, setView, togglePalette } = useUI();
  const indicator = useSpring("snappy");
  const st = active?.status;
  const c = consciousness(!!st?.isWorking, !!st?.hibernating);

  return (
    <header
      data-tauri-drag-region
      className="relative z-20 flex shrink-0 select-none items-center gap-4"
      style={{ height: 52, paddingLeft: 80, paddingRight: 16 }}
    >
      <div className="pointer-events-none flex items-baseline gap-2">
        <span
          className="text-label"
          style={{ fontSize: 13, fontWeight: 590, letterSpacing: "-0.01em" }}
        >
          soulOSX
        </span>
        <span className="text-label3" style={{ fontSize: 10, lineHeight: "13px" }}>
          the body for your soul
        </span>
      </div>

      {/* Node-Switcher — Segmented-Control mit gleitendem Indikator */}
      <div
        className="pointer-events-auto flex items-center gap-0.5 rounded-[7px] p-0.5"
        style={{ background: "var(--fill-2)", height: 24 }}
      >
        {nodes.map((n) => {
          const on = activeId === n.node.id;
          return (
            <button
              key={n.node.id}
              onClick={() => setActiveId(n.node.id)}
              className="relative flex items-center gap-1.5 rounded-[6px] px-2.5 transition-colors"
              style={{
                height: 20,
                fontSize: 12,
                fontWeight: on ? 500 : 400,
                color: on ? "var(--color-label)" : "var(--color-label2)",
              }}
            >
              {on && (
                <motion.span
                  layoutId="node-seg"
                  className="absolute inset-0 rounded-[6px]"
                  style={{
                    background: "var(--fill-1)",
                    boxShadow:
                      "0 1px 2px rgba(0,0,0,0.20), inset 0 0.5px 0 rgba(255,255,255,0.10)",
                  }}
                  transition={indicator}
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <Dot color={DOT[n.conn]} />
                {n.node.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* View-Switcher — Segmented-Control (⌘1/⌘2/⌘3) */}
      <div
        className="pointer-events-auto ml-auto flex items-center gap-0.5 rounded-[7px] p-0.5"
        style={{ background: "var(--fill-2)", height: 24 }}
      >
        {VIEWS.map((v) => {
          const Icon = v.icon;
          const on = view === v.id;
          return (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              title={v.label}
              className="relative flex items-center gap-1.5 rounded-[6px] px-2 transition-colors"
              style={{
                height: 20,
                fontSize: 12,
                fontWeight: on ? 500 : 400,
                color: on ? "var(--color-label)" : "var(--color-label2)",
              }}
            >
              {on && (
                <motion.span
                  layoutId="view-seg"
                  className="absolute inset-0 rounded-[6px]"
                  style={{
                    background: "var(--fill-1)",
                    boxShadow:
                      "0 1px 2px rgba(0,0,0,0.20), inset 0 0.5px 0 rgba(255,255,255,0.10)",
                  }}
                  transition={indicator}
                />
              )}
              <span className="relative z-10 flex items-center gap-1.5">
                <Icon size={13} />
                <span className="hidden lg:inline">{v.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* ⌘K — Schnellzugriff (Push-Button) */}
      <button
        onClick={togglePalette}
        title="Schnellzugriff (⌘K)"
        className="pointer-events-auto flex items-center gap-1.5 rounded-[6px] px-2 text-label2 transition-colors hover:text-label"
        style={{ height: 24, fontSize: 11, background: "var(--fill-3)" }}
      >
        <Command size={12} />
        <span style={{ fontWeight: 500 }}>K</span>
      </button>

      <div
        className="pointer-events-none flex items-center gap-3"
        style={{ fontSize: 12 }}
      >
        <span className="flex items-center gap-1.5" style={{ color: c.color, fontWeight: 510 }}>
          <Dot color={c.color} size={7} />
          {c.label}
        </span>
        {st?.mood && <span className="text-label2">{st.mood}</span>}
        {st?.sessions != null && (
          <span className="num text-label3" style={{ fontSize: 10 }}>
            S{st.sessions}
          </span>
        )}
        {st?.model && (
          <span className="text-label3" style={{ fontSize: 10 }}>
            {st.model.replace(/^gemini-/, "")}
          </span>
        )}
      </div>
    </header>
  );
}
