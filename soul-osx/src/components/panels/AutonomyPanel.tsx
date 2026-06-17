import Panel, { Stat } from "../Panel";
import { usePoll } from "../../lib/usePoll";

interface Gate { enabled?: boolean; stats?: Record<string, number>; riskyTools?: string[] }
interface Goals { enabled?: boolean; stats?: Record<string, number>; goals?: unknown[] }
interface React_ { enabled?: boolean; [k: string]: unknown }

export default function AutonomyPanel() {
  const gate = usePoll<Gate>("/api/gate", 6000).data;
  const goals = usePoll<Goals>("/api/goals", 12000).data;
  const react = usePoll<React_>("/api/react/stats", 10000).data;

  const pending = gate?.stats?.pendingCount ?? 0;

  return (
    <Panel title="autonomie · motorkortex" accent="var(--color-cortex-warm)">
      {pending > 0 && (
        <div className="glow-pulse mb-2 rounded-lg border border-pulse/50 bg-pulse/10 px-3 py-2">
          <span className="font-mono text-xs text-pulse">⚠ {pending} Genehmigung(en) ausstehend</span>
          <div className="label mt-0.5">antwort via telegram: ja &lt;id&gt;</div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Stat k="gate risky" v={gate?.riskyTools?.length ?? "—"} accent="var(--color-immune)" />
        <Stat k="ziele" v={goals?.goals?.length ?? goals?.stats?.total ?? "—"} />
        <Stat
          k="react"
          v={react?.enabled === false ? "idle" : (react?.runs as number) ?? (react?.total as number) ?? "aktiv"}
          accent="var(--color-synapse)"
        />
      </div>
      {gate?.stats && (
        <div className="mt-2 flex gap-3 font-mono text-[10px] text-ash">
          <span>angefragt {gate.stats.requested ?? 0}</span>
          <span style={{ color: "var(--color-immune)" }}>ok {gate.stats.approved ?? 0}</span>
          <span style={{ color: "var(--color-fever)" }}>blockiert {gate.stats.denied ?? 0}</span>
        </div>
      )}
    </Panel>
  );
}
