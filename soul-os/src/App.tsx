import { useState, useEffect, useCallback, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import BrainCanvas from "./components/brain/BrainCanvas";
import ActivityFeed from "./components/brain/ActivityFeed";
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
import SessionDashboardView from "./views/SessionDashboardView";
import SetupWizard from "./views/SetupWizard";
import FoundingChat from "./views/FoundingChat";
import BrowserView from "./views/BrowserView";
import { WindowManagerProvider, useWindowManager } from "./components/os/WindowManager";
import Window from "./components/os/Window";
import Taskbar from "./components/os/Taskbar";
import AppLauncher from "./components/os/AppLauncher";
import { NotificationProvider, useNotifications, NotificationList } from "./components/os/NotificationCenter";
import { useActiveNodes, useCurrentPulse, useMood, useActivityFeed } from "./lib/store";
import { commands } from "./lib/tauri";
import { openUrl, toggleBrowser, toggleBrowserMode, onBrowserOpenUrl } from "./lib/browser";
import { useEngineSocket } from "./lib/useEngineSocket";

/* ── Types ─────────────────────────────────────────────────── */

export type ViewId =
  | "brain" | "whisper" | "card" | "chain" | "impulse" | "graph"
  | "replay" | "history" | "timeline" | "memorymap" | "health"
  | "monitor" | "founding" | "mcp" | "garden" | "innerworld"
  | "worldwindow" | "bonds" | "trader" | "mind" | "terminal"
  | "settings" | "browser" | "sessions";

type AppId = Exclude<ViewId, "brain" | "terminal">;

/* ── App definitions (icon, label, color, component) ──────── */

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
    <path d={d} />
  </svg>
);

interface AppDef {
  id: AppId;
  label: string;
  color: string;
  icon: ReactNode;
  component: React.FC;
  category: string;
}

const APPS: AppDef[] = [
  { id: "sessions", label: "Sessions", color: "#00FFC8", category: "System", component: SessionDashboardView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><path d="M17.5 14v7M14 17.5h7" /></svg>) },
  { id: "mind", label: "Mind", color: "#f472b6", category: "Mind", component: MindView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M12 2C8 2 4 5 4 9c0 2.5 1 4 2.5 5.5C8 16 8 18 8 20h8c0-2 0-4 1.5-5.5C19 13 20 11.5 20 9c0-4-4-7-8-7z" /><path d="M9 20h6M10 22h4" /><circle cx="12" cy="10" r="2" fill="currentColor" opacity="0.3" /></svg>) },
  { id: "whisper", label: "Whisper", color: "#6464FF", category: "Mind", component: WhisperView,
    icon: icon("M2 12c1.5-3 3-4.5 4.5-4.5S9 10.5 10 12s2 4.5 3.5 4.5S16 15 17.5 12 20 7.5 22 12") },
  { id: "card", label: "Card", color: "#DCDCFF", category: "Mind", component: CardView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="11" r="2.5" /><path d="M15 9h3M15 12h3M6 16h12" /></svg>) },
  { id: "innerworld", label: "Inner World", color: "#B464FF", category: "Mind", component: InnerWorldView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>) },
  { id: "bonds", label: "Bonds", color: "#FF6496", category: "Mind", component: BondsView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z" /></svg>) },
  { id: "founding", label: "Founding", color: "#FF3C3C", category: "Mind", component: FoundingView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M12 22V12" /><path d="M12 12C12 8 8 4 4 4c0 4 4 8 8 8z" /><path d="M12 12c0-4 4-8 8-8-0 4-4 8-8 8z" /></svg>) },
  { id: "graph", label: "Graph", color: "#00C8FF", category: "Memory", component: GraphView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><circle cx="12" cy="6" r="2" /><circle cx="6" cy="14" r="2" /><circle cx="18" cy="14" r="2" /><path d="M12 8v2M8 13l2-1M16 13l-2-1" /><circle cx="12" cy="12" r="1" fill="currentColor" /></svg>) },
  { id: "memorymap", label: "Memory Map", color: "#00DCB4", category: "Memory", component: MemoryMapView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><circle cx="5" cy="6" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="12" cy="18" r="2" /><path d="M7 6h10M5 8l7 8M19 8l-7 8" /></svg>) },
  { id: "timeline", label: "Timeline", color: "#00FF64", category: "Memory", component: TimelineView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M12 2v20" /><circle cx="12" cy="6" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="18" r="2" /><path d="M14 6h4M14 12h4M14 18h4" /></svg>) },
  { id: "history", label: "History", color: "#C864FF", category: "Memory", component: HistoryView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="19" r="2" /><circle cx="18" cy="12" r="2" /><path d="M12 7v10M14 12h2" /></svg>) },
  { id: "replay", label: "Replay", color: "#50C8B4", category: "Memory", component: ReplayView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>) },
  { id: "worldwindow", label: "World", color: "#64C8FF", category: "World", component: WorldWindowView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15 15 0 010 20M12 2a15 15 0 000 20" /></svg>) },
  { id: "browser", label: "Browser", color: "#64C8FF", category: "World", component: BrowserView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>) },
  { id: "chain", label: "Chain", color: "#00FF64", category: "World", component: ChainView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></svg>) },
  { id: "garden", label: "Garden", color: "#00E676", category: "World", component: GardenView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M12 22V12" /><path d="M7 12c0-3 2-7 5-10 3 3 5 7 5 10" /><path d="M7 12c-2 0-5 1-5 4 3 0 5-1 5-4z" /><path d="M17 12c2 0 5 1 5 4-3 0-5-1-5-4z" /></svg>) },
  { id: "trader", label: "Trader", color: "#00ff88", category: "World", component: TraderView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>) },
  { id: "monitor", label: "Monitor", color: "#ff3232", category: "System", component: MonitorView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /><path d="M7 10h2l2-3 2 6 2-3h2" /></svg>) },
  { id: "health", label: "Health", color: "#FF3232", category: "System", component: HealthView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>) },
  { id: "impulse", label: "Impulse", color: "#FF9600", category: "System", component: ImpulseView,
    icon: icon("M13 2L3 14h9l-1 8 10-12h-9l1-8z") },
  { id: "mcp", label: "MCP", color: "#00C8FF", category: "System", component: MCPView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>) },
  { id: "settings", label: "Settings", color: "#8B80F0", category: "System", component: SettingsView,
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4"><circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" /></svg>) },
];

