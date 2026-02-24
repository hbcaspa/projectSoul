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
import OnboardingView from "./views/OnboardingView";
import TimelineView from "./views/TimelineView";
import MemoryMapView from "./views/MemoryMapView";
import HealthView from "./views/HealthView";
import MonitorView from "./views/MonitorView";
import MCPView from "./views/MCPView";
import GardenView from "./views/GardenView";
import InnerWorldView from "./views/InnerWorldView";
import WorldWindowView from "./views/WorldWindowView";
import BondsView from "./views/BondsView";
import SetupWizard from "./views/SetupWizard";
import FoundingChat from "./views/FoundingChat";
import { useActiveNodes, useCurrentPulse, useMood, useActivityFeed } from "./lib/store";
import { commands } from "./lib/tauri";

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
  | "timeline"
  | "memorymap"
  | "health"
  | "monitor"
  | "founding"
  | "mcp"
  | "garden"
  | "innerworld"
  | "worldwindow"
  | "bonds"
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
    color: "#6464FF",
    icon: icon("M2 12c1.5-3 3-4.5 4.5-4.5S9 10.5 10 12s2 4.5 3.5 4.5S16 15 17.5 12 20 7.5 22 12"),
  },
  {
    id: "card",
    label: "Card",
    color: "#DCDCFF",
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
    color: "#00FF64",
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
    color: "#FF9600",
    icon: icon("M13 2L3 14h9l-1 8 10-12h-9l1-8z"),
  },
  {
    id: "graph",
    label: "Graph",
    color: "#00C8FF",
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
    color: "#50C8B4",
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
    color: "#C864FF",
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
    id: "timeline",
    label: "Timeline",
    color: "#00FF64",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <path d="M12 2v20" />
        <circle cx="12" cy="6" r="2" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="M14 6h4M14 12h4M14 18h4" />
      </svg>
    ),
  },
  {
    id: "memorymap",
    label: "Map",
    color: "#00DCB4",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" />
        <path d="M7 6h10M5 8l7 8M19 8l-7 8" />
      </svg>
    ),
  },
  {
    id: "health",
    label: "Health",
    color: "#FF3232",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    id: "monitor",
    label: "Monitor",
    color: "#ff3232",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <path d="M7 10h2l2-3 2 6 2-3h2" />
      </svg>
    ),
  },
  {
    id: "garden",
    label: "Garden",
    color: "#00E676",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <path d="M12 22V12" />
        <path d="M7 12c0-3 2-7 5-10 3 3 5 7 5 10" />
        <path d="M7 12c-2 0-5 1-5 4 3 0 5-1 5-4z" />
        <path d="M17 12c2 0 5 1 5 4-3 0-5-1-5-4z" />
      </svg>
    ),
  },
  {
    id: "innerworld",
    label: "Inner",
    color: "#B464FF",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: "worldwindow",
    label: "World",
    color: "#64C8FF",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15 15 0 010 20M12 2a15 15 0 000 20" />
      </svg>
    ),
  },
  {
    id: "bonds",
    label: "Bonds",
    color: "#FF6496",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z" />
      </svg>
    ),
  },
  {
    id: "mcp",
    label: "MCP",
    color: "#00C8FF",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    ),
  },
  {
    id: "founding",
    label: "Founding",
    color: "#FF3C3C",
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
    color: "#8B80F0",
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
  timeline: TimelineView,
  memorymap: MemoryMapView,
  health: HealthView,
  monitor: MonitorView,
  mcp: MCPView,
  garden: GardenView,
  innerworld: InnerWorldView,
  worldwindow: WorldWindowView,
  bonds: BondsView,
  founding: FoundingView,
  settings: SettingsView,
};

/* ── Widget positions (ring around brain) ─────────────────── */

