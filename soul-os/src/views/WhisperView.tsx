import { NODES } from "../lib/brain-layout";
import { useWhisperStream } from "../lib/store";

export default function WhisperView() {
  const stream = useWhisperStream();

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Header */}
      <div className="px-6 pt-6 pb-3 flex-shrink-0">
        <h2 className="text-sm uppercase tracking-wider" style={{ color: "var(--traeume)", opacity: 0.7 }}>
          Inner Monologue
        </h2>
      </div>

      {/* Whisper stream */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        {stream.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm italic" style={{ color: "var(--text-dim)", opacity: 0.5 }}>
              Silence. The thoughts will come...
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {stream.map((entry, i) => {
              const node = NODES[entry.type] || NODES.bewusstsein;
              const color = node?.color || "var(--text)";
              const opacity = Math.max(0.2, 1 - i * 0.06);
              const isLatest = i === 0;

              return (
                <div
                  key={`${entry.time}-${i}`}
                  className="flex gap-3 items-start transition-opacity duration-500"
                  style={{ opacity }}
                >
                  {/* Time */}
                  <span
                    className="text-xs flex-shrink-0 pt-0.5"
                    style={{
                      color: "var(--text-dim)",
                      fontVariantNumeric: "tabular-nums",
                      minWidth: "56px",
                    }}
                  >
                    {entry.time}
                  </span>

                  {/* Type indicator */}
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                    style={{
                      backgroundColor: color,
                      boxShadow: isLatest ? `0 0 8px ${color}` : "none",
                    }}
                  />

                  {/* Whisper text */}
                  <p
                    className={`text-sm leading-relaxed ${isLatest ? "font-medium" : ""}`}
                    style={{
                      color: isLatest ? "var(--text-bright)" : "var(--text)",
                    }}
                  >
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