const APP_MAP = Object.fromEntries(APPS.map((a) => [a.id, a])) as Record<AppId, AppDef>;

const CATEGORIES = [
  { label: "Mind", color: "#B464FF", panels: APPS.filter((a) => a.category === "Mind").map((a) => a.id) },
  { label: "Memory", color: "#FFC800", panels: APPS.filter((a) => a.category === "Memory").map((a) => a.id) },
  { label: "World", color: "#64C8FF", panels: APPS.filter((a) => a.category === "World").map((a) => a.id) },
  { label: "System", color: "#00FFC8", panels: APPS.filter((a) => a.category === "System").map((a) => a.id) },
];

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
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center" style={{ backgroundColor: "#000", opacity: phase === "hold" ? 1 : 0, transition: "opacity 0.8s ease" }}>
      <img src="/logo.png" alt="" className="w-24 h-24 mb-6" style={{ filter: "drop-shadow(0 0 40px rgba(var(--accent-rgb), 0.4))", transform: phase === "hold" ? "scale(1)" : "scale(0.95)", transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)" }} />
      <div className="w-8 h-0.5 rounded-full overflow-hidden mt-8" style={{ backgroundColor: "rgba(var(--accent-rgb), 0.15)", opacity: phase === "hold" ? 1 : 0 }}>
        <div className="h-full rounded-full" style={{ backgroundColor: "rgba(var(--accent-rgb), 0.5)", width: phase === "hold" ? "100%" : "0%", transition: "width 1.8s ease-in-out 0.3s" }} />
      </div>
    </div>
  );
}

/* ── App Phase ────────────────────────────────────────────── */

type AppPhase = "loading" | "setup" | "founding" | "ready";

/* ── Desktop (ready phase inner) ─────────────────────────── */

