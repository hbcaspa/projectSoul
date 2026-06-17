import { useSoul } from "../lib/store";

const DOT: Record<string, string> = {
  online: "var(--color-immune)",
  connecting: "var(--color-cortex-warm)",
  offline: "var(--color-fever)",
  auth: "var(--color-pulse)",
};

function consciousness(working: boolean, hibernating: boolean): { label: string; color: string } {
  if (hibernating) return { label: "TRÄUMEN", color: "var(--color-biolumi)" };
  if (working) return { label: "WACHEN", color: "var(--color-synapse)" };
  return { label: "DÄMMERN", color: "var(--color-ash)" };
}

export default function StatusBand() {
  const { nodes, activeId, setActiveId, active } = useSoul();
  const st = active?.status;
  const c = consciousness(!!st?.isWorking, !!st?.hibernating);

  return (
    <header
      data-tauri-drag-region
      className="flex select-none items-center gap-4 px-4 py-2.5"
      style={{ paddingLeft: 84 }} // Platz für macOS-Ampel
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[13px] font-bold tracking-[0.2em] text-bone">DER KORTEX</span>
        <span className="label">soulOSX</span>
      </div>

      {/* Node-Switcher */}
      <div className="flex items-center gap-1 rounded-full border border-membrane bg-tissue/60 p-0.5">
        {nodes.map((n) => (
          <button
            key={n.node.id}
            onClick={() => setActiveId(n.node.id)}
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] transition"
            style={{
              background: activeId === n.node.id ? "var(--color-membrane)" : "transparent",
              color: activeId === n.node.id ? "var(--color-bone)" : "var(--color-ash)",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: DOT[n.conn] }} />
            {n.node.label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-5 text-[11px]">
        <span className="flex items-center gap-1.5 font-mono tracking-wider" style={{ color: c.color }}>
          <span className="h-2 w-2 rounded-full" style={{ background: c.color, boxShadow: `0 0 10px ${c.color}` }} />
          {c.label}
        </span>
        {st?.mood && <Field k="stimmung" v={st.mood} />}
        {st?.ageDays != null && <Field k="alter" v={`${st.ageDays}d`} />}
        {st?.sessions != null && <Field k="session" v={`S${st.sessions}`} />}
        {st?.model && <Field k="modell" v={st.model.replace(/^gemini-/, "g·")} />}
      </div>
    </header>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <span className="flex flex-col items-end leading-none">
      <span className="label">{k}</span>
      <span className="mt-0.5 font-mono text-bone">{v}</span>
    </span>
  );
}
