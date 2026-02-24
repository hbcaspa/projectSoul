import { useEffect, useState, useRef, useCallback } from "react";
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, type SimulationNodeDatum, type SimulationLinkDatum } from "d3-force";
import { commands } from "../lib/tauri";

/* ── Types ────────────────────────────────────────────────── */

interface RawEntity { name: string; entityType: string; observations: string[]; }
interface RawRelation { from: string; to: string; relationType: string; }

interface GraphNode extends SimulationNodeDatum {
  id: string;
  type: string;
  observations: string[];
  connections: number;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  label: string;
}

/* ── Colors by type ───────────────────────────────────────── */

const TYPE_COLORS: Record<string, string> = {
  person:  "#00ffc8",  // bewusstsein
  concept: "#8b80f0",  // accent
  project: "#c864ff",  // evolution
  tool:    "#00c8ff",  // interessen
  event:   "#ff6b6b",  // heartbeat
  place:   "#64ff8b",  // wachstum
  emotion: "#6464ff",  // traeume
};

function colorFor(type: string): string {
  return TYPE_COLORS[type.toLowerCase()] || "#8b80f0";
}

function radiusFor(connections: number): number {
  return Math.max(6, Math.min(20, 6 + connections * 2));
}

/* ── Component ────────────────────────────────────────────── */

