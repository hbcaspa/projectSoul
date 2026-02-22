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
      : "var(--bewusstsein)";

  return (
    <div
      className="flex items-center gap-4 px-5 text-[10px] border-t flex-shrink-0"
      style={{
        height: "var(--statusbar-height)",
        backgroundColor: "rgba(22, 24, 48, 0.6)",
        borderColor: "rgba(255,255,255,0.04)",
      }}
    >
      {/* Heartbeat */}
      <div className="flex items-center gap-1.5">
        <span
          className={isWorking ? "animate-pulse" : ""}
          style={{ color: isWorking ? "var(--heartbeat)" : "var(--text-dim)", fontSize: "9px" }}
        >
          {isWorking ? "\u2665" : "\u2661"}
        </span>
        <span
          className="font-medium tracking-wider uppercase"
          style={{ color: isWorking ? "var(--bewusstsein)" : "var(--text-dim)" }}
        >
          {isWorking ? "Active" : "Idle"}
        </span>
      </div>

      {/* Node count */}
      <span className="font-mono" style={{ color: activeCount > 0 ? "var(--bewusstsein)" : "var(--text-dim)", opacity: 0.6 }}>
        {activeCount}/{totalNodes}
      </span>

      {/* Current action */}
      {currentPulse && (
        <span className="truncate" style={{ color: "var(--accent)", maxWidth: "300px", opacity: 0.7 }}>
          {currentPulse.label}
        </span>
      )}

      <div className="flex-1" />

      {/* Mood */}
      {moodLabel && (
        <span className="capitalize" style={{ color: moodColor, opacity: 0.7 }}>{moodLabel}</span>
      )}

      {/* Version */}
      <span className="font-mono" style={{ color: "var(--text-dim)", opacity: 0.25 }}>v0.2</span>
    </div>
  );
}
