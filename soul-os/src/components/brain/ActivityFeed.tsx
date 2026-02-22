import { NODES } from "../../lib/brain-layout";
import type { ActivityEntry } from "../../lib/store";

interface ActivityFeedProps {
  feed: ActivityEntry[];
  activeNodes: Record<string, number>;
}

export default function ActivityFeed({ feed, activeNodes }: ActivityFeedProps) {
  return (
    <div className="flex flex-col gap-px px-4 py-2">
      {feed.length === 0 ? (
        <div className="text-[10px]" style={{ color: "var(--text-dim)", opacity: 0.3 }}>
          Waiting...
        </div>
      ) : (
        feed.slice(0, 6).map((entry, i) => {
          const node = NODES[entry.node];
          const color = node?.color || "var(--text)";
          const isActive = (activeNodes[entry.node] || 0) > 0;
          const isPulse = entry.eventType === "pulse";
          const shortFile = entry.file.length > 40
            ? "..." + entry.file.slice(-37)
            : entry.file;

          return (
            <div
              key={`${entry.time}-${i}`}
              className="flex items-center gap-2 text-[10px] py-0.5"
              style={{ opacity: Math.max(0.2, 1 - i * 0.12) }}
            >
              <span
                className="w-1 h-1 rounded-full shrink-0"
                style={{
                  backgroundColor: color,
                  boxShadow: isActive && isPulse ? `0 0 4px ${color}` : "none",
                }}
              />
              <span className="font-mono shrink-0" style={{ color: "var(--text-dim)", opacity: 0.5, fontVariantNumeric: "tabular-nums" }}>
                {entry.time}
              </span>
              <span className="font-medium" style={{ color }}>
                {entry.label}
              </span>
              <span className="truncate" style={{ color: "var(--text-dim)", opacity: 0.4, maxWidth: "180px" }}>
                {shortFile}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
