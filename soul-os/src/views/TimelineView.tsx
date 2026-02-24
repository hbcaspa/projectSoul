import { useEffect, useState, useCallback } from "react";
import { commands, type GitCommit } from "../lib/tauri";

/* ── Types ────────────────────────────────────────────────── */

interface TimelineEntry {
  commit: GitCommit;
  date: string;
  time: string;
  session: number | null;
  memCount: number | null;
  mood: string | null;
  version: string | null;
}

/* ── Seed parsing (lightweight, in-view) ─────────────────── */

function parseSeedMeta(content: string): { session: number | null; memCount: number | null; mood: string | null; version: string | null } {
  const session = content.match(/#sessions:(\d+)/);
  const version = content.match(/#SEED v([^\s]+)/);
  const mood = content.match(/@STATE\{[^}]*(?:zustand|state|mood):([^|\n}]+)/);
  const memBlock = content.match(/@MEM\{([\s\S]*?)\}/);
  const memCount = memBlock
    ? memBlock[1].split("\n").filter(l => l.trim() && !l.trim().startsWith("//")).length
    : null;

  return {
    session: session ? parseInt(session[1]) : null,
    memCount,
    mood: mood ? mood[1].trim() : null,
    version: version ? version[1] : null,
  };
}

/* ── Severity color ──────────────────────────────────────── */

function severityColor(entry: TimelineEntry, prev: TimelineEntry | null): string {
  if (!prev) return "var(--wachstum)"; // first entry — green

  // Critical: session number went down or memories dropped by 3+
  if (entry.session !== null && prev.session !== null && entry.session < prev.session) return "var(--heartbeat)";
  if (entry.memCount !== null && prev.memCount !== null && prev.memCount - entry.memCount >= 3) return "var(--heartbeat)";

  // Significant: version changed
  if (entry.version && prev.version && entry.version !== prev.version) return "var(--manifest)";

  // Normal
  return "var(--wachstum)";
}

/* ── Component ───────────────────────────────────────────── */

export default function TimelineView() {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    try {
      const commits = await commands.getStateHistory(200);

      // Parse seed metadata from each commit that touched SEED.md
      const timelineEntries: TimelineEntry[] = [];
      for (const commit of commits) {
        const parts = commit.date.split(" ");
        const date = parts[0] || "";
        const time = parts[1]?.slice(0, 5) || "";

        // Try to get seed content at this commit (best-effort)
        let meta = { session: null as number | null, memCount: null as number | null, mood: null as string | null, version: null as string | null };
        try {
          await commands.readSoulFile(`SEED.md`);
          // We can only read the current file, not at specific commits
          // So we parse from the commit message for historical data
          const sessionMatch = commit.message.match(/session[s]?\s*[:=]?\s*(\d+)/i);
          if (sessionMatch) meta.session = parseInt(sessionMatch[1]);
        } catch { /* ignore */ }

        timelineEntries.push({
          commit,
          date,
          time,
          ...meta,
        });
      }

      // Parse current seed for the latest entry
      try {
        const currentSeed = await commands.readSoulFile("SEED.md");
        const currentMeta = parseSeedMeta(currentSeed);
        if (timelineEntries.length > 0) {
          timelineEntries[0] = { ...timelineEntries[0], ...currentMeta };
        }
      } catch { /* ignore */ }

      setEntries(timelineEntries);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  const toggleExpand = async (hash: string) => {
    if (expandedHash === hash) {
      setExpandedHash(null);
      return;
    }
    setExpandedHash(hash);
    try {
      setDiff(await commands.getStateDiff(hash));
    } catch (e) {
      setDiff(`Error: ${e}`);
    }
  };

  // Group by date
  const grouped: Record<string, TimelineEntry[]> = {};
  for (const entry of entries) {
    if (!grouped[entry.date]) grouped[entry.date] = [];
    grouped[entry.date].push(entry);
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="animate-pulse text-sm" style={{ color: "var(--text-dim)" }}>Loading timeline...</div>
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5" style={{ background: "linear-gradient(135deg, rgba(200,100,255,0.06), rgba(var(--accent-rgb),0.03))", border: "1px solid rgba(200,100,255,0.08)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-9 h-9" style={{ color: "var(--evolution)", opacity: 0.4 }}>
            <path d="M12 2v20M12 6l-4 4M12 6l4 4" />
          </svg>
        </div>
        <p className="text-base font-light" style={{ color: "var(--text-dim)" }}>No timeline yet</p>
        <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>Timeline builds as your soul grows through sessions</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Header */}
      <div className="flex items-center gap-4 px-8 py-3.5 flex-shrink-0" style={{ borderBottom: "1px solid rgba(var(--white-rgb),0.05)" }}>
        <span className="text-xs font-mono" style={{ color: "var(--text-dim)" }}>
          {entries.length} evolution points
        </span>
        {entries[0]?.session !== null && (
          <span className="text-xs font-mono" style={{ color: "var(--evolution)" }}>
            Session {entries[0].session}
          </span>
        )}
        {entries[0]?.version && (
          <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
            v{entries[0].version}
          </span>
        )}
        <button
          onClick={loadTimeline}
          className="ml-auto text-xs px-4 py-2 rounded-xl cursor-default transition-all"
          style={{ color: "var(--text-dim)", background: "linear-gradient(135deg, rgba(var(--white-rgb),0.04), rgba(var(--white-rgb),0.01))", border: "1px solid rgba(var(--white-rgb),0.06)" }}
        >
          Refresh
        </button>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {Object.entries(grouped).map(([date, dateEntries]) => (
          <div key={date} className="mb-8">
            {/* Date header */}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "var(--evolution)", boxShadow: "0 0 8px var(--evolution)" }} />
              <span className="text-sm font-semibold tracking-wide" style={{ color: "var(--evolution)" }}>
                {date}
              </span>
              <div className="flex-1 h-px" style={{ backgroundColor: "rgba(200,100,255,0.1)" }} />
            </div>

            {/* Entries */}
            <div className="ml-1.5 pl-6" style={{ borderLeft: "1px solid rgba(200,100,255,0.08)" }}>
              {dateEntries.map((entry, i) => {
                const prevEntry = i < dateEntries.length - 1 ? dateEntries[i + 1] : null;
                const dotColor = severityColor(entry, prevEntry);
                const isExpanded = expandedHash === entry.commit.hash;

                return (
                  <div key={entry.commit.hash} className="mb-3 relative">
                    {/* Dot on the line */}
                    <div
                      className="absolute -left-[29px] top-2.5 w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: dotColor, boxShadow: `0 0 6px ${dotColor}` }}
                    />

                    {/* Entry card */}
                    <button
                      onClick={() => toggleExpand(entry.commit.hash)}
                      className="w-full text-left px-4 py-3 rounded-xl transition-all cursor-default"
                      style={{
                        background: isExpanded
                          ? "linear-gradient(135deg, rgba(var(--accent-rgb),0.08), rgba(var(--accent-rgb),0.02))"
                          : "linear-gradient(135deg, rgba(var(--white-rgb),0.02), transparent)",
                        border: isExpanded
                          ? "1px solid rgba(var(--accent-rgb),0.12)"
                          : "1px solid rgba(var(--white-rgb),0.03)",
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                          {entry.time}
                        </span>
                        <span className="text-xs truncate flex-1" style={{ color: "var(--text)" }}>
                          {entry.commit.message}
                        </span>
                        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                          {entry.commit.hash.slice(0, 7)}
                        </span>
                      </div>

                      {/* Metadata badges */}
                      <div className="flex items-center gap-2 mt-1.5 ml-12">
                        {entry.commit.files_changed > 0 && (
                          <span className="text-[9px] px-2 py-0.5 rounded-md" style={{ color: "var(--text-muted)", backgroundColor: "rgba(var(--white-rgb),0.03)" }}>
                            {entry.commit.files_changed} file{entry.commit.files_changed > 1 ? "s" : ""}
                          </span>
                        )}
                        {entry.mood && (
                          <span className="text-[9px] px-2 py-0.5 rounded-md" style={{ color: "var(--bewusstsein)", backgroundColor: "rgba(var(--neon-rgb),0.04)" }}>
                            {entry.mood}
                          </span>
                        )}
                        {entry.memCount !== null && (
                          <span className="text-[9px] px-2 py-0.5 rounded-md" style={{ color: "var(--traeume)", backgroundColor: "rgba(100,100,255,0.04)" }}>
                            {entry.memCount} memories
                          </span>
                        )}
                      </div>
                    </button>

                    {/* Expanded diff */}
                    {isExpanded && (
                      <div className="mt-2 ml-4 mr-2 rounded-xl overflow-hidden" style={{ border: "1px solid rgba(var(--white-rgb),0.04)" }}>
                        <pre className="text-[10px] leading-relaxed font-mono p-4 overflow-auto" style={{ maxHeight: "300px" }}>
                          {diff.split("\n").map((line, li) => {
                            let color = "var(--text-dim)";
                            if (line.startsWith("+") && !line.startsWith("+++")) color = "var(--wachstum)";
                            else if (line.startsWith("-") && !line.startsWith("---")) color = "var(--heartbeat)";
                            else if (line.startsWith("@@")) color = "var(--accent)";
                            return <span key={li} style={{ color }}>{line}{"\n"}</span>;
                          })}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
