import { useSoul } from "../lib/store";
import type { BusEvent } from "../lib/types";

function color(type = ""): string {
  if (type.startsWith("pulse")) return "var(--color-pulse)";
  if (type.startsWith("mood") || type.startsWith("cortex")) return "var(--color-cortex-warm)";
  if (type.startsWith("gate") || type.startsWith("hook") || type.includes("drift")) return "var(--color-immune)";
  if (type.startsWith("memory") || type.startsWith("context")) return "var(--color-biolumi)";
  if (type.startsWith("capability") || type.startsWith("foundry") || type.startsWith("react")) return "var(--color-synapse)";
  if (type.startsWith("chain")) return "var(--color-fever)";
  return "var(--color-ash)";
}

function time(ts?: number): string {
  if (!ts) return "--:--:--";
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8);
}

function label(ev: BusEvent): string {
  const p = ev as Record<string, unknown>;
  const extra =
    (p.label as string) ||
    (p.activity as string) ||
    (p.description as string) ||
    (p.desc as string) ||
    (p.reason as string) ||
    "";
  return extra ? ` · ${String(extra).slice(0, 80)}` : "";
}

export default function SynapseFeed() {
  const { events } = useSoul();
  const recent = events.slice(-40).reverse();

  return (
    <footer className="glass surface mx-3 mb-3 flex h-[68px] flex-col overflow-hidden px-3 py-1.5">
      <div className="label mb-1 flex items-center gap-2">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "var(--color-pulse)" }} />
        synapsen-feed · {events.length} signale
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-[1.45]">
        {recent.length === 0 && <span className="text-ash">— warte auf Nervenimpulse —</span>}
        {recent.map((ev, i) => (
          <div key={(ev.id ?? i) + "-" + i} className="flex gap-2 whitespace-nowrap">
            <span className="text-ash">{time(ev.ts)}</span>
            <span style={{ color: color(ev.type) }}>{ev.type ?? "event"}</span>
            <span className="truncate text-ash">
              {ev.source ? `(${ev.source})` : ""}
              {label(ev)}
            </span>
          </div>
        ))}
      </div>
    </footer>
  );
}
