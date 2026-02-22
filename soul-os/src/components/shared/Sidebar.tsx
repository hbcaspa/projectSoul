import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ViewId } from "../../App";

interface SidebarProps {
  activeView: ViewId;
  onViewChange: (view: ViewId) => void;
}

interface NavItem {
  id: ViewId;
  label: string;
  icon: string;
  color: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "brain", label: "Brain", icon: "brain", color: "var(--bewusstsein)" },
  { id: "whisper", label: "Whisper", icon: "wave", color: "var(--traeume)" },
  { id: "card", label: "Card", icon: "card", color: "var(--seed)" },
  { id: "chain", label: "Chain", icon: "link", color: "var(--wachstum)" },
  { id: "impulse", label: "Impulse", icon: "bolt", color: "var(--manifest)" },
  { id: "graph", label: "Graph", icon: "diamond", color: "var(--interessen)" },
  { id: "replay", label: "Replay", icon: "clock", color: "var(--statelog)" },
  { id: "history", label: "History", icon: "git", color: "var(--evolution)" },
  { id: "founding", label: "Founding", icon: "seed", color: "var(--kern)" },
  { id: "terminal", label: "Terminal", icon: "terminal", color: "var(--accent)" },
];

const ICONS: Record<string, React.ReactNode> = {
  brain: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <path d="M12 2C8 2 4 5 4 9c0 2.5 1 4 2.5 5.5C8 16 8 18 8 20h8c0-2 0-4 1.5-5.5C19 13 20 11.5 20 9c0-4-4-7-8-7z" />
      <path d="M9 20h6M10 22h4M12 2v2M8 8h8" />
    </svg>
  ),
  wave: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <path d="M2 12c1.5-3 3-4.5 4.5-4.5S9 10.5 10 12s2 4.5 3.5 4.5S16 15 17.5 12 20 7.5 22 12" />
    </svg>
  ),
  card: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="11" r="2.5" />
      <path d="M15 9h3M15 12h3M6 16h12" />
    </svg>
  ),
  link: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  ),
  bolt: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  ),
  diamond: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <circle cx="12" cy="6" r="2" />
      <circle cx="6" cy="14" r="2" />
      <circle cx="18" cy="14" r="2" />
      <path d="M12 8v2M8 13l2-1M16 13l-2-1" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  ),
  git: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="19" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M12 7v10M14 12h2" />
    </svg>
  ),
  seed: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <path d="M12 22V12" />
      <path d="M12 12C12 8 8 4 4 4c0 4 4 8 8 8z" />
      <path d="M12 12c0-4 4-8 8-8-0 4-4 8-8 8z" />
    </svg>
  ),
  terminal: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8l4 4-4 4M13 16h4" />
    </svg>
  ),
  gear: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  ),
};

export default function Sidebar({ activeView, onViewChange }: SidebarProps) {
  return (
    <div
      className="flex flex-col h-full border-r border-white/5"
      style={{
        width: "var(--sidebar-width)",
        backgroundColor: "var(--bg-surface)",
      }}
      data-tauri-drag-region
    >
      {/* Drag region / spacer for traffic lights */}
      <div
        className="h-12 flex-shrink-0"
        onMouseDown={() => getCurrentWindow().startDragging()}
      />

      {/* Nav items */}
      <nav className="flex-1 flex flex-col items-center gap-1 px-2">
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              title={item.label}
              className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 cursor-default"
              style={{
                backgroundColor: isActive ? "var(--accent-glow)" : "transparent",
                color: isActive ? item.color : "var(--text-dim)",
                boxShadow: isActive ? `0 0 12px ${item.color}30` : "none",
              }}
            >
              {ICONS[item.icon]}
            </button>
          );
        })}
      </nav>

      {/* Settings */}
      <div className="flex flex-col items-center pb-4 px-2">
        <button
          onClick={() => onViewChange("settings")}
          title="Settings"
          className="w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-200 cursor-default"
          style={{
            backgroundColor: activeView === "settings" ? "var(--accent-glow)" : "transparent",
            color: activeView === "settings" ? "var(--accent)" : "var(--text-dim)",
          }}
        >
          {ICONS.gear}
        </button>
      </div>
    </div>
  );
}
