import { useEffect, useRef } from "react";
import { NODES, CONNECTIONS } from "../../lib/brain-layout";
import { PALETTE, lerp, glow, dim, rgba } from "../../lib/theme";

interface BrainCanvasProps {
  activeNodes: Record<string, number>;
  isWorking: boolean;
}

export default function BrainCanvas({ activeNodes, isWorking }: BrainCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tickRef = useRef(0);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      animRef.current = requestAnimationFrame(render);
      tickRef.current += 0.04;
      const tick = tickRef.current;

      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const w = rect.width;
      const h = rect.height;

      // Clear
      ctx.clearRect(0, 0, w, h);

      // Coordinate mapping: node positions (0-60, 0-30) → canvas pixels
      const scaleX = w / 62;
      const scaleY = h / 32;
      const mapX = (x: number) => (x + 1) * scaleX;
      const mapY = (y: number) => (y + 1) * scaleY;

      // Draw connections
      for (const [fromId, toId] of CONNECTIONS) {
        const from = NODES[fromId];
        const to = NODES[toId];
        if (!from || !to) continue;

        const fromActivity = activeNodes[fromId] || 0;
        const toActivity = activeNodes[toId] || 0;
        const connActivity = Math.max(fromActivity, toActivity);

        const x1 = mapX(from.x);
        const y1 = mapY(from.y);
        const x2 = mapX(to.x);
        const y2 = mapY(to.y);

        // Connection color
        const fromColorKey = from.color.replace("var(--", "").replace(")", "");
        const toColorKey = to.color.replace("var(--", "").replace(")", "");
        const fromColor = PALETTE[fromColorKey] || PALETTE.white;
        const toColor = PALETTE[toColorKey] || PALETTE.white;

        let lineColor: [number, number, number];
        let lineAlpha: number;

        if (connActivity > 0) {
          lineColor = lerp(fromColor, toColor, 0.5);
          lineColor = lerp(lineColor, PALETTE.white, connActivity * 0.3);
          lineAlpha = 0.3 + connActivity * 0.5;
        } else if (isWorking) {
          const ambientT = glow(tick + fromId.length * 0.7, 0.8) * 0.2;
          lineColor = lerp(PALETTE.line, PALETTE.lineGlow, ambientT);
          lineAlpha = 0.2 + ambientT;
        } else {
          const ambientT = glow(tick + fromId.length, 0.3) * 0.1;
          lineColor = lerp(PALETTE.line, PALETTE.lineGlow, ambientT);
          lineAlpha = 0.15;
        }

        // Draw bezier curve
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2;
        const cpOffset = Math.abs(x2 - x1) * 0.15 + Math.abs(y2 - y1) * 0.1;

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(midX + cpOffset * 0.3, midY - cpOffset * 0.3, x2, y2);
        ctx.strokeStyle = rgba(lineColor, lineAlpha);
        ctx.lineWidth = connActivity > 0 ? 1.5 : 0.8;
        ctx.stroke();

        // Pulse traveling along connection
        if (connActivity > 0) {
          const pulsePos = ((tick * 1.5) % 1);
          const px = x1 + (x2 - x1) * pulsePos;
          const py = y1 + (y2 - y1) * pulsePos;
          const pulseColor = lerp(lineColor, PALETTE.white, 0.7);

          ctx.beginPath();
          ctx.arc(px, py, 2 + connActivity * 2, 0, Math.PI * 2);
          ctx.fillStyle = rgba(pulseColor, connActivity * 0.6);
          ctx.fill();
        }
      }

      // Draw nodes
      for (const [id, node] of Object.entries(NODES)) {
        const activity = activeNodes[id] || 0;
        const colorKey = node.color.replace("var(--", "").replace(")", "");
        const baseColor = PALETTE[colorKey] || PALETTE.white;

        const x = mapX(node.x);
        const y = mapY(node.y);

        let displayColor: [number, number, number];
        let nodeRadius: number;
        let glowRadius: number;

        if (activity > 0.5) {
          // Bright phase: strong glow with pulse
          const pulseT = glow(tick, 3) * 0.3;
          displayColor = lerp(baseColor, PALETTE.white, activity * 0.5 + pulseT);
          nodeRadius = 6 + activity * 3;
          glowRadius = 20 + activity * 15;
        } else if (activity > 0) {
          // Afterglow: softer, still visible
          const pulseT = glow(tick, 1.5) * 0.15;
          displayColor = lerp(dim(baseColor, 0.5), baseColor, activity * 2 + pulseT);
          nodeRadius = 5 + activity * 2;
          glowRadius = 12 + activity * 8;
        } else if (isWorking) {
          // Brain alive but this node idle
          const ambientT = glow(tick + id.length * 0.7, 0.8) * 0.2;
          displayColor = dim(baseColor, 0.35 + ambientT);
          nodeRadius = 4;
          glowRadius = 6;
        } else {
          // Truly idle
          const ambientT = glow(tick + id.length, 0.5) * 0.1;
          displayColor = dim(baseColor, 0.2 + ambientT);
          nodeRadius = 3.5;
          glowRadius = 4;
        }

        // Outer glow
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
        gradient.addColorStop(0, rgba(displayColor, activity > 0 ? 0.3 : 0.08));
        gradient.addColorStop(1, rgba(displayColor, 0));
        ctx.beginPath();
        ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Node circle
        ctx.beginPath();
        ctx.arc(x, y, nodeRadius, 0, Math.PI * 2);
        const nodeGrad = ctx.createRadialGradient(x - 1, y - 1, 0, x, y, nodeRadius);
        nodeGrad.addColorStop(0, rgba(lerp(displayColor, PALETTE.white, 0.3), 0.9));
        nodeGrad.addColorStop(1, rgba(displayColor, 0.7));
        ctx.fillStyle = nodeGrad;
        ctx.fill();

        // Label
        ctx.font = `${activity > 0.5 ? "bold " : ""}${activity > 0 ? "10" : "9"}px system-ui, -apple-system, sans-serif`;
        ctx.fillStyle = rgba(displayColor, activity > 0.5 ? 0.9 : activity > 0 ? 0.6 : 0.35);
        ctx.textAlign = "center";
        ctx.fillText(node.label, x, y + nodeRadius + 12);
      }
    };

    animRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animRef.current);
  }, [activeNodes, isWorking]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: "block" }}
    />
  );
}
