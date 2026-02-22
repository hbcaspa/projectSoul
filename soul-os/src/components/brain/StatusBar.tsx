import { NODES } from "../../lib/brain-layout";
import type { SoulPulse, SoulMood } from "../../lib/tauri";

interface StatusBarProps {
  activeNodes: Record<string, number>;
  isWorking: boolean;
  currentPulse: SoulPulse | null;
  mood: SoulMood | null;
}

export default function StatusBar({ activeNodes, isWorking, currentPulse, mood }: StatusBarProps) {
  const activeCount = Object.keys(activeNodes).filter((k) => activeNodes[k] > 0).length;
  const totalNodes = Object.keys(NODES).length;

  const moodLabel = mood?.label || null;
  const moodValence = mood?.valence ?? 0;
  const moodColor = moodValence > 0.2
    ? "var(--wachstum)"
    : moodValence < -0.2
      ? "var(--heartbeat)"
      : "var(--mem)";

  return (
    <div
      className="flex items-center gap-4 px-4 text-xs border-t border-white/5 flex-shrink-0"
      style={{
        height: "var(--statusbar-height)",
        backgroundColor: "var(--bg-surface)",
      }}
    >
      {/* Heartbeat */}
      <div className="flex items-center gap-1.5">
        <span
          className={isWorking ? "animate-pulse" : ""}
          style={{ color: isWorking ? "var(--heartbeat)" : "var(--text-dim)" }}
        >
          {isWorking ? "\u2665" : "\u2661"}
        </span>
        <span
          className="font-medium"
          style={{ color: isWorking ? "var(--bewusstsein)" : "var(--text-dim)" }}
        >
          {isWorking ? "ACTIVE" : "IDLE"}
        </span>
      </div>

      {/* Active node count */}
      <span style={{ color: activeCount > 0 ? "var(--bewusstsein)" : "var(--text-dim)" }}>
        {activeCount}/{totalNodes} nodes
      </span>

      {/* Current action */}
      {currentPulse && (
        <span className="truncate" style={{ color: "var(--accent)", maxWidth: "300px" }}>
          {"\u25B6"} {currentPulse.label}
        </span>
      )}

      <div className="flex-1" />

      {/* Mood */}
      {moodLabel && (
        <span style={{ color: moodColor }}>{moodLabel}</span>
      )}

      {/* Version */}
      <span style={{ color: "var(--text-dim)", opacity: 0.5 }}>SoulOS v0.1</span>
    </div>
  );
}
