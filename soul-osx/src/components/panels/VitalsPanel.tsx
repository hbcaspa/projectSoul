import Panel, { Stat } from "../Panel";
import { usePoll } from "../../lib/usePoll";

interface Emotion { valence?: number; energy?: number; openness?: number; label?: string }
interface Mind {
  enabled?: boolean;
  emotion?: Emotion | string;
  mood?: string;
  surprise?: number;
  drang?: number;
  needs?: unknown[];
  [k: string]: unknown;
}

function Bar({ label, v, color }: { label: string; v: number; color: string }) {
  const pct = Math.max(0, Math.min(1, v)) * 100;
  return (
    <div>
      <div className="flex justify-between">
        <span className="label">{label}</span>
        <span className="font-mono text-[10px] text-ash">{v.toFixed(2)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-membrane">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function VitalsPanel() {
  const { data, error } = usePoll<Mind>("/api/mind", 6000);
  const m = data || {};
  const emo: Emotion = typeof m.emotion === "object" && m.emotion ? m.emotion : {};
  const emoLabel = typeof m.emotion === "string" ? m.emotion : emo.label || m.mood;
  const num = (x: unknown) => (typeof x === "number" ? x : undefined);

  return (
    <Panel title="vitalwerte · cortex" accent="var(--color-cortex-warm)">
      {error && <div className="text-xs text-fever">{error.slice(0, 80)}</div>}
      {m.enabled === false && <div className="text-xs text-ash">Cortex inaktiv.</div>}
      <div className="grid grid-cols-2 gap-3">
        {emoLabel && <Stat k="emotion" v={String(emoLabel)} accent="var(--color-cortex-warm)" />}
        {num(m.surprise) != null && <Stat k="überraschung" v={num(m.surprise)!.toFixed(2)} />}
      </div>
      <div className="mt-3 flex flex-col gap-2.5">
        {num(emo.valence) != null && <Bar label="valenz" v={(num(emo.valence)! + 1) / 2} color="var(--color-synapse)" />}
        {num(emo.energy) != null && <Bar label="energie" v={num(emo.energy)!} color="var(--color-cortex-warm)" />}
        {num(emo.openness) != null && <Bar label="offenheit" v={num(emo.openness)!} color="var(--color-biolumi)" />}
        {num(m.drang) != null && <Bar label="drang" v={num(m.drang)!} color="var(--color-pulse)" />}
      </div>
      {Array.isArray(m.needs) && m.needs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {m.needs.slice(0, 6).map((n, i) => (
            <span key={i} className="rounded-full border border-membrane px-2 py-0.5 font-mono text-[10px] text-ash">
              {typeof n === "string" ? n : JSON.stringify(n)}
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}
