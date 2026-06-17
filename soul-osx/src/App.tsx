import { useSoul } from "./lib/store";
import StatusBand from "./components/StatusBand";
import CortexGraph from "./components/CortexGraph";
import HeartPulse from "./components/HeartPulse";
import SynapseFeed from "./components/SynapseFeed";
import KeyGate from "./components/KeyGate";
import VoiceState from "./components/panels/VoiceState";
import VitalsPanel from "./components/panels/VitalsPanel";
import SessionPanel from "./components/panels/SessionPanel";
import AutonomyPanel from "./components/panels/AutonomyPanel";
import InfraPanel from "./components/panels/InfraPanel";

export default function App() {
  const { active, needsKey } = useSoul();
  const working = !!active?.status?.isWorking;
  // (a) Atem: aktiv → schneller/flacher, ruhend → langsam/tief
  const breathRate = working ? "3s" : "6s";

  return (
    <div
      className="relative z-10 flex h-screen flex-col breathe"
      style={{ ["--breath-rate" as string]: breathRate }}
    >
      <StatusBand />

      <main className="grid min-h-0 flex-1 grid-cols-[1.55fr_1fr] gap-3 px-3 pb-2">
        {/* Signature: der atmende Kortex mit Herz im Zentrum */}
        <section className="glass surface relative min-h-0 overflow-hidden">
          <div className="label absolute left-4 top-3 z-10">der kortex · {active?.node.label ?? "—"}</div>
          <CortexGraph />
          <HeartPulse />
        </section>

        {/* rechte Spalte: Vitalwerte + Panels */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
          <VoiceState />
          <VitalsPanel />
          <SessionPanel />
          <AutonomyPanel />
          <InfraPanel />
        </aside>
      </main>

      <SynapseFeed />

      {needsKey && <KeyGate />}
    </div>
  );
}
