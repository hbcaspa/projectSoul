import { useEffect, useRef } from "react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useSoul } from "../lib/store";
import { MODULES, REGIONS } from "../lib/manifest";

// Auflösung der CSS-Var-Farben zu echten Hex-Werten (Cytoscape kann keine var()).
function cssVar(name: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || "#8a85a0";
}

function buildElements(): ElementDefinition[] {
  const els: ElementDefinition[] = [];
  const cx = 500, cy = 350, rx = 330, ry = 220;
  const regionColor: Record<string, string> = {};
  for (const r of REGIONS) regionColor[r.id] = cssVar(r.color.replace("var(", "").replace(")", ""));

  // Zentrum (das Herz sitzt als Overlay darüber)
  els.push({ data: { id: "__core", label: "", kind: "core" }, position: { x: cx, y: cy }, selectable: false, grabbable: false });

  REGIONS.forEach((r, ri) => {
    const ang = -Math.PI / 2 + (ri * 2 * Math.PI) / REGIONS.length;
    const hx = cx + rx * Math.cos(ang);
    const hy = cy + ry * Math.sin(ang);
    els.push({
      data: { id: `hub_${r.id}`, label: r.name.split(" · ")[0].toUpperCase(), kind: "hub", region: r.id, color: regionColor[r.id] },
      position: { x: hx, y: hy },
      grabbable: false,
    });
    els.push({ data: { id: `e_core_${r.id}`, source: "__core", target: `hub_${r.id}`, kind: "trunk" } });

    const mods = MODULES.filter((m) => m.region === r.id);
    mods.forEach((m, mi) => {
      // Sonnenblumen-Verteilung um den Region-Hub
      const golden = 2.399963;
      const rad = 28 + 12 * Math.sqrt(mi);
      const a = mi * golden;
      els.push({
        data: { id: m.id, label: m.name, kind: "module", region: r.id, color: regionColor[r.id] },
        position: { x: hx + rad * Math.cos(a), y: hy + rad * Math.sin(a) },
        grabbable: false,
      });
      els.push({ data: { id: `e_${m.id}`, source: `hub_${r.id}`, target: m.id, kind: "nerve", color: regionColor[r.id] } });
    });
  });
  return els;
}

export default function CortexGraph() {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const { recentFires } = useSoul();

  useEffect(() => {
    if (!ref.current) return;
    const cy = cytoscape({
      container: ref.current,
      elements: buildElements(),
      layout: { name: "preset" },
      minZoom: 0.4,
      maxZoom: 2.5,
      autoungrabify: true,
      style: [
        {
          selector: "node[kind='module']",
          style: {
            "background-color": "data(color)",
            width: 9, height: 9,
            label: "data(label)",
            "font-family": "monospace",
            "font-size": 7,
            color: "#8a85a0",
            "text-opacity": 0.35,
            "text-margin-y": -2,
            "text-valign": "top",
            "background-opacity": 0.55,
            "border-width": 0,
          },
        },
        {
          selector: "node[kind='hub']",
          style: {
            "background-color": "data(color)",
            width: 16, height: 16,
            label: "data(label)",
            "font-family": "monospace",
            "font-size": 9,
            "font-weight": "bold",
            color: "#ede9f5",
            "text-opacity": 0.7,
            "text-margin-y": -4,
            "text-valign": "top",
            "background-opacity": 0.9,
            "border-width": 2,
            "border-color": "data(color)",
            "border-opacity": 0.4,
          },
        },
        { selector: "node[kind='core']", style: { width: 4, height: 4, "background-opacity": 0 } },
        {
          selector: "edge[kind='nerve']",
          style: { width: 0.6, "line-color": "data(color)", "line-opacity": 0.18, "curve-style": "straight" },
        },
        {
          selector: "edge[kind='trunk']",
          style: { width: 1.2, "line-color": "#272336", "line-opacity": 0.5, "curve-style": "straight" },
        },
        {
          selector: "node.fire",
          style: {
            width: 20, height: 20,
            "background-opacity": 1,
            "border-width": 3,
            "border-color": "data(color)",
            "border-opacity": 0.9,
            "text-opacity": 1,
            color: "#ede9f5",
            "font-size": 9,
            "z-index": 99,
          },
        },
        { selector: "edge.fire", style: { width: 2, "line-opacity": 0.9 } },
      ],
    });
    cyRef.current = cy;
    cy.fit(undefined, 40);
    const onResize = () => cy.fit(undefined, 40);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Live-Aufleuchten: alle 200ms abgleichen, welche Module < 1.5s gefeuert haben.
  useEffect(() => {
    const iv = setInterval(() => {
      const cy = cyRef.current;
      if (!cy) return;
      const now = Date.now();
      cy.batch(() => {
        for (const m of MODULES) {
          const t = recentFires.get(m.id) || 0;
          const node = cy.getElementById(m.id);
          if (!node || node.empty()) continue;
          const lit = now - t < 1500;
          if (lit && !node.hasClass("fire")) {
            node.addClass("fire");
            cy.getElementById(`e_${m.id}`).addClass("fire");
          } else if (!lit && node.hasClass("fire")) {
            node.removeClass("fire");
            cy.getElementById(`e_${m.id}`).removeClass("fire");
          }
        }
      });
    }, 200);
    return () => clearInterval(iv);
  }, [recentFires]);

  return <div ref={ref} className="absolute inset-0 h-full w-full" />;
}
