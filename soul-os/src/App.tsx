import { useState, useEffect, useCallback, useRef } from "react";
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
import TraderView from "./views/TraderView";
import MindView from "./views/MindView";
import SetupWizard from "./views/SetupWizard";
import FoundingChat from "./views/FoundingChat";
import { useActiveNodes, useCurrentPulse, useMood, useActivityFeed } from "./lib/store";
import { commands } from "./lib/tauri";
import { openUrl, toggleBrowser, toggleBrowserMode, onBrowserOpenUrl } from "./lib/browser";
import BrowserView from "./views/BrowserView";
import { useEngineSocket } from "./lib/useEngineSocket";

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
  | "trader"
  | "mind"
  | "terminal"
  | "settings"
  | "browser";

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
    id: "mind",
    label: "Mind",
    color: "#f472b6",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <path d="M12 2C8 2 4 5 4 9c0 2.5 1 4 2.5 5.5C8 16 8 18 8 20h8c0-2 0-4 1.5-5.5C19 13 20 11.5 20 9c0-4-4-7-8-7z" />
        <path d="M9 20h6M10 22h4" />
        <circle cx="12" cy="10" r="2" fill="currentColor" opacity="0.3" />
      </svg>
    ),
  },
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
    id: "trader",
    label: "Trader",
    color: "#00ff88",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
        <polyline points="16 7 22 7 22 13" />
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
  {
    id: "browser",
    label: "Browser",
    color: "#64C8FF",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
    ),
  },
];

/* ── Dock Categories ─────────────────────────────────── */

interface DockCategory {
  label: string;
  color: string;
  panels: PanelId[];
}

const DOCK_CATEGORIES: DockCategory[] = [
  { label: "Mind",    color: "#B464FF", panels: ["mind", "whisper", "innerworld", "card", "bonds", "founding"] },
  { label: "Memory",  color: "#FFC800", panels: ["graph", "memorymap", "timeline", "history", "replay"] },
  { label: "World",   color: "#64C8FF", panels: ["worldwindow", "browser", "chain", "garden", "trader"] },
  { label: "System",  color: "#00FFC8", panels: ["monitor", "health", "impulse", "mcp", "settings"] },
];

const PANEL_COMPONENTS: Record<PanelId, React.FC> = {
  mind: MindView,
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
  trader: TraderView,
  founding: FoundingView,
  settings: SettingsView,
  browser: BrowserView,
};

