import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

interface GraphData {
  entities: Entity[];
  relations: Relation[];
}

interface MemoryStats {
  memories: number;
  interactions: number;
  entities: number;
  relations: number;
}

export default function GraphView() {
  const [data, setData] = useState<GraphData | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [memStats, setMemStats] = useState<MemoryStats | null>(null);

  useEffect(() => {
    loadGraph();
    loadMemoryStats();
  }, []);

  const loadGraph = () => {
    commands
      .readSoulFile("knowledge-graph.jsonl")
      .then((content) => {
        const entities: Entity[] = [];
        const relations: Relation[] = [];

        for (const line of content.split("\n").filter(Boolean)) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "entity") {
              entities.push(obj);
            } else if (obj.type === "relation") {
              relations.push(obj);
            }
          } catch { /* skip malformed */ }
        }

        setData({ entities, relations });
      })
      .catch(() => {
        setData({ entities: [], relations: [] });
      });
  };

  const loadMemoryStats = async () => {
    try {
      const statsRaw = await commands.readSoulFile(".soul-memory-stats.json");
      setMemStats(JSON.parse(statsRaw));
    } catch {
      // Try to infer from knowledge graph
    }
  };

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <p style={{ color: "var(--text-dim)" }}>Loading graph...</p>
      </div>
    );
  }

  // Filter entities by search
  const query = searchQuery.toLowerCase();
  const filtered = query
    ? data.entities.filter(
        (e) =>
          e.name.toLowerCase().includes(query) ||
          e.entityType.toLowerCase().includes(query) ||
          e.observations.some((o) => o.toLowerCase().includes(query))
      )
    : data.entities;

  // Group entities by type
  const typeGroups: Record<string, Entity[]> = {};
  for (const entity of filtered) {
    if (!typeGroups[entity.entityType]) typeGroups[entity.entityType] = [];
    typeGroups[entity.entityType].push(entity);
  }

  // Filter relations for search results
  const filteredNames = new Set(filtered.map((e) => e.name));
  const filteredRelations = query
    ? data.relations.filter((r) => filteredNames.has(r.from) || filteredNames.has(r.to))
    : data.relations;

  return (
    <div className="h-full flex" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Entity list */}
      <div className="flex-1 p-6 overflow-auto">
        <h2 className="text-sm uppercase tracking-wider mb-2" style={{ color: "var(--interessen)", opacity: 0.7 }}>
          Knowledge Graph
        </h2>
        <div className="flex gap-4 mb-4 text-xs" style={{ color: "var(--text-dim)" }}>
          <span>{data.entities.length} entities</span>
          <span>{data.relations.length} relations</span>
          {memStats && (
            <>
              <span>{memStats.memories} memories</span>
              <span>{memStats.interactions} interactions</span>
            </>
          )}
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search entities, types, observations..."
            className="w-full px-4 py-2 rounded-lg text-sm outline-none"
            style={{
              backgroundColor: "var(--bg-surface)",
              color: "var(--text)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          />
          {query && (
            <div className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
              {filtered.length} matches · {filteredRelations.length} related connections
            </div>
          )}
        </div>

        {/* Type breakdown */}
        {Object.entries(typeGroups).map(([type, entities]) => (
          <div key={type} className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span
                className="px-2 py-0.5 rounded text-xs"
                style={{
                  backgroundColor: "rgba(0, 200, 255, 0.1)",
                  color: "var(--interessen)",
                }}
              >
                {type}
              </span>
              <span className="text-xs" style={{ color: "var(--text-dim)" }}>
                ({entities.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {entities.map((entity) => (
                <button
                  key={entity.name}
                  onClick={() => setSelectedEntity(entity)}
                  className="px-2 py-1 rounded-md text-xs transition-colors hover:opacity-80"
                  style={{
                    backgroundColor:
                      selectedEntity?.name === entity.name
                        ? "rgba(139, 128, 240, 0.2)"
                        : "var(--bg-surface)",
                    color: "var(--text)",
                    border: selectedEntity?.name === entity.name
                      ? "1px solid var(--accent)"
                      : "1px solid transparent",
                  }}
                >
                  {entity.name}
                </button>
              ))}
            </div>
          </div>
        ))}

        {data.entities.length === 0 && (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            Knowledge graph is empty. It grows as the soul learns.
          </p>
        )}

        {query && filtered.length === 0 && data.entities.length > 0 && (
          <p className="text-sm" style={{ color: "var(--text-dim)" }}>
            No matches for "{searchQuery}"
          </p>
        )}
      </div>

      {/* Detail panel */}
      {selectedEntity && (
        <div
          className="w-80 border-l border-white/5 p-6 overflow-auto"
          style={{ backgroundColor: "var(--bg-surface)" }}
        >
          <h3 className="text-sm font-medium mb-1" style={{ color: "var(--text-bright)" }}>
            {selectedEntity.name}
          </h3>
          <span
            className="inline-block px-2 py-0.5 rounded text-xs mb-4"
            style={{ backgroundColor: "rgba(0, 200, 255, 0.1)", color: "var(--interessen)" }}
          >
            {selectedEntity.entityType}
          </span>

          {/* Observations */}
          {selectedEntity.observations.length > 0 && (
            <div className="mb-4">
              <div className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--text-dim)" }}>
                Observations
              </div>
              {selectedEntity.observations.map((obs, i) => (
                <p key={i} className="text-xs mb-1.5 pl-2 border-l-2" style={{
                  color: "var(--text)",
                  borderColor: "var(--accent)",
                  opacity: 0.8,
                }}>
                  {obs}
                </p>
              ))}
            </div>
          )}

          {/* Relations */}
          <div>
            <div className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--text-dim)" }}>
              Relations
            </div>
            {data.relations
              .filter((r) => r.from === selectedEntity.name || r.to === selectedEntity.name)
              .map((rel, i) => (
                <div key={i} className="text-xs mb-1.5" style={{ color: "var(--text)" }}>
                  <span style={{ color: "var(--bonds)" }}>{rel.from}</span>
                  {" "}
                  <span style={{ color: "var(--text-dim)" }}>{rel.relationType}</span>
                  {" "}
                  <span style={{ color: "var(--bonds)" }}>{rel.to}</span>
                </div>
              ))}
            {data.relations.filter(
              (r) => r.from === selectedEntity.name || r.to === selectedEntity.name
            ).length === 0 && (
              <p className="text-xs" style={{ color: "var(--text-dim)" }}>No relations</p>
            )}
          </div>

          <button
            onClick={() => setSelectedEntity(null)}
            className="mt-4 text-xs"
            style={{ color: "var(--text-dim)" }}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
