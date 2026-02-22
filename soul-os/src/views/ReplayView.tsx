import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

interface StateEntry { filename: string; date: string; time: string; type: string; }

function parseEntry(filename: string): StateEntry | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})_(.+)\.md$/);
  if (!match) return null;
  return { filename, date: match[1], time: match[2].replace("-", ":"), type: match[3] };
}

const TYPE_COLORS: Record<string, string> = {
  start: "var(--wachstum)", ende: "var(--heartbeat)", end: "var(--heartbeat)",
  heartbeat: "var(--bewusstsein)", reflection: "var(--traeume)", dream: "var(--traeume)", impulse: "var(--manifest)",
};

export default function ReplayView() {
  const [entries, setEntries] = useState<StateEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<StateEntry | null>(null);
  const [content, setContent] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);

  useEffect(() => { loadEntries(); }, []);

  const loadEntries = async () => {
    try {
      const files = await commands.listDirectory("zustandslog");
      const parsed = files.map(parseEntry).filter((e): e is StateEntry => e !== null);
      setEntries(parsed);
      if (parsed.length > 0) { setSelectedDate(parsed[0].date); selectEntry(parsed[0]); }
    } catch {
      try {
        const files = await commands.listDirectory("statelog");
        const parsed = files.map(parseEntry).filter((e): e is StateEntry => e !== null);
        setEntries(parsed);
        if (parsed.length > 0) { setSelectedDate(parsed[0].date); selectEntry(parsed[0]); }
      } catch { /* no log */ }
    }
  };

  const selectEntry = async (entry: StateEntry) => {
    setSelectedEntry(entry);
    try { setContent(await commands.readSoulFile(`zustandslog/${entry.filename}`)); }
    catch {
      try { setContent(await commands.readSoulFile(`statelog/${entry.filename}`)); }
      catch (e) { setContent(`Error loading: ${e}`); }
    }
  };

  const filteredEntries = entries.filter((e) => e.date === selectedDate);
  const uniqueDates = [...new Set(entries.map((e) => e.date))].sort().reverse();

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="flex items-center gap-4 px-8 py-3.5 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="glass-inset px-4 py-2.5 text-xs cursor-default" style={{ color: "var(--text)", borderRadius: "var(--radius-lg)" }}>
          {uniqueDates.map((date) => <option key={date} value={date}>{date}</option>)}
        </select>
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>{filteredEntries.length} snapshot{filteredEntries.length !== 1 ? "s" : ""}</span>
        <span className="text-xs ml-auto font-mono" style={{ color: "var(--text-muted)" }}>{entries.length} total</span>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-52 overflow-auto py-4 px-3" style={{ borderRight: "1px solid rgba(255,255,255,0.04)" }}>
          {filteredEntries.length === 0 ? (
            <p className="text-xs px-3 py-2" style={{ color: "var(--text-muted)" }}>No snapshots</p>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredEntries.map((entry) => {
                const isActive = selectedEntry?.filename === entry.filename;
                const color = TYPE_COLORS[entry.type] || "var(--statelog)";
                return (
                  <button key={entry.filename} onClick={() => selectEntry(entry)} className="w-full text-left px-4 py-3 rounded-xl text-xs transition-all cursor-default" style={{ background: isActive ? `linear-gradient(135deg, color-mix(in srgb, ${color} 10%, transparent), rgba(255,255,255,0.01))` : "transparent", border: isActive ? `1px solid color-mix(in srgb, ${color} 15%, transparent)` : "1px solid transparent" }}>
                    <div className="flex items-center gap-2.5">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: isActive ? color : "var(--text-dim)", opacity: isActive ? 1 : 0.3, boxShadow: isActive ? `0 0 8px ${color}40` : "none" }} />
                      <span className="font-mono" style={{ color: isActive ? color : "var(--text-dim)" }}>{entry.time}</span>
                    </div>
                    <div className="ml-5 mt-1 capitalize" style={{ color: isActive ? "var(--text)" : "var(--text-dim)", opacity: 0.7 }}>{entry.type}</div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-8">
          {content ? (
            <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono" style={{ color: "var(--text)" }}>{content}</pre>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>Select a snapshot</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