/* ── Widget positions removed — using dock bar navigation now ── */

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

  // Global WS to engine — receives browser commands from Claude Code etc.
  useEngineSocket();

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

  // Compact dock: hide labels when dock overflows
  const dockRef = useRef<HTMLDivElement>(null);
  const [dockCompact, setDockCompact] = useState(false);
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const check = () => {
      // Remove compact to measure natural (full) width
      el.classList.remove("dock-compact");
      const overflows = el.scrollWidth > el.clientWidth;
      if (overflows) el.classList.add("dock-compact");
      setDockCompact(overflows);
    };
    const ro = new ResizeObserver(check);
    ro.observe(el);
    check();
    return () => ro.disconnect();
  }, [appPhase]);

  /* Keyboard: 1-9 toggle panels, ESC close, Cmd+B browser, Cmd+Shift+B mode toggle */
  useEffect(() => {
    if (booting || appPhase !== "ready") return;
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el?.closest(".xterm") || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;

      // Cmd+Shift+B — toggle browser popup/full mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleBrowserMode();
        return;
      }

      // Cmd+B — toggle browser (close if open, reopen last URL if closed)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleBrowser();
        return;
      }

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

  /* Intercept external URLs from Rust on_navigation + link clicks */
  useEffect(() => {
    if (booting || appPhase !== "ready") return;

    // Listen for URLs intercepted by Rust's on_navigation handler
    const unlistenPromise = onBrowserOpenUrl((url) => {
      openUrl(url);
    });

    // Intercept <a> clicks with external hrefs
    const clickHandler = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest("a[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        e.preventDefault();
        openUrl(href);
      }
    };
    document.addEventListener("click", clickHandler);

    return () => {
      unlistenPromise.then((fn) => fn());
      document.removeEventListener("click", clickHandler);
    };
  }, [booting, appPhase]);

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

          {/* Main split: Dock + Brain (top) + Terminal (bottom) */}
          <div className="flex-1 flex flex-col min-h-0">

            {/* ── Module Dock Bar ─────────────────────────────── */}
            <div ref={dockRef} className={`dock-bar flex-shrink-0${dockCompact ? " dock-compact" : ""}`} style={{ opacity: openPanel ? 0.3 : 1, transition: "opacity 300ms ease" }}>
              {DOCK_CATEGORIES.map((cat, ci) => (
                <div key={cat.label} className="flex items-center">
                  {ci > 0 && <div className="dock-separator" />}
                  <div className="dock-group">
                    <span className="dock-group-label" style={{ color: cat.color, textShadow: `0 0 8px ${cat.color}40` }}>
                      {cat.label}
                    </span>
                    {cat.panels.map((pid) => {
                      const panel = PANELS.find((p) => p.id === pid);
                      if (!panel) return null;
                      return (
                        <button
                          key={pid}
                          className={`dock-btn ${openPanel === pid ? "dock-btn-active" : ""}`}
                          onClick={() => togglePanel(pid)}
                        >
                          <span className="dock-btn-icon" style={{ color: panel.color, filter: `drop-shadow(0 0 3px ${panel.color}66)` }}>
                            {panel.icon}
                          </span>
                          <span className="dock-btn-label" style={{ color: panel.color }}>
                            {panel.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Spacer + Quick Status */}
              <div className="flex-1" />
              <div className="status-pill">
                <span className={`status-dot ${isWorking ? "status-dot-active" : "status-dot-idle"}`} />
                <span style={{ color: isWorking ? "var(--bewusstsein)" : "var(--text-muted)" }}>
                  {isWorking ? "Active" : "Idle"}
                </span>
                {mood && (
                  <>
                    <span style={{ color: "var(--text-muted)" }}>·</span>
                    <span style={{ color: "var(--accent)" }}>{mood.label || "..."}</span>
                  </>
                )}
              </div>
            </div>

            {/* ── Brain area ─────────────────────────────────── */}
            <div className="relative overflow-hidden" style={{ flex: "3 1 0%", minHeight: 0 }}>
              {/* Canvas as non-interactive background layer */}
              <div className="absolute inset-0 pointer-events-none">
                <BrainCanvas activeNodes={nodes} isWorking={isWorking} />
              </div>

              {/* Activity feed — top-left overlay */}
              {!openPanel && (
                <div
                  className="absolute top-2 left-2 pointer-events-none"
                  style={{
                    maxWidth: "45%",
                    opacity: isWorking ? 1 : 0.3,
                    transition: "opacity 1.2s ease",
                  }}
                >
                  <div className="pointer-events-auto" style={{ maxHeight: "140px", overflow: "hidden" }}>
                    <ActivityFeed feed={feed} activeNodes={nodes} />
                  </div>
                </div>
              )}

              {/* ── Expanded Panel (Glass Overlay) ─────────────── */}
              {PanelComponent && panelDef && (
                <>
                  <div
                    className="absolute inset-0 z-20"
                    style={{ backgroundColor: "rgba(5, 8, 15, 0.5)", backdropFilter: "blur(4px)" }}
                    onClick={() => setOpenPanel(null)}
                  />
                  <div
                    className="rounded-2xl overflow-hidden vibrancy neon-scanlines z-30 panel-slide-up"
                    style={{
                      position: "absolute",
                      top: 12,
                      left: 16,
                      right: 16,
                      bottom: 12,
                      background: "linear-gradient(160deg, rgba(var(--neon-rgb),0.04) 0%, rgba(var(--bg-base-rgb), 0.92) 25%, rgba(var(--bg-base-rgb), 0.88) 100%)",
                      border: "1px solid rgba(var(--neon-rgb),0.18)",
                      boxShadow: "0 0 40px rgba(var(--neon-rgb),0.08), 0 20px 60px rgba(var(--black-rgb),0.5), inset 0 1px 0 rgba(var(--white-rgb),0.06)",
                    }}
                  >
                    {/* Panel Header */}
                    <div
                      className="flex items-center justify-between px-5 h-11 flex-shrink-0"
                      style={{ borderBottom: "1px solid rgba(var(--white-rgb),0.06)" }}
                    >
                      <div className="flex items-center gap-3">
                        <span style={{ color: panelDef.color, filter: `drop-shadow(0 0 6px ${panelDef.color})` }}>{panelDef.icon}</span>
                        <span
                          className="text-[13px] font-semibold uppercase tracking-[0.12em]"
                          style={{ color: panelDef.color, textShadow: `0 0 12px ${panelDef.color}44` }}
                        >
                          {panelDef.label}
                        </span>
                      </div>
                      <button
                        onClick={() => setOpenPanel(null)}
                        className="text-[10px] px-3 py-1 rounded-lg cursor-default transition-all"
                        style={{
                          color: "var(--text-dim)",
                          backgroundColor: "rgba(var(--white-rgb),0.04)",
                          border: "1px solid rgba(var(--white-rgb),0.08)",
                        }}
                      >
                        ESC
                      </button>
                    </div>
                    <div className="overflow-auto" style={{ height: "calc(100% - 44px)" }}>
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