const WIDGET_POSITIONS: Record<PanelId, React.CSSProperties> = {
  whisper:  { top: "22%", left: "3%" },
  card:     { top: "4%", left: "50%", transform: "translateX(-50%)" },
  chain:    { top: "4%", right: "3%" },
  impulse:  { top: "50%", left: "2%", transform: "translateY(-50%)" },
  graph:    { top: "50%", right: "2%", transform: "translateY(-50%)" },
  replay:   { bottom: "18%", left: "5%" },
  history:  { bottom: "18%", right: "5%" },
  timeline: { bottom: "18%", left: "50%", transform: "translateX(-50%)" },
  memorymap: { bottom: "2%", left: "20%" },
  health:    { bottom: "2%", left: "8%" },
  monitor:   { top: "4%", left: "3%" },
  mcp:         { bottom: "2%", right: "20%" },
  garden:      { top: "36%", right: "3%" },
  innerworld:  { top: "12%", left: "18%" },
  worldwindow: { top: "12%", right: "18%" },
  bonds:       { bottom: "10%", left: "50%", transform: "translateX(-50%)" },
  founding:    { bottom: "2%", left: "50%", transform: "translateX(-50%)" },
  settings:    { bottom: "2%", right: "3%" },
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
          filter: "drop-shadow(0 0 40px rgba(var(--accent-rgb), 0.4)) drop-shadow(0 0 80px rgba(var(--neon-rgb), 0.15))",
          transform: phase === "hold" ? "scale(1)" : "scale(0.95)",
          opacity: phase === "hold" ? 1 : 0,
          transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />

      {/* Progress bar — subtle loading indicator */}
      <div
        className="w-8 h-0.5 rounded-full overflow-hidden mt-8"
        style={{
          backgroundColor: "rgba(var(--accent-rgb), 0.15)",
          opacity: phase === "hold" ? 1 : 0,
          transition: "opacity 0.6s ease 0.3s",
        }}
      >
        <div
          className="h-full rounded-full"
          style={{
            backgroundColor: "rgba(var(--accent-rgb), 0.5)",
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
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { nodes, isWorking } = useActiveNodes();
  const currentPulse = useCurrentPulse();
  const mood = useMood();
  const feed = useActivityFeed();

  const handleBootDone = useCallback(() => setBooting(false), []);

  // Determine app phase after boot
  useEffect(() => {
    if (booting) return;
    commands.getAppState()
      .then((state) => setAppPhase(state as AppPhase))
      .catch(() => setAppPhase("setup")); // fallback to setup on error
  }, [booting]);

  // Show onboarding for new souls (sessions < 5, not dismissed)
  useEffect(() => {
    if (appPhase !== "ready") return;
    if (localStorage.getItem("soul-onboarding-dismissed")) return;
    commands.getSoulStatus()
      .then((status) => {
        if (status.sessions < 5) setShowOnboarding(true);
      })
      .catch(() => {}); // ignore — no onboarding if status unavailable
  }, [appPhase]);

  const dismissOnboarding = useCallback(() => {
    setShowOnboarding(false);
    localStorage.setItem("soul-onboarding-dismissed", "true");
  }, []);

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
          {/* macOS traffic-light drag region + centered title with logo */}
          <div
            className="h-8 flex-shrink-0 flex items-center justify-center relative"
            onMouseDown={() => getCurrentWindow().startDragging()}
          >
            <div className="flex items-center gap-2">
              <img
                src="/logo.png"
                alt=""
                className="w-4 h-4"
                style={{ filter: "drop-shadow(0 0 6px rgba(var(--accent-rgb),0.4))", opacity: 0.7 }}
              />
              <span
                className="text-[11px] font-semibold tracking-[0.2em]"
                style={{ color: "var(--text-dim)", textShadow: "0 0 10px rgba(var(--neon-rgb),0.15)" }}
              >
                soulOS
              </span>
            </div>
          </div>

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
                <div
                  className="absolute top-1 left-0 pointer-events-none"
                  style={{
                    maxWidth: "45%",
                    opacity: isWorking ? 1 : 0.4,
                    transition: "opacity 1.2s ease",
                  }}
                >
                  <div className="pointer-events-auto" style={{ maxHeight: "120px", overflow: "hidden" }}>
                    <ActivityFeed feed={feed} activeNodes={nodes} />
                  </div>
                </div>
              )}

              {/* Chain status is now integrated into the Chain widget card */}

              {/* ── Floating Widget Cards (ring around brain) ── */}
              {PANELS.map((panel, i) => {
                // Silence mode: when nothing is active, widgets are softer
                const silenceOpacity = !isWorking && !openPanel ? 0.55 : 1;
                return (
                <div
                  key={panel.id}
                  className="absolute z-10"
                  style={{
                    ...WIDGET_POSITIONS[panel.id],
                    opacity: openPanel ? (openPanel === panel.id ? 0 : 0.12) : silenceOpacity,
                    transition: "opacity 800ms ease",
                    pointerEvents: openPanel ? "none" : "auto",
                  }}
                >
                  <button
                    onClick={() => togglePanel(panel.id)}
                    className="group flex items-center gap-2 px-3 py-2 rounded-xl cursor-default transition-all hover:scale-105"
                    style={{
                      background: "linear-gradient(160deg, rgba(var(--neon-rgb),0.04), rgba(var(--bg-base-rgb),0.7))",
                      border: `1px solid ${panel.color}33`,
                      backdropFilter: "blur(12px)",
                      WebkitBackdropFilter: "blur(12px)",
                      boxShadow: `0 0 10px ${panel.color}14, 0 4px 12px rgba(var(--black-rgb),0.3)`,
                    }}
                  >
                    <span style={{ color: panel.color, filter: `drop-shadow(0 0 4px ${panel.color}66)` }}>
                      {panel.icon}
                    </span>
                    <span
                      className="text-[10px] uppercase tracking-[0.12em] font-medium"
                      style={{ color: panel.color, textShadow: `0 0 8px ${panel.color}40` }}
                    >
                      {panel.label}
                    </span>
                    <span className="text-[8px] font-mono ml-0.5" style={{ color: "var(--text-muted)" }}>
                      {i + 1}
                    </span>
                  </button>
                </div>
                );
              })}

              {/* ── Expanded Panel (Glass Overlay) ─────────────── */}
              {PanelComponent && panelDef && (
                <>
                  <div
                    className="absolute inset-0 z-20"
                    style={{ backgroundColor: "rgba(5, 8, 15, 0.45)" }}
                    onClick={() => setOpenPanel(null)}
                  />
                  <div
                    className="rounded-2xl overflow-hidden frosted neon-scanlines z-30 panel-expand"
                    style={{
                      position: "absolute",
                      top: 20,
                      left: 20,
                      right: 20,
                      bottom: 20,
                      background: "linear-gradient(160deg, rgba(var(--neon-rgb),0.03) 0%, rgba(var(--bg-base-rgb), 0.88) 30%, rgba(var(--bg-base-rgb), 0.85) 100%)",
                      border: "1px solid rgba(var(--neon-rgb),0.22)",
                      boxShadow: "0 0 40px rgba(var(--neon-rgb),0.1), 0 0 80px rgba(var(--neon-rgb),0.04), 0 24px 64px rgba(var(--black-rgb),0.5), inset 0 1px 0 rgba(var(--neon-rgb),0.08)",
                    }}
                  >
                    <div
                      className="flex items-center justify-between px-5 h-10 flex-shrink-0"
                      style={{ borderBottom: "1px solid rgba(var(--neon-rgb),0.1)" }}
                    >
                      <div className="flex items-center gap-2">
                        <span style={{ color: panelDef.color, filter: `drop-shadow(0 0 4px ${panelDef.color})` }}>{panelDef.icon}</span>
                        <span
                          className="text-xs font-semibold uppercase tracking-[0.15em]"
                          style={{ color: panelDef.color, textShadow: `0 0 10px ${panelDef.color}66` }}
                        >
                          {panelDef.label}
                        </span>
                      </div>
                      <button
                        onClick={() => setOpenPanel(null)}
                        className="text-[9px] px-2.5 py-0.5 rounded-lg cursor-default transition-all"
                        style={{
                          color: "var(--bewusstsein)",
                          backgroundColor: "rgba(var(--neon-rgb),0.06)",
                          border: "1px solid rgba(var(--neon-rgb),0.15)",
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

          {/* Onboarding overlay for new souls */}
          {showOnboarding && (
            <div className="absolute inset-0 z-40 frosted" style={{ backgroundColor: "rgba(5, 8, 15, 0.85)" }}>
              <OnboardingView onDismiss={dismissOnboarding} />
            </div>
          )}
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
