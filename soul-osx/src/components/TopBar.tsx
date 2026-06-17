import { useSoul } from "../lib/store";

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

export default function TopBar() {
  const { nodes, activeId, setActiveId, active } = useSoul();
  const st = active?.status;
  const c = consciousness(!!st?.isWorking, !!st?.hibernating);

  return (
    <header
      data-tauri-drag-region
      className="relative z-20 flex h-12 select-none items-center gap-4"
      style={{ paddingLeft: 82, paddingRight: 16 }}
    >
      <div className="pointer-events-none flex items-baseline gap-2">
        <span className="text-[13px] font-semibold tracking-tight text-label">soulOSX</span>
        <span className="text-[11px] text-label3">the body for your soul</span>
      </div>

      {/* Node-Switcher — Apple-Segmented-Control */}
      <div className="flex items-center gap-0.5 rounded-[9px] bg-white/8 p-0.5">
        {nodes.map((n) => (
          <button
            key={n.node.id}
            onClick={() => setActiveId(n.node.id)}
            className="flex items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12px] font-medium transition"
            style={{
              background: activeId === n.node.id ? "rgba(255,255,255,0.14)" : "transparent",
              color: activeId === n.node.id ? "var(--color-label)" : "var(--color-label2)",
              boxShadow: activeId === n.node.id ? "0 1px 3px rgba(0,0,0,0.25)" : "none",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: DOT[n.conn] }} />
            {n.node.label}
          </button>
        ))}
      </div>

      <div className="pointer-events-none ml-auto flex items-center gap-4 text-[12px]">
        <span className="flex items-center gap-1.5 font-medium" style={{ color: c.color }}>
          <span className="breathe h-2 w-2 rounded-full" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
          {c.label}
        </span>
        {st?.mood && <span className="text-label2">{st.mood}</span>}
        {st?.sessions != null && <span className="text-label3">S{st.sessions}</span>}
        {st?.model && <span className="text-label3">{st.model.replace(/^gemini-/, "")}</span>}
      </div>
    </header>
  );
}
