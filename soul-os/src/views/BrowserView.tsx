import { useState } from "react";
import { openUrl } from "../lib/browser";

const BOOKMARKS = [
  { label: "GitHub", url: "https://github.com/hbcaspa/projectSoul", icon: "🐙" },
  { label: "Telegram Web", url: "https://web.telegram.org", icon: "💬" },
  { label: "Claude", url: "https://claude.ai", icon: "🧠" },
  { label: "Hacker News", url: "https://news.ycombinator.com", icon: "📰" },
  { label: "ChatGPT", url: "https://chatgpt.com", icon: "🤖" },
  { label: "Soul Engine API", url: "http://localhost:3001", icon: "⚡" },
];

export default function BrowserView() {
  const [url, setUrl] = useState("");

  const handleGo = () => {
    if (!url.trim()) return;
    const fullUrl = url.startsWith("http") ? url : `https://${url}`;
    openUrl(fullUrl);
    setUrl("");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "var(--bewusstsein)" }}>
          Browser
        </h2>
        <p className="text-xs" style={{ color: "var(--text-dim)" }}>
          Open URLs in the SoulOS embedded browser or system default.
        </p>
      </div>

      {/* URL Bar */}
      <div className="flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleGo()}
          placeholder="Enter URL..."
          className="flex-1 px-4 py-2.5 rounded-xl text-sm neon-input"
          style={{ fontSize: "13px" }}
        />
        <button
          onClick={handleGo}
          className="px-5 py-2.5 rounded-xl text-xs font-semibold uppercase tracking-wider"
          style={{
            background: "rgba(var(--neon-rgb), 0.1)",
            border: "1px solid rgba(var(--neon-rgb), 0.2)",
            color: "var(--bewusstsein)",
          }}
        >
          Go
        </button>
      </div>

      {/* Bookmarks */}
      <div className="space-y-3">
        <h3 className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>
          Quick Access
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {BOOKMARKS.map((bm) => (
            <button
              key={bm.url}
              onClick={() => openUrl(bm.url)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl glass-card glass-card-hover cursor-default text-left"
            >
              <span className="text-lg">{bm.icon}</span>
              <div>
                <div className="text-xs font-medium" style={{ color: "var(--text-bright)" }}>{bm.label}</div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {bm.url.replace(/https?:\/\//, "").split("/")[0]}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Keyboard shortcut hint */}
      <div className="text-[10px] text-center pt-2" style={{ color: "var(--text-muted)" }}>
        <kbd className="px-1.5 py-0.5 rounded" style={{ background: "rgba(var(--white-rgb), 0.05)", border: "1px solid rgba(var(--white-rgb), 0.08)" }}>⌘B</kbd>
        {" "}Toggle browser &nbsp;
        <kbd className="px-1.5 py-0.5 rounded" style={{ background: "rgba(var(--white-rgb), 0.05)", border: "1px solid rgba(var(--white-rgb), 0.08)" }}>⌘⇧B</kbd>
        {" "}Toggle mode
      </div>
    </div>
  );
}
