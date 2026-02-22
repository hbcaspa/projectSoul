import { NODES } from "../../lib/brain-layout";
import type { ActivityEntry } from "../../lib/store";

interface ActivityFeedProps {
  feed: ActivityEntry[];
  activeNodes: Record<string, number>;
}

export default function ActivityFeed({ feed, activeNodes }: ActivityFeedProps) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-2">
      <div className="text-xs uppercase tracking-wider mb-1" style={{ color: "var(--text-dim)" }}>
        Activity
      </div>
      {feed.length === 0 ? (
        <div className="text-xs" style={{ color: "var(--text-dim)", opacity: 0.5 }}>
          Waiting for soul activity...
        </div>
      ) : (
        feed.slice(0, 8).map((entry, i) => {
          const node = NODES[entry.node];
          const color = node?.color || "var(--text)";
          const isActive = (activeNodes[entry.node] || 0) > 0;
          const isPulse = entry.eventType === "pulse";
          const dot = isActive ? (isPulse ? "\u26A1" : "\u25CF") : "\u25CB";
          const shortFile = entry.file.length > 45
            ? "..." + entry.file.slice(-42)
            : entry.file;

          return (
            <div
              key={`${entry.time}-${i}`}
              className="flex items-center gap-2 text-xs"
              style={{ opacity: 1 - i * 0.1 }}
            >
              <span style={{ color, fontSize: "10px" }}>{dot}</span>
              <span style={{ color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>
                {entry.time}
              </span>
              <span className="font-medium" style={{ color }}>
                {entry.label}
              </span>
              <span
                className="truncate"
                style={{
                  color: isPulse ? "var(--mem)" : "var(--text-dim)",
                  opacity: 0.7,
                  maxWidth: "200px",
                }}
              >
                {shortFile}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