function Desktop() {
  const { nodes, isWorking } = useActiveNodes();
  const currentPulse = useCurrentPulse();
  const mood = useMood();
  const feed = useActivityFeed();
  const { windows, openWindow } = useWindowManager();
  const { unreadCount } = useNotifications();
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  const toggleLauncher = useCallback(() => {
    setLauncherOpen((p) => !p);
    setNotifOpen(false);
  }, []);

  const toggleNotif = useCallback(() => {
    setNotifOpen((p) => !p);
    setLauncherOpen(false);
  }, []);

  /* Keyboard: Cmd+1-9 open apps, ESC close launcher, Cmd+B browser */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el?.closest(".xterm") || el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") return;

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault(); toggleBrowserMode(); return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault(); toggleBrowser(); return;
      }
      if (e.key === "Escape") {
        setLauncherOpen(false); setNotifOpen(false); return;
      }
      const num = parseInt(e.key);
      if ((e.metaKey || e.ctrlKey) && num >= 1 && num <= 9) {
        e.preventDefault();
        const app = APPS[num - 1];
        if (app) openWindow(app.id, app.label, app.icon, app.color);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openWindow]);

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* macOS drag region */}
      <div className="h-7 flex-shrink-0 flex items-center justify-center" onMouseDown={() => getCurrentWindow().startDragging()}>
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="" className="w-3.5 h-3.5" style={{ filter: "drop-shadow(0 0 6px rgba(var(--accent-rgb),0.4))", opacity: 0.6 }} />
          <span className="text-[10px] font-semibold tracking-[0.2em]" style={{ color: "var(--text-dim)" }}>soulOS</span>
        </div>
      </div>

      {/* Main area: Desktop + Terminal */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Desktop area (brain canvas + windows) */}
        <div className="relative overflow-hidden" style={{ flex: "3 1 0%", minHeight: 0 }}>
          {/* Brain canvas as desktop background */}
          <div className="absolute inset-0 pointer-events-none">
            <BrainCanvas activeNodes={nodes} isWorking={isWorking} />
          </div>

          {/* Activity feed */}
          {windows.length === 0 && (
            <div className="absolute top-2 left-2 pointer-events-none" style={{ maxWidth: "45%", opacity: isWorking ? 1 : 0.3, transition: "opacity 1.2s ease" }}>
              <div className="pointer-events-auto" style={{ maxHeight: "140px", overflow: "hidden" }}>
                <ActivityFeed feed={feed} activeNodes={nodes} />
              </div>
            </div>
          )}

          {/* Windows */}
          {windows.map((w) => {
            const appDef = APP_MAP[w.id as AppId];
            if (!appDef) return null;
            const Component = appDef.component;
            return (
              <Window key={w.id} state={w}>
                <Component />
              </Window>
            );
          })}
        </div>

        {/* Terminal area */}
        <div className="border-t border-white/5 flex-shrink-0" style={{ flex: "2 1 0%", minHeight: "120px" }}>
          <TerminalView />
        </div>
      </div>

      {/* Taskbar */}
      <Taskbar
        isWorking={isWorking}
        currentPulse={currentPulse}
        mood={mood}
        onLauncherToggle={toggleLauncher}
        launcherOpen={launcherOpen}
        notifications={unreadCount}
        onNotificationClick={toggleNotif}
      />

      {/* App Launcher overlay */}
      {launcherOpen && (
        <AppLauncher apps={APPS} categories={CATEGORIES} onClose={() => setLauncherOpen(false)} />
      )}

      {/* Notification panel */}
      {notifOpen && (
        <>
          <div className="fixed inset-0 z-[997]" onClick={() => setNotifOpen(false)} />
          <div className="fixed bottom-12 right-3 z-[999]">
            <NotificationList onClose={() => setNotifOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}

/* ── App ───────────────────────────────────────────────────── */

function App() {
  const [booting, setBooting] = useState(true);
  const [appPhase, setAppPhase] = useState<AppPhase>("loading");
  const [showOnboarding, setShowOnboarding] = useState(false);

  const handleBootDone = useCallback(() => setBooting(false), []);

  useEngineSocket();

  useEffect(() => {
    if (booting) return;
    commands.getAppState()
      .then((state) => setAppPhase(state as AppPhase))
      .catch(() => setAppPhase("setup"));
  }, [booting]);

  useEffect(() => {
    if (appPhase !== "ready") return;
    if (localStorage.getItem("soul-onboarding-dismissed")) return;
    commands.getSoulStatus()
      .then((status) => { if (status.sessions < 5) setShowOnboarding(true); })
      .catch(() => {});
  }, [appPhase]);

  useEffect(() => {
    if (booting || appPhase !== "ready") return;
    const unlistenPromise = onBrowserOpenUrl((url) => openUrl(url));
    const clickHandler = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest("a[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
        e.preventDefault(); openUrl(href);
      }
    };
    document.addEventListener("click", clickHandler);
    return () => { unlistenPromise.then((fn) => fn()); document.removeEventListener("click", clickHandler); };
  }, [booting, appPhase]);

  return (
    <>
      {booting && <BootSplash onDone={handleBootDone} />}

      {!booting && appPhase === "setup" && (
        <div className="h-full" style={{ backgroundColor: "var(--bg-base)" }}>
          <div className="h-8 flex-shrink-0" onMouseDown={() => getCurrentWindow().startDragging()} />
          <div style={{ height: "calc(100% - 32px)" }}>
            <SetupWizard onComplete={() => setAppPhase("founding")} />
          </div>
        </div>
      )}

      {!booting && appPhase === "founding" && (
        <div className="h-full" style={{ backgroundColor: "var(--bg-base)" }}>
          <div className="h-8 flex-shrink-0" onMouseDown={() => getCurrentWindow().startDragging()} />
          <div style={{ height: "calc(100% - 32px)" }}>
            <FoundingChat onComplete={() => setAppPhase("ready")} />
          </div>
        </div>
      )}

      {!booting && appPhase === "ready" && (
        <WindowManagerProvider>
          <NotificationProvider engineUrl="http://localhost:3002" apiKey={localStorage.getItem("soul-api-key") || ""}>
            <Desktop />
            {showOnboarding && (
              <div className="absolute inset-0 z-40 frosted" style={{ backgroundColor: "rgba(5, 8, 15, 0.85)" }}>
                <OnboardingView onDismiss={() => { setShowOnboarding(false); localStorage.setItem("soul-onboarding-dismissed", "true"); }} />
              </div>
            )}
          </NotificationProvider>
        </WindowManagerProvider>
      )}

      {!booting && appPhase === "loading" && (
        <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
          <div className="animate-pulse text-xs" style={{ color: "var(--text-dim)" }}>...</div>
        </div>
      )}
    </>
  );
}

export default App;