export default function MemoryMapView() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [links, setLinks] = useState<GraphLink[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const simRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null);
  const [, setTick] = useState(0); // force re-renders on simulation tick

  // Load graph data
  useEffect(() => {
    commands.readSoulFile("knowledge-graph.jsonl")
      .then((content) => {
        const entities: RawEntity[] = [];
        const relations: RawRelation[] = [];
        for (const line of content.split("\n").filter(Boolean)) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === "entity") entities.push(obj);
            else if (obj.type === "relation") relations.push(obj);
          } catch { /* ignore */ }
        }

        // Build node connection counts
        const connCounts: Record<string, number> = {};
        for (const r of relations) {
          connCounts[r.from] = (connCounts[r.from] || 0) + 1;
          connCounts[r.to] = (connCounts[r.to] || 0) + 1;
        }

        const graphNodes: GraphNode[] = entities.map((e) => ({
          id: e.name,
          type: e.entityType,
          observations: e.observations,
          connections: connCounts[e.name] || 0,
        }));

        const nodeIds = new Set(graphNodes.map(n => n.id));
        const graphLinks: GraphLink[] = relations
          .filter(r => nodeIds.has(r.from) && nodeIds.has(r.to))
          .map((r) => ({
            source: r.from,
            target: r.to,
            label: r.relationType,
          }));

        setNodes(graphNodes);
        setLinks(graphLinks);
      })
      .catch(() => {
        setNodes([]);
        setLinks([]);
      });
  }, []);

  // Measure container
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // Run simulation
  useEffect(() => {
    if (nodes.length === 0) return;

    const sim = forceSimulation(nodes)
      .force("link", forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(80))
      .force("charge", forceManyBody().strength(-200))
      .force("center", forceCenter(dimensions.width / 2, dimensions.height / 2))
      .force("collide", forceCollide<GraphNode>().radius(d => radiusFor(d.connections) + 8))
      .alphaDecay(0.02)
      .on("tick", () => setTick(t => t + 1));

    simRef.current = sim;
    return () => { sim.stop(); };
  }, [nodes.length, links.length, dimensions.width, dimensions.height]);

  // Drag handlers
  const dragNode = useRef<GraphNode | null>(null);
  const handleMouseDown = useCallback((e: React.MouseEvent, node: GraphNode) => {
    e.preventDefault();
    dragNode.current = node;
    if (simRef.current) {
      node.fx = node.x;
      node.fy = node.y;
      simRef.current.alphaTarget(0.3).restart();
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const node = dragNode.current;
    if (!node || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    node.fx = e.clientX - rect.left;
    node.fy = e.clientY - rect.top;
  }, []);

  const handleMouseUp = useCallback(() => {
    const node = dragNode.current;
    if (node) {
      node.fx = null;
      node.fy = null;
      if (simRef.current) simRef.current.alphaTarget(0);
    }
    dragNode.current = null;
  }, []);

  // Selected node's relations
  const selRelations = selected
    ? links.filter(l => {
        const src = typeof l.source === "object" ? (l.source as GraphNode).id : l.source;
        const tgt = typeof l.target === "object" ? (l.target as GraphNode).id : l.target;
        return src === selected.id || tgt === selected.id;
      })
    : [];

  // Type legend
  const types = [...new Set(nodes.map(n => n.type))];

  // Empty state
  if (nodes.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5" style={{ background: "linear-gradient(135deg, rgba(0,200,255,0.06), rgba(139,128,240,0.03))", border: "1px solid rgba(0,200,255,0.08)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-9 h-9" style={{ color: "var(--interessen)", opacity: 0.4 }}>
            <circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" />
            <path d="M7 6h10M5 8l7 8M19 8l-7 8" />
          </svg>
        </div>
        <p className="text-base font-light" style={{ color: "var(--text-dim)" }}>No memory network yet</p>
        <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>The network grows as the soul learns about people, concepts, and connections</p>
      </div>
    );
  }

  return (
    <div className="h-full flex" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Graph canvas */}
      <div className="flex-1 relative">
        {/* Legend */}
        <div className="absolute top-4 left-4 z-10 flex flex-wrap gap-3">
          {types.map(type => (
            <div key={type} className="flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: "rgba(10,12,20,0.7)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorFor(type) }} />
              <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>{type}</span>
            </div>
          ))}
        </div>

        {/* Stats */}
        <div className="absolute top-4 right-4 z-10 text-right">
          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            {nodes.length} nodes / {links.length} edges
          </span>
        </div>

        <svg
          ref={svgRef}
          className="w-full h-full"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <defs>
            {types.map(type => (
              <radialGradient key={type} id={`glow-${type}`}>
                <stop offset="0%" stopColor={colorFor(type)} stopOpacity="0.3" />
                <stop offset="100%" stopColor={colorFor(type)} stopOpacity="0" />
              </radialGradient>
            ))}
          </defs>

          {/* Links */}
          <g>
            {links.map((link, i) => {
              const src = link.source as GraphNode;
              const tgt = link.target as GraphNode;
              if (src.x == null || tgt.x == null) return null;
              const isHighlight = hovered === src.id || hovered === tgt.id ||
                selected?.id === src.id || selected?.id === tgt.id;
              return (
                <line
                  key={i}
                  x1={src.x} y1={src.y}
                  x2={tgt.x} y2={tgt.y}
                  stroke={isHighlight ? "rgba(139,128,240,0.4)" : "rgba(255,255,255,0.06)"}
                  strokeWidth={isHighlight ? 1.5 : 0.5}
                />
              );
            })}
          </g>

          {/* Link labels (only when selected) */}
          {selected && selRelations.map((link, i) => {
            const src = link.source as GraphNode;
            const tgt = link.target as GraphNode;
            if (src.x == null || tgt.x == null) return null;
            return (
              <text
                key={`label-${i}`}
                x={(src.x! + tgt.x!) / 2}
                y={(src.y! + tgt.y!) / 2 - 4}
                textAnchor="middle"
                fill="rgba(139,128,240,0.6)"
                fontSize="8"
                fontFamily="monospace"
              >
                {link.label}
              </text>
            );
          })}

          {/* Nodes */}
          <g>
            {nodes.map((node) => {
              if (node.x == null || node.y == null) return null;
              const r = radiusFor(node.connections);
              const color = colorFor(node.type);
              const isSelected = selected?.id === node.id;
              const isHovered = hovered === node.id;
              const isConnected = selected ? links.some(l => {
                const src = (typeof l.source === "object" ? (l.source as GraphNode).id : l.source);
                const tgt = (typeof l.target === "object" ? (l.target as GraphNode).id : l.target);
                return (src === selected.id && tgt === node.id) || (tgt === selected.id && src === node.id);
              }) : false;
              const dim = selected && !isSelected && !isConnected;

              return (
                <g
                  key={node.id}
                  style={{ cursor: "grab", opacity: dim ? 0.2 : 1, transition: "opacity 300ms" }}
                  onMouseDown={(e) => handleMouseDown(e, node)}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => setSelected(isSelected ? null : node)}
                >
                  {/* Glow */}
                  <circle cx={node.x} cy={node.y} r={r * 2.5} fill={`url(#glow-${node.type})`} opacity={isSelected || isHovered ? 0.8 : 0.3} />
                  {/* Node */}
                  <circle
                    cx={node.x} cy={node.y} r={r}
                    fill={color}
                    fillOpacity={isSelected ? 0.9 : 0.6}
                    stroke={isSelected ? "#fff" : color}
                    strokeWidth={isSelected ? 2 : 0.5}
                    strokeOpacity={isSelected ? 0.8 : 0.3}
                  />
                  {/* Label */}
                  <text
                    x={node.x}
                    y={node.y! + r + 12}
                    textAnchor="middle"
                    fill={isSelected || isHovered ? "#fff" : "rgba(255,255,255,0.5)"}
                    fontSize={isSelected ? "11" : "9"}
                    fontFamily="system-ui, sans-serif"
                    fontWeight={isSelected ? "600" : "400"}
                  >
                    {node.id}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Detail sidebar */}
      {selected && (
        <div
          className="w-64 flex-shrink-0 overflow-auto p-5"
          style={{ borderLeft: "1px solid rgba(255,255,255,0.05)", background: "rgba(10,12,20,0.6)" }}
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: colorFor(selected.type) }}>{selected.id}</h3>
              <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{selected.type}</span>
            </div>
            <button onClick={() => setSelected(null)} className="text-xs" style={{ color: "var(--text-dim)" }}>&times;</button>
          </div>

          {/* Observations */}
          {selected.observations.length > 0 && (
            <div className="mb-5">
              <div className="text-[9px] uppercase tracking-wider mb-2" style={{ color: "var(--text-dim)" }}>
                Observations ({selected.observations.length})
              </div>
              <div className="flex flex-col gap-2">
                {selected.observations.map((obs, i) => (
                  <div key={i} className="text-xs leading-relaxed pl-3 py-1.5" style={{ color: "var(--text)", borderLeft: `2px solid ${colorFor(selected.type)}30` }}>
                    {obs}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Connections */}
          {selRelations.length > 0 && (
            <div>
              <div className="text-[9px] uppercase tracking-wider mb-2" style={{ color: "var(--text-dim)" }}>
                Connections ({selRelations.length})
              </div>
              <div className="flex flex-col gap-1.5">
                {selRelations.map((link, i) => {
                  const src = typeof link.source === "object" ? (link.source as GraphNode).id : link.source;
                  const tgt = typeof link.target === "object" ? (link.target as GraphNode).id : link.target;
                  const isFrom = src === selected.id;
                  const other = isFrom ? tgt : src;
                  return (
                    <button
                      key={i}
                      onClick={() => { const n = nodes.find(n => n.id === other); if (n) setSelected(n); }}
                      className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg text-left"
                      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.03)" }}
                    >
                      <span style={{ color: "var(--text-muted)" }}>{isFrom ? "\u2192" : "\u2190"}</span>
                      <span className="flex-1 truncate" style={{ color: "var(--bonds)" }}>{other}</span>
                      <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>{link.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
