// Generischer, kompakter Renderer für beliebige Engine-JSON-Antworten.
// Damit deckt soulOSX JEDES Modul ab, ohne 76 handgebaute Ansichten.

function isNum01(n: number) { return n >= 0 && n <= 1; }

function Val({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-label3">—</span>;
  if (typeof v === "boolean")
    return (
      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
        style={{ background: v ? "rgba(48,209,88,0.15)" : "rgba(255,255,255,0.06)", color: v ? "var(--color-green)" : "var(--color-label3)" }}>
        {v ? "an" : "aus"}
      </span>
    );
  if (typeof v === "number") {
    const fixed = Number.isInteger(v) ? String(v) : v.toFixed(3);
    if (isNum01(v) && !Number.isInteger(v)) {
      return (
        <span className="flex items-center gap-1.5">
          <span className="h-1 w-12 overflow-hidden rounded-full bg-white/8">
            <span className="block h-full rounded-full" style={{ width: `${v * 100}%`, background: "var(--color-violet)" }} />
          </span>
          <span className="font-mono text-[11px] text-label2">{fixed}</span>
        </span>
      );
    }
    return <span className="font-mono text-[12px] text-label">{fixed}</span>;
  }
  if (typeof v === "string") {
    const s = v.length > 120 ? v.slice(0, 120) + "…" : v;
    return <span className="text-[12px] text-label2">{s}</span>;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-label3">[ ]</span>;
    if (v.every((x) => typeof x !== "object")) {
      return (
        <div className="flex flex-wrap gap-1">
          {v.slice(0, 12).map((x, i) => (
            <span key={i} className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-label2">{String(x)}</span>
          ))}
          {v.length > 12 && <span className="text-[10px] text-label3">+{v.length - 12}</span>}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-label3">{v.length} Einträge</span>
        {v.slice(0, 6).map((x, i) => (
          <div key={i} className="rounded-lg border border-white/8 p-1.5"><JsonView data={x} /></div>
        ))}
      </div>
    );
  }
  return <JsonView data={v} />;
}

export default function JsonView({ data }: { data: unknown }) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return <Val v={data} />;
  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length === 0) return <span className="text-label3">{"{ }"}</span>;
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-3">
          <span className="shrink-0 font-mono text-[11px] text-label3">{k}</span>
          <div className="min-w-0 text-right">
            {typeof v === "object" && v !== null ? (
              <div className="text-left"><Val v={v} /></div>
            ) : (
              <Val v={v} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
