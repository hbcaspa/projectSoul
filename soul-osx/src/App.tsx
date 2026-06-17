import { useState } from "react";
import { useSoul } from "./lib/store";
import { useUI } from "./lib/ui";
import TopBar from "./components/TopBar";
import ActivityBar from "./components/ActivityBar";
import TerminalWorkspace from "./components/TerminalWorkspace";
import ControlPlane from "./components/ControlPlane";
import LivingCore from "./components/LivingCore";
import ActivityLane from "./components/ActivityLane";
import VitalsPanel from "./components/panels/VitalsPanel";
import CommandPalette from "./components/CommandPalette";
import ControlToast from "./components/ControlToast";
import KeyGate from "./components/KeyGate";
import Awakening from "./components/Awakening";

export default function App() {
  const { active, needsKey } = useSoul();
  const { view } = useUI();
  const working = !!active?.status?.isWorking;

  // Aufwach-Moment: läuft einmal pro Mount, legt sich über alles und
  // verschwindet von selbst. Bis dahin atmet der Kern im Dunkeln.
  const [awoken, setAwoken] = useState(false);

  // Terminal bleibt IMMER gemountet (PTY + Scrollback überleben View-Wechsel).
  // Nur die Sichtbarkeit/Layout ändert sich je nach View.
  const showTerminalView = view === "terminal";
  const showControl = view === "control";
  const showKortex = view === "kortex";

  return (
    <div
      className="relative z-10 flex h-screen flex-col"
      style={{ ["--breath-rate" as string]: working ? "3.5s" : "6s" }}
    >
      {!awoken && <Awakening onDone={() => setAwoken(true)} />}

      <TopBar />

      {/* Content beginnt direkt unter der 52px-Toolbar (oberes Padding 0). */}
      <main className="flex min-h-0 flex-1 gap-2 px-2 pb-2 pt-0">
        <ActivityBar />

        {/* ── Terminal-Layout (⌘1): Herzstück + lebende Hülle ──────────── */}
        <div
          className="grid min-h-0 flex-1"
          style={{
            display: showTerminalView ? "grid" : "none",
            gridTemplateColumns: "1fr 320px",
            gap: "0.5rem",
          }}
        >
          <section className="min-h-0">
            <TerminalWorkspace />
          </section>
          <aside className="surface-sidebar flex min-h-0 flex-col gap-2 overflow-hidden p-2">
            <div className="card relative h-[230px] shrink-0 overflow-hidden">
              <div className="label absolute left-3.5 top-3 z-10">Kortex · {active?.node.label ?? "—"}</div>
              <LivingCore />
            </div>
            <VitalsPanel />
            <ActivityLane />
          </aside>
        </div>

        {/* ── Control-Plane (⌘2): Vollbreite Operator-Fläche ───────────── */}
        <div className="min-h-0 flex-1" style={{ display: showControl ? "block" : "none" }}>
          {showControl && <ControlPlane />}
        </div>

        {/* ── Kortex/Ambient (⌘3): der lebende Kern als ruhiges Glühen ──── */}
        <div className="min-h-0 flex-1" style={{ display: showKortex ? "block" : "none" }}>
          {showKortex && (
            <div className="card surface relative h-full overflow-hidden">
              <div className="label absolute left-4 top-3.5 z-10">Kortex · {active?.node.label ?? "—"}</div>
              <LivingCore />
            </div>
          )}
        </div>
      </main>

      <CommandPalette />
      <ControlToast />
      {needsKey && <KeyGate />}
    </div>
  );
}
