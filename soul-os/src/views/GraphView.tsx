import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

interface Entity { name: string; entityType: string; observations: string[]; }
interface Relation { from: string; to: string; relationType: string; }
interface GraphData { entities: Entity[]; relations: Relation[]; }

const TYPE_COLORS: Record<string, string> = {
  person: "#FF6496", concept: "#00FFC8", project: "#FF9600",
  tool: "#00C8FF", event: "#FFC800", place: "#00FF64", emotion: "#6464FF",
};

function getColor(type: string) { return TYPE_COLORS[type.toLowerCase()] || "#8B80F0"; }

export default function GraphView() {
  const [data, setData] = useState<GraphData | null>(null);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    commands.readSoulFile("knowledge-graph.jsonl")
      .then((content) => {
        const entities: Entity[] = [], relations: Relation[] = [];
        for (const line of content.split("\n").filter(Boolean)) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "entity") entities.push(obj);
            else if (obj.type === "relation") relations.push(obj);
          } catch {}
        }
        setData({ entities, relations });
      })
      .catch(() => setData({ entities: [], relations: [] }));
  }, []);

  if (!data) return (
    <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="animate-pulse text-xs" style={{ color: "var(--text-dim)" }}>...</div>
    </div>
  );

  const q = search.toLowerCase();
  const filtered = q
    ? data.entities.filter((e) => e.name.toLowerCase().includes(q) || e.entityType.toLowerCase().includes(q) || e.observations.some((o) => o.toLowerCase().includes(q)))
    : data.entities;

  const groups: Record<string, Entity[]> = {};
  for (const e of filtered) { if (!groups[e.entityType]) groups[e.entityType] = []; groups[e.entityType].push(e); }

  const selRels = selected ? data.relations.filter((r) => r.from === selected.name || r.to === selected.name) : [];

  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>

      {/* ── Top: Stats + Search ────────────────────────── */}
      <div className="px-8 pt-6 pb-5 flex-shrink-0">
        <div className="grid grid-cols-4 gap-4 mb-5">
          <StatCard value={data.entities.length} label="Entities" color="var(--interessen)" icon={"\u25C6"} />
          <StatCard value={data.relations.length} label="Relations" color="var(--graph)" icon={"\u2194"} />
          <StatCard value={Object.keys(groups).length} label="Types" color="var(--evolution)" icon={"\u25A0"} />
          <StatCard value={filtered.length} label={q ? "Matches" : "Shown"} color="var(--accent)" icon={"\u25CF"} />
        </div>

        {/* Search bar */}
        <div className="relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--text-dim)" }}>
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search entities, types, observations..."
            className="glass-inset w-full pl-12 pr-4 py-3.5 text-sm outline-none"
            style={{ color: "var(--text)", borderRadius: "var(--radius-lg)" }}
          />
          {q && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-[10px]"
              style={{ backgroundColor: "rgba(var(--white-rgb),0.06)", color: "var(--text-dim)" }}
            >
              {"\u2715"}
            </button>
          )}
        </div>
      </div>

      {/* ── Main: Entities + Detail ────────────────────── */}
      <div className="flex-1 flex min-h-0 px-8 pb-6 gap-4">

        {/* Entity grid */}
        <div className="flex-1 overflow-auto pr-1">
          {data.entities.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5" style={{ background: "linear-gradient(135deg, rgba(0,200,255,0.06), rgba(var(--accent-rgb),0.04))", border: "1px solid rgba(0,200,255,0.08)" }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-9 h-9" style={{ color: "var(--interessen)", opacity: 0.4 }}>
                  <circle cx="12" cy="6" r="2" /><circle cx="6" cy="14" r="2" /><circle cx="18" cy="14" r="2" />
                  <path d="M12 8v2M8 13l2-1M16 13l-2-1" /><circle cx="12" cy="12" r="1" fill="currentColor" />
                </svg>
              </div>
              <p className="text-sm font-light" style={{ color: "var(--text-dim)" }}>Empty Graph</p>
              <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>It grows as the soul connects ideas</p>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {Object.entries(groups).map(([type, entities]) => {
                const color = getColor(type);
                return (
                  <div key={type}>
                    <div className="flex items-center gap-2.5 mb-2.5">
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                      <span className="text-xs uppercase tracking-wider font-semibold" style={{ color }}>{type}</span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{entities.length}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {entities.map((entity) => {
                        const isSel = selected?.name === entity.name;
                        const relCount = data.relations.filter((r) => r.from === entity.name || r.to === entity.name).length;
                        return (
                          <button
                            key={entity.name}
                            onClick={() => setSelected(isSel ? null : entity)}
                            className="glass-card glass-card-hover px-5 py-4 text-left cursor-default transition-all"
                            style={{
                              borderColor: isSel ? `${color}4D` : undefined,
                              background: isSel ? `linear-gradient(135deg, ${color}14, rgba(var(--white-rgb),0.01))` : undefined,
                            }}
                          >
                            <div className="text-sm font-medium truncate" style={{ color: isSel ? color : "var(--text-bright)" }}>
                              {entity.name}
                            </div>
                            <div className="flex items-center gap-3 mt-1.5">
                              <span className="text-xs" style={{ color: "var(--text-dim)" }}>{entity.observations.length} obs</span>
                              {relCount > 0 && <span className="text-xs" style={{ color: "var(--text-muted)" }}>{relCount} rel</span>}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-72 glass-card p-6 overflow-auto flex-shrink-0">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="text-base font-semibold" style={{ color: "var(--text-bright)" }}>{selected.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: getColor(selected.entityType) }} />
                  <span className="text-[11px] uppercase tracking-wider" style={{ color: getColor(selected.entityType) }}>{selected.entityType}</span>
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-xs" style={{ background: "rgba(var(--white-rgb),0.04)", color: "var(--text-dim)" }}>
                {"\u2715"}
              </button>
            </div>

            {selected.observations.length > 0 && (
              <div className="mb-6">
                <div className="text-[10px] uppercase tracking-[0.15em] font-semibold mb-2.5" style={{ color: "var(--text-dim)" }}>Observations</div>
                <div className="flex flex-col gap-2.5">
                  {selected.observations.map((obs, i) => (
                    <div key={i} className="text-xs leading-relaxed pl-3.5 py-2 rounded-r-lg" style={{ color: "var(--text)", borderLeft: `2px solid ${getColor(selected.entityType)}25`, background: "rgba(var(--white-rgb),0.01)" }}>
                      {obs}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-[10px] uppercase tracking-[0.15em] font-semibold mb-2.5" style={{ color: "var(--text-dim)" }}>
                Relations {selRels.length > 0 && `(${selRels.length})`}
              </div>
              {selRels.length === 0 ? (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>No connections</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {selRels.map((rel, i) => {
                    const isFrom = rel.from === selected.name;
                    const other = isFrom ? rel.to : rel.from;
                    return (
                      <button key={i} onClick={() => { const t = data.entities.find((x) => x.name === other); if (t) setSelected(t); }}
                        className="flex items-center gap-2.5 text-xs text-left px-3.5 py-2.5 rounded-lg transition-all cursor-default"
                        style={{ background: "rgba(var(--white-rgb),0.02)", border: "1px solid rgba(var(--white-rgb),0.03)" }}>
                        <span style={{ color: "var(--text-muted)" }}>{isFrom ? "\u2192" : "\u2190"}</span>
                        <span className="flex-1 truncate" style={{ color: "var(--bonds)" }}>{other}</span>
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{rel.relationType}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ value, label, color, icon }: { value: number; label: string; color: string; icon: string }) {
  return (
    <div className="glass-card p-5 text-center">
      <div className="flex items-center justify-center gap-2.5">
        <span className="text-xs" style={{ color, opacity: 0.5 }}>{icon}</span>
        <span className="text-2xl font-light" style={{ color }}>{value}</span>
      </div>
      <div className="text-[10px] uppercase tracking-wider mt-1.5" style={{ color: "var(--text-dim)" }}>{label}</div>
    </div>
  );
}
