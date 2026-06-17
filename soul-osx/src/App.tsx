import { useSoul } from "./lib/store";
import TopBar from "./components/TopBar";
import TerminalWorkspace from "./components/TerminalWorkspace";
import CortexGraph from "./components/CortexGraph";
import HeartPulse from "./components/HeartPulse";
import ActivityLane from "./components/ActivityLane";
import VitalsPanel from "./components/panels/VitalsPanel";
import KeyGate from "./components/KeyGate";

export default function App() {
  const { active, needsKey } = useSoul();
  const working = !!active?.status?.isWorking;

  return (
    <div
      className="relative z-10 flex h-screen flex-col"
      style={{ ["--breath-rate" as string]: working ? "3.5s" : "6s" }}
    >
      <TopBar />

      <main className="grid min-h-0 flex-1 grid-cols-[1fr_360px] gap-3 px-3 pb-3">
        {/* Herzstück: die Terminals */}
        <section className="min-h-0">
          <TerminalWorkspace />
        </section>

        {/* lebende Hülle: Kortex + Vitals + Soul-Prozesse */}
        <aside className="flex min-h-0 flex-col gap-3">
          <div className="card surface relative h-[230px] shrink-0 overflow-hidden">
            <div className="label absolute left-3.5 top-3 z-10">Kortex · {active?.node.label ?? "—"}</div>
            <CortexGraph />
            <HeartPulse />
          </div>
          <VitalsPanel />
          <ActivityLane />
        </aside>
      </main>

      {needsKey && <KeyGate />}
    </div>
  );
}
