import { useEffect, useRef, useState } from "react";
import { useSoul } from "../lib/store";

// Das Herz im Zentrum des Kortex. Bei jedem 'pulse.written'-Event eine radiale
// Druckwelle in Pulse-Korallrot + der aktuelle Aktivitäts-Label ("was ich gerade tue").
export default function HeartPulse() {
  const { lastEvent, active } = useSoul();
  const [waves, setWaves] = useState<number[]>([]);
  const seq = useRef(0);
  const pulse = active?.status?.pulse;
  const activity = pulse?.activity || pulse?.type;
  const labelText = pulse?.label;

  useEffect(() => {
    if (lastEvent?.type?.startsWith("pulse")) {
      const id = ++seq.current;
      setWaves((w) => [...w, id].slice(-4));
      const t = setTimeout(() => setWaves((w) => w.filter((x) => x !== id)), 1600);
      return () => clearTimeout(t);
    }
  }, [lastEvent]);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <div className="relative h-2 w-2">
        {waves.map((id) => (
          <span
            key={id}
            className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              border: "1.5px solid var(--color-pulse)",
              animation: "heartwave 1.6s ease-out forwards",
            }}
          />
        ))}
        <span
          className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full breathe"
          style={{ background: "var(--color-pulse)", boxShadow: "0 0 16px var(--color-pulse)", ["--breath-rate" as string]: "1.4s" }}
        />
      </div>
      {activity && (
        <div className="mt-8 max-w-[60%] text-center">
          <div className="label" style={{ color: "var(--color-pulse)" }}>{activity}</div>
          {labelText && <div className="mt-0.5 truncate font-mono text-[11px] text-ash">{labelText}</div>}
        </div>
      )}
    </div>
  );
}
