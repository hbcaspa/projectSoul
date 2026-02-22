import { useState, useEffect, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import BrainCanvas from "./components/brain/BrainCanvas";
import ActivityFeed from "./components/brain/ActivityFeed";
import StatusBar from "./components/brain/StatusBar";
import TerminalView from "./views/TerminalView";
import WhisperView from "./views/WhisperView";
import CardView from "./views/CardView";
import ChainView from "./views/ChainView";
import ImpulseView from "./views/ImpulseView";
import GraphView from "./views/GraphView";
import ReplayView from "./views/ReplayView";
import HistoryView from "./views/HistoryView";
import FoundingView from "./views/FoundingView";
import SettingsView from "./views/SettingsView";
import SetupWizard from "./views/SetupWizard";
import FoundingChat from "./views/FoundingChat";
import { useActiveNodes, useCurrentPulse, useMood, useActivityFeed } from "./lib/store";
import { commands } from "./lib/tauri";

/* ── Chain Status Hook ─────────────────────────────────────── */

interface ChainInfo {
  health: string;
  peersOnline: number;
  peersTotal: number;
  totalSynced: number;
}

function useChainStatus(intervalMs = 10000) {
  const [info, setInfo] = useState<ChainInfo | null>(null);

  useEffect(() => {
    const load = () => {
      commands.readSoulFile(".soul-chain-status")
        .then((raw) => {
          const s = JSON.parse(raw);
          setInfo({
            health: s.health || "unknown",
            peersOnline: s.peers?.filter((p: { connected: boolean }) => p.connected).length || 0,
            peersTotal: s.peers?.length || 0,
            totalSynced: s.totalSynced || 0,
          });
        })
        .catch(() => setInfo(null));
    };
    load();
    const timer = setInterval(load, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return info;
}

/* ── Types ─────────────────────────────────────────────────── */

export type ViewId =
  | "brain"
  | "whisper"
  | "card"
  | "chain"
  | "impulse"
  | "graph"
  | "replay"
  | "history"
  | "founding"
  | "terminal"
  | "settings";

type PanelId = Exclude<ViewId, "brain" | "terminal">;

/* ── Panel definitions ─────────────────────────────────────── */

interface PanelDef {
  id: PanelId;
  label: string;
  color: string;
  icon: React.ReactNode;
}

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
    <path d={d} />
  </svg>
);

const PANELS: PanelDef[] = [
  {
    id: "whisper",
    label: "Whisper",
    color: "var(--traeume)",
    icon: icon("M2 12c1.5-3 3-4.5 4.5-4.5S9 10.5 10 12s2 4.5 3.5 4.5S16 15 17.5 12 20 7.5 22 12"),
  },
  {
    id: "card",
    label: "Card",
    color: "var(--seed)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="11" r="2.5" />
        <path d="M15 9h3M15 12h3M6 16h12" />
      </svg>
    ),
  },
  {
    id: "chain",
    label: "Chain",
    color: "var(--wachstum)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
  {
    id: "impulse",
    label: "Impulse",
    color: "var(--manifest)",
    icon: icon("M13 2L3 14h9l-1 8 10-12h-9l1-8z"),
  },
  {
    id: "graph",
    label: "Graph",
    color: "var(--interessen)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <circle cx="12" cy="6" r="2" />
        <circle cx="6" cy="14" r="2" />
        <circle cx="18" cy="14" r="2" />
        <path d="M12 8v2M8 13l2-1M16 13l-2-1" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "replay",
    label: "Replay",
    color: "var(--statelog)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 3" />
      </svg>
    ),
  },
  {
    id: "history",
    label: "History",
    color: "var(--evolution)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <circle cx="12" cy="5" r="2" />
        <circle cx="12" cy="19" r="2" />
        <circle cx="18" cy="12" r="2" />
        <path d="M12 7v10M14 12h2" />
      </svg>
    ),
  },
  {
    id: "founding",
    label: "Founding",
    color: "var(--kern)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <path d="M12 22V12" />
        <path d="M12 12C12 8 8 4 4 4c0 4 4 8 8 8z" />
        <path d="M12 12c0-4 4-8 8-8-0 4-4 8-8 8z" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    color: "var(--accent)",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
  },
];

const PANEL_COMPONENTS: Record<PanelId, React.FC> = {
  whisper: WhisperView,
  card: CardView,
  chain: ChainView,
  impulse: ImpulseView,
  graph: GraphView,
  replay: ReplayView,
  history: HistoryView,
  founding: FoundingView,
  settings: SettingsView,
};

/* ── Boot Splash ───────────────────────────────────────────── */

function BootSplash({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 100);
    const t2 = setTimeout(() => setPhase("out"), 2200);
    const t3 = setTimeout(onDone, 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{
        backgroundColor: "#000",
        opacity: phase === "in" ? 0 : phase === "out" ? 0 : 1,
        transition: phase === "in" ? "opacity 0.8s ease-out" : "opacity 0.8s ease-in",
      }}
    >
      {/* Logo */}
      <img
        src="/logo.png"
        alt=""
        className="w-24 h-24 mb-6"
        style={{
          filter: "drop-shadow(0 0 40px rgba(139, 128, 240, 0.4)) drop-shadow(0 0 80px rgba(0, 255, 200, 0.15))",
          transform: phase === "hold" ? "scale(1)" : "scale(0.95)",
          opacity: phase === "hold" ? 1 : 0,
          transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />

      {/* Progress bar — subtle loading indicator */}
      <div
        className="w-8 h-0.5 rounded-full overflow-hidden mt-8"
        style={{
          backgroundColor: "rgba(139, 128, 240, 0.15)",
          opacity: phase === "hold" ? 1 : 0,
          transition: "opacity 0.6s ease 0.3s",
        }}
      >
        <div
          className="h-full rounded-full"
          style={{
            backgroundColor: "rgba(139, 128, 240, 0.5)",
            width: phase === "hold" ? "100%" : "0%",
            transition: "width 1.8s ease-in-out 0.3s",
          }}
        />
      </div>
    </div>
  );
}

/* ── App Phase Type ────────────────────────────────────────── */

type AppPhase = "loading" | "setup" | "founding" | "ready";

/* ── App ───────────────────────────────────────────────────── */

function App() {
  const [booting, setBooting] = useState(true);
  const [appPhase, setAppPhase] = useState<AppPhase>("loading");
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);
  const { nodes, isWorking } = useActiveNodes();
  const currentPulse = useCurrentPulse();
  const mood = useMood();
  const feed = useActivityFeed();

  const chain = useChainStatus();
  const handleBootDone = useCallback(() => setBooting(false), []);

  // Determine app phase after boot
  useEffect(() => {
    if (booting) return;
    commands.getAppState()
      .then((state) => setAppPhase(state as AppPhase))
      .catch(() => setAppPhase("setup")); // fallback to setup on error
  }, [booting]);

  const togglePanel = useCallback((id: PanelId) => {
    setOpenPanel((prev) => (prev === id ? null : id));
  }, []);

  /* Keyboard: 1-9 toggle panels, ESC close (only in ready phase) */
  useEffect(() => {
    if (booting || appPhase !== "ready") return;
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el?.closest(".xterm") || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;

      if (e.key === "Escape") {
        setOpenPanel(null);
        return;
      }

      const num = parseInt(e.key);
      if (num >= 1 && num <= PANELS.length) {
        e.preventDefault();
        togglePanel(PANELS[num - 1].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePanel, booting, appPhase]);

  const PanelComponent = openPanel ? PANEL_COMPONENTS[openPanel] : null;
  const panelDef = openPanel ? PANELS.find((p) => p.id === openPanel) : null;

  return (
    <>
      {/* Boot splash */}
      {booting && <BootSplash onDone={handleBootDone} />}

      {/* Setup Wizard */}
      {!booting && appPhase === "setup" && (
        <div className="h-full" style={{ backgroundColor: "var(--bg-base)" }}>
          <div
            className="h-8 flex-shrink-0"
            onMouseDown={() => getCurrentWindow().startDragging()}
          />
          <div style={{ height: "calc(100% - 32px)" }}>
            <SetupWizard onComplete={() => setAppPhase("founding")} />
          </div>
        </div>
      )}

      {/* Founding Interview */}
      {!booting && appPhase === "founding" && (
        <div className="h-full" style={{ backgroundColor: "var(--bg-base)" }}>
          <div
            className="h-8 flex-shrink-0"
            onMouseDown={() => getCurrentWindow().startDragging()}
          />
          <div style={{ height: "calc(100% - 32px)" }}>
            <FoundingChat onComplete={() => setAppPhase("ready")} />
          </div>
        </div>
      )}

      {/* Main app (ready phase) */}
      {!booting && appPhase === "ready" && (
        <div
          className="flex flex-col h-full"
          style={{
            backgroundColor: "var(--bg-base)",
            opacity: 1,
            transition: "opacity 0.5s ease-out 0.2s",
          }}
        >
          {/* macOS traffic-light drag region */}
          <div
            className="h-8 flex-shrink-0"
            onMouseDown={() => getCurrentWindow().startDragging()}
          />

          {/* Main split: Brain (top) + Terminal (bottom) */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* ── Brain area ─────────────────────────────────── */}
            <div className="relative overflow-hidden" style={{ flex: "3 1 0%", minHeight: 0 }}>
              {/* Canvas as non-interactive background layer */}
              <div className="absolute inset-0 pointer-events-none">
                <BrainCanvas activeNodes={nodes} isWorking={isWorking} />
              </div>

              {/* Activity feed — top-left overlay */}
              {!openPanel && (
                <div className="absolute top-1 left-0 pointer-events-none" style={{ maxWidth: "45%" }}>
                  <div className="pointer-events-auto" style={{ maxHeight: "120px", overflow: "hidden" }}>
                    <ActivityFeed feed={feed} activeNodes={nodes} />
                  </div>
                </div>
              )}

              {/* Chain status — top-right indicator */}
              {!openPanel && (
                <div className="absolute top-2 right-3 pointer-events-none">
                  <div
                    className="flex items-center gap-2 px-2.5 py-1 rounded-lg frosted pointer-events-auto cursor-default"
                    style={{
                      backgroundColor: "rgba(22, 24, 48, 0.7)",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}
                    title={chain ? `${chain.peersOnline}/${chain.peersTotal} peers online, ${chain.totalSynced} files synced` : "Chain not configured"}
                    onClick={() => togglePanel("chain")}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: !chain ? "var(--text-dim)"
                          : chain.peersOnline > 0 ? "var(--wachstum)"
                          : chain.health === "syncing" ? "var(--bewusstsein)"
                          : "var(--heartbeat)",
                        boxShadow: chain?.peersOnline ? "0 0 6px var(--wachstum)" : "none",
                      }}
                    />
                    <span className="text-[10px] font-mono" style={{
                      color: !chain ? "var(--text-dim)"
                        : chain.peersOnline > 0 ? "var(--wachstum)"
                        : "var(--text-dim)",
                    }}>
                      {!chain ? "no chain"
                        : chain.peersOnline > 0 ? `${chain.peersOnline}/${chain.peersTotal}`
                        : `0/${chain.peersTotal}`}
                    </span>
                  </div>
                </div>
              )}

              {/* ── Floating Dock ────────────────────────────── */}
              <div
                className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-3 py-2 rounded-2xl frosted z-30"
                style={{
                  background: "linear-gradient(135deg, rgba(22, 24, 48, 0.85), rgba(16, 18, 36, 0.9))",
                  border: "1px solid rgba(255,255,255,0.07)",
                  boxShadow: "0 8px 40px rgba(0,0,0,0.6), 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
              >
                {/* Logo */}
                <img
                  src="/logo.png"
                  alt=""
                  className="w-6 h-6 mr-1"
                  style={{ filter: "drop-shadow(0 0 8px rgba(139,128,240,0.3))", opacity: 0.7 }}
                />
                <div className="w-px h-5 mx-1" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
                {PANELS.map((item, i) => {
                  const isActive = openPanel === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => togglePanel(item.id)}
                      title={`${item.label} (${i + 1})`}
                      className="relative w-8 h-8 flex items-center justify-center rounded-xl transition-all duration-200 cursor-default"
                      style={{
                        backgroundColor: isActive ? `color-mix(in srgb, ${item.color} 12%, transparent)` : "transparent",
                        color: isActive ? item.color : "var(--text-dim)",
                        boxShadow: isActive ? `0 0 12px ${item.color}20` : "none",
                      }}
                    >
                      {item.icon}
                      <span
                        className="absolute -top-0.5 right-0 text-[7px] font-mono leading-none"
                        style={{ color: "var(--text-dim)", opacity: 0.25 }}
                      >
                        {i + 1}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* ── Panel overlay ────────────────────────────── */}
              {PanelComponent && panelDef && (
                <>
                  <div
                    className="absolute inset-0 z-20"
                    style={{ backgroundColor: "rgba(13, 15, 26, 0.6)" }}
                    onClick={() => setOpenPanel(null)}
                  />
                  <div
                    className="absolute inset-3 rounded-2xl overflow-hidden frosted z-20"
                    style={{
                      background: "linear-gradient(135deg, rgba(22, 24, 48, 0.95), rgba(16, 18, 36, 0.92))",
                      border: "1px solid rgba(255,255,255,0.08)",
                      boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.04)",
                      bottom: "44px",
                    }}
                  >
                    <div className="flex items-center justify-between px-5 h-10 border-b flex-shrink-0" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                      <div className="flex items-center gap-2">
                        <span style={{ color: panelDef.color, opacity: 0.8 }}>{panelDef.icon}</span>
                        <span className="text-xs font-medium tracking-wide" style={{ color: panelDef.color }}>
                          {panelDef.label}
                        </span>
                      </div>
                      <button
                        onClick={() => setOpenPanel(null)}
                        className="text-[9px] px-2.5 py-0.5 rounded-lg cursor-default transition-all"
                        style={{
                          color: "var(--text-dim)",
                          backgroundColor: "rgba(255,255,255,0.04)",
                          border: "1px solid rgba(255,255,255,0.06)",
                        }}
                      >
                        ESC
                      </button>
                    </div>
                    <div className="overflow-auto" style={{ height: "calc(100% - 40px)" }}>
                      <PanelComponent />
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* ── Terminal area ───────────────────────────────── */}
            <div
              className="border-t border-white/5 flex-shrink-0"
              style={{ flex: "2 1 0%", minHeight: "120px" }}
            >
              <TerminalView />
            </div>
          </div>

          {/* Status bar */}
          <StatusBar
            activeNodes={nodes}
            isWorking={isWorking}
            currentPulse={currentPulse}
            mood={mood}
          />
        </div>
      )}

      {/* Loading state (after boot, before phase determined) */}
      {!booting && appPhase === "loading" && (
        <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
          <div className="animate-pulse text-xs" style={{ color: "var(--text-dim)" }}>...</div>
        </div>
      )}
    </>
  );
}

export default App;
