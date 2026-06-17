import Panel, { Stat } from "../Panel";
import { usePoll } from "../../lib/usePoll";

interface Costs { today?: { total?: { input?: number; output?: number; calls?: number } } }
interface Health { status?: string; healthy?: boolean; ok?: boolean; checks?: Record<string, unknown>; [k: string]: unknown }

export default function InfraPanel() {
  const costs = usePoll<Costs>("/api/costs", 30000).data;
  const health = usePoll<Health>("/api/health", 30000).data;

  const calls = costs?.today?.total?.calls;
  const tok = (costs?.today?.total?.input ?? 0) + (costs?.today?.total?.output ?? 0);
  const healthy = health?.healthy ?? health?.ok ?? (health?.status ? /ok|healthy|gut/i.test(String(health.status)) : undefined);
  const hColor = healthy === false ? "var(--color-fever)" : healthy ? "var(--color-immune)" : "var(--color-ash)";

  return (
    <Panel title="infrastruktur · kreislauf" accent="var(--color-ash)">
      <div className="grid grid-cols-3 gap-3">
        <Stat
          k="gesundheit"
          v={
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: hColor, boxShadow: `0 0 8px ${hColor}` }} />
              {health?.status ?? (healthy ? "ok" : healthy === false ? "alarm" : "—")}
            </span>
          }
        />
        <Stat k="calls heute" v={calls ?? "—"} />
        <Stat k="tokens heute" v={tok ? `${(tok / 1000).toFixed(1)}k` : "—"} />
      </div>
    </Panel>
  );
}
