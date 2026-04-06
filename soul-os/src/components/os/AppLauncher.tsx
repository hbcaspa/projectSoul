import { useState, useEffect, useRef, type ReactNode } from "react";
import { useWindowManager } from "./WindowManager";

interface AppDef {
  id: string;
  label: string;
  color: string;
  icon: ReactNode;
  category: string;
}

interface AppLauncherProps {
  apps: AppDef[];
  categories: { label: string; color: string; panels: string[] }[];
  onClose: () => void;
}

export default function AppLauncher({ apps, categories, onClose }: AppLauncherProps) {
  const { openWindow } = useWindowManager();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const filtered = search
    ? apps.filter((a) => a.label.toLowerCase().includes(search.toLowerCase()))
    : apps;

  const handleOpen = (app: AppDef) => {
    openWindow(app.id, app.label, app.icon, app.color);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[998]"
        style={{ backgroundColor: "rgba(5, 8, 15, 0.6)", backdropFilter: "blur(8px)" }}
        onClick={onClose}
      />

      {/* Launcher panel */}
      <div className="os-launcher">
        {/* Search */}
        <div className="os-launcher-search">
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--text-dim)" }}>
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3 3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search apps..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="os-launcher-input"
          />
        </div>

        {/* App grid grouped by category */}
        <div className="os-launcher-grid">
          {(search ? [{ label: "Results", color: "var(--text-dim)", panels: filtered.map((a) => a.id) }] : categories).map((cat) => {
            const catApps = filtered.filter((a) => cat.panels.includes(a.id));
            if (catApps.length === 0) return null;
            return (
              <div key={cat.label} className="os-launcher-category">
                <span className="os-launcher-category-label" style={{ color: cat.color }}>
                  {cat.label}
                </span>
                <div className="os-launcher-items">
                  {catApps.map((app) => (
                    <button
                      key={app.id}
                      className="os-launcher-item"
                      onClick={() => handleOpen(app)}
                    >
                      <span className="os-launcher-item-icon" style={{ color: app.color, filter: `drop-shadow(0 0 6px ${app.color}66)` }}>
                        {app.icon}
                      </span>
                      <span className="os-launcher-item-label">{app.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
