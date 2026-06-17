// Schmale macOS-Sidebar-Nav links (48px). Dezent: aktiver Zustand als
// gefüllte Akzent-Tint-Pille + Akzent-Indikator links, Idle steht still.
// Terminal bleibt erste Klasse (⌘1). Control ⌘2. Kortex ⌘3.

import { TerminalSquare, SlidersHorizontal, Brain } from "lucide-react";
import { motion } from "framer-motion";
import { useUI, type ViewMode } from "../lib/ui";
import { useSpring } from "../lib/motion";

const ITEMS: { id: ViewMode; icon: typeof Brain; label: string; shortcut: string }[] = [
  { id: "terminal", icon: TerminalSquare, label: "Terminal", shortcut: "⌘1" },
  { id: "control", icon: SlidersHorizontal, label: "Control", shortcut: "⌘2" },
  { id: "kortex", icon: Brain, label: "Kortex", shortcut: "⌘3" },
];

export default function ActivityBar() {
  const { view, setView } = useUI();
  const indicator = useSpring("snappy");
  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 pt-1">
      {ITEMS.map((it) => {
        const active = view === it.id;
        const Icon = it.icon;
        return (
          <button
            key={it.id}
            onClick={() => setView(it.id)}
            title={`${it.label} · ${it.shortcut}`}
            className="relative flex h-9 w-9 items-center justify-center rounded-[8px] transition-colors"
            style={{ color: active ? "var(--color-accent)" : "var(--color-label2)" }}
          >
            {/* gefüllte Akzent-Tint-Pille (gleitet zwischen Items) */}
            {active && (
              <motion.span
                layoutId="activitybar-active"
                className="absolute inset-0 rounded-[8px]"
                style={{ background: "color-mix(in srgb, var(--color-accent) 18%, transparent)" }}
                transition={indicator}
              />
            )}
            {/* aktiver Indikator links (macOS-Sidebar) */}
            {active && (
              <motion.span
                layoutId="activitybar-rail"
                className="absolute -left-1 rounded-full"
                style={{ width: 3, height: 18, background: "var(--color-accent)" }}
                transition={indicator}
              />
            )}
            <Icon size={18} strokeWidth={active ? 2 : 1.8} className="relative z-10" />
          </button>
        );
      })}
    </nav>
  );
}
