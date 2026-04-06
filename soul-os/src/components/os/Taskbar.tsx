import { useState, useEffect } from "react";
import { useWindowManager } from "./WindowManager";

interface TaskbarProps {
  isWorking: boolean;
  currentPulse: { activity_type: string; label: string } | null;
  mood: { label: string | null; valence: number | null } | null;
  onLauncherToggle: () => void;
  launcherOpen: boolean;
  notifications: number;
  onNotificationClick: () => void;
}

export default function Taskbar({
  isWorking,
  currentPulse,
  mood,
  onLauncherToggle,
  launcherOpen,
  notifications,
  onNotificationClick,
}: TaskbarProps) {
  const { windows, focusWindow, minimizeWindow } = useWindowManager();
  const [clock, setClock] = useState(formatTime());

  useEffect(() => {
    const t = setInterval(() => setClock(formatTime()), 30000);
    return () => clearInterval(t);
  }, []);

  const v = mood?.valence ?? 0.5;
  const moodColor = mood
    ? v > 0.6 ? "#00FFC8" : v > 0.3 ? "#8B80F0" : "#FF6496"
    : "var(--text-muted)";

  return (
    <div className="os-taskbar">
      {/* Left: App Launcher */}
      <button
        className={`os-taskbar-launcher ${launcherOpen ? "os-taskbar-launcher-active" : ""}`}
        onClick={onLauncherToggle}
      >
        <svg viewBox="0 0 16 16" className="w-4 h-4">
          <rect x="1" y="1" width="5" height="5" rx="1" fill="currentColor" opacity="0.7" />
          <rect x="8" y="1" width="5" height="5" rx="1" fill="currentColor" opacity="0.5" />
          <rect x="1" y="8" width="5" height="5" rx="1" fill="currentColor" opacity="0.5" />
          <rect x="8" y="8" width="5" height="5" rx="1" fill="currentColor" opacity="0.3" />
        </svg>
      </button>

      <div className="os-taskbar-divider" />

      {/* Center: Open Windows */}
      <div className="os-taskbar-windows">
        {windows.map((w) => (
          <button
            key={w.id}
            className={`os-taskbar-window-btn ${!w.minimized ? "os-taskbar-window-btn-active" : ""}`}
            onClick={() => w.minimized ? minimizeWindow(w.id) : focusWindow(w.id)}
            style={{ "--accent": w.color } as React.CSSProperties}
          >
            <span className="os-taskbar-window-icon" style={{ color: w.color }}>
              {w.icon}
            </span>
            <span className="os-taskbar-window-label">{w.title}</span>
          </button>
        ))}
      </div>

      {/* Right: System Tray */}
      <div className="os-taskbar-tray">
        {/* Pulse indicator */}
        <div className="os-tray-item" title={currentPulse?.label || "Idle"}>
          <span className={`os-tray-dot ${isWorking ? "os-tray-dot-active" : ""}`} />
          <span className="os-tray-text">
            {isWorking ? (currentPulse?.activity_type || "...") : "idle"}
          </span>
        </div>

        <div className="os-taskbar-divider" />

        {/* Mood */}
        <div className="os-tray-item" title={`Mood: ${mood?.label || "..."}`}>
          <span className="os-tray-dot" style={{ backgroundColor: moodColor, boxShadow: `0 0 6px ${moodColor}` }} />
          <span className="os-tray-text" style={{ color: moodColor }}>
            {mood?.label || "—"}
          </span>
        </div>

        <div className="os-taskbar-divider" />

        {/* Notifications */}
        <button className="os-tray-item os-tray-btn" onClick={onNotificationClick}>
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M8 1.5a4 4 0 014 4v3l1.5 2H2.5L4 8.5v-3a4 4 0 014-4z" />
            <path d="M6 12a2 2 0 004 0" />
          </svg>
          {notifications > 0 && (
            <span className="os-tray-badge">{notifications > 9 ? "9+" : notifications}</span>
          )}
        </button>

        <div className="os-taskbar-divider" />

        {/* Clock */}
        <span className="os-tray-clock">{clock}</span>
      </div>
    </div>
  );
}

function formatTime(): string {
  const now = new Date();
  return now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
