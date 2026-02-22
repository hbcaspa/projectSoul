import { NODES } from "../lib/brain-layout";
import { useWhisperStream } from "../lib/store";

export default function WhisperView() {
  const stream = useWhisperStream();

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="flex-1 overflow-auto px-8 py-6">
        {stream.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div
              className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
              style={{
                background: "linear-gradient(135deg, rgba(100,100,255,0.06), rgba(139,128,240,0.03))",
                border: "1px solid rgba(100,100,255,0.08)",
                boxShadow: "0 4px 24px rgba(100,100,255,0.06)",
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-9 h-9" style={{ color: "var(--traeume)", opacity: 0.4 }}>
                <path d="M2 12c1.5-3 3-4.5 4.5-4.5S9 10.5 10 12s2 4.5 3.5 4.5S16 15 17.5 12 20 7.5 22 12" />
              </svg>
            </div>
            <p className="text-base font-light" style={{ color: "var(--text-dim)" }}>Silence</p>
            <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>The thoughts will come...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {stream.map((entry, i) => {
              const node = NODES[entry.type] || NODES.bewusstsein;
              const color = node?.color || "var(--text)";
              const opacity = Math.max(0.15, 1 - i * 0.04);
              const isLatest = i === 0;

              return (
                <div
                  key={`${entry.time}-${i}`}
                  className="flex gap-4 items-start py-2.5 rounded-xl px-4 transition-all duration-500"
                  style={{
                    opacity,
                    background: isLatest ? "linear-gradient(135deg, rgba(139,128,240,0.05), rgba(255,255,255,0.01))" : "transparent",
                    border: isLatest ? "1px solid rgba(139,128,240,0.08)" : "1px solid transparent",
                  }}
                >
                  <span className="text-xs flex-shrink-0 pt-0.5 font-mono" style={{ color: "var(--text-dim)", fontVariantNumeric: "tabular-nums", minWidth: "55px", opacity: 0.6 }}>
                    {entry.time}
                  </span>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-[5px]" style={{ backgroundColor: color, boxShadow: isLatest ? `0 0 10px ${color}60` : "none" }} />
                  <p className={`text-sm leading-relaxed ${isLatest ? "font-medium" : ""}`} style={{ color: isLatest ? "var(--text-bright)" : "var(--text)" }}>
                    {entry.text}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
