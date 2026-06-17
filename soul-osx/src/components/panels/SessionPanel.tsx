import Panel from "../Panel";
import { usePoll } from "../../lib/usePoll";

interface Session {
  number?: number;
  state?: string;
  description?: string;
  checkpoints?: { phase?: string; status?: string }[];
  [k: string]: unknown;
}

const FLOW = ["boot", "loading", "heartbeat", "active", "closing_a", "closing_b", "completed"];

export default function SessionPanel() {
  const { data, error } = usePoll<Session>("/api/sessions/current", 5000);
  const s = data || {};
  const idx = s.state ? FLOW.indexOf(s.state) : -1;

  return (
    <Panel
      title="session · zustandsmaschine"
      accent="var(--color-synapse)"
      right={s.number != null ? <span className="font-mono text-[11px] text-bone">S{s.number}</span> : undefined}
    >
      {error && <div className="text-xs text-ash">keine aktive Session.</div>}
      {!error && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {FLOW.map((st, i) => {
              const isCur = st === s.state;
              const done = idx >= 0 && i < idx;
              return (
                <div key={st} className="flex items-center gap-1">
                  <span
                    className="rounded px-1.5 py-0.5 font-mono text-[9px] transition"
                    style={{
                      background: isCur ? "var(--color-synapse)" : done ? "rgba(124,92,255,0.15)" : "transparent",
                      color: isCur ? "#0B0A12" : done ? "var(--color-synapse)" : "var(--color-ash)",
                      border: `1px solid ${isCur ? "var(--color-synapse)" : "var(--color-membrane)"}`,
                    }}
                  >
                    {st.replace("_", " ")}
                  </span>
                  {i < FLOW.length - 1 && <span className="text-membrane">›</span>}
                </div>
              );
            })}
          </div>
          {s.checkpoints && s.checkpoints.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {s.checkpoints.map((c, i) => (
                <span
                  key={i}
                  className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                  style={{
                    border: "1px solid var(--color-membrane)",
                    color: c.status === "completed" ? "var(--color-immune)" : "var(--color-ash)",
                  }}
                >
                  {c.phase}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
