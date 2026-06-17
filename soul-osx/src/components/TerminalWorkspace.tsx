import { useState } from "react";
import { Plus, X, TerminalSquare } from "lucide-react";
import Terminal from "./Terminal";

interface Tab {
  key: string;
  title: string;
}

let counter = 0;
const nextKey = () => `t${++counter}`;

export default function TerminalWorkspace() {
  const [tabs, setTabs] = useState<Tab[]>([{ key: nextKey(), title: "soul" }]);
  const [active, setActive] = useState(tabs[0].key);

  const add = () => {
    const t = { key: nextKey(), title: "zsh" };
    setTabs((ts) => [...ts, t]);
    setActive(t.key);
  };

  const close = (key: string) => {
    setTabs((ts) => {
      const i = ts.findIndex((t) => t.key === key);
      const rest = ts.filter((t) => t.key !== key);
      if (rest.length === 0) {
        const t = { key: nextKey(), title: "soul" };
        setActive(t.key);
        return [t];
      }
      if (key === active) setActive(rest[Math.min(i, rest.length - 1)].key);
      return rest;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tab-Leiste — Apple-Segmented-Look */}
      <div className="flex items-center gap-1 px-2 pb-2">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className="group flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition"
            style={{
              background: active === t.key ? "rgba(255,255,255,0.1)" : "transparent",
              color: active === t.key ? "var(--color-label)" : "var(--color-label2)",
            }}
          >
            <TerminalSquare size={13} className="opacity-70" />
            <span className="font-medium">{t.title} {i + 1}</span>
            <span
              onClick={(e) => { e.stopPropagation(); close(t.key); }}
              className="ml-0.5 rounded p-0.5 opacity-0 transition group-hover:opacity-60 hover:!opacity-100 hover:bg-white/10"
            >
              <X size={11} />
            </span>
          </button>
        ))}
        <button
          onClick={add}
          className="rounded-lg p-1.5 text-label2 transition hover:bg-white/10 hover:text-label"
          title="Neues Terminal (landet im soul-Verzeichnis)"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Terminals — alle gemountet, nur aktives sichtbar (PTY + Scrollback bleiben) */}
      <div className="card relative min-h-0 flex-1 overflow-hidden">
        {tabs.map((t) => (
          <div
            key={t.key}
            className="absolute inset-0"
            style={{ visibility: active === t.key ? "visible" : "hidden", zIndex: active === t.key ? 1 : 0 }}
          >
            <Terminal id={t.key} active={active === t.key} onExit={() => {}} />
          </div>
        ))}
      </div>
    </div>
  );
}
