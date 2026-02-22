import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

interface StateEntry {
  filename: string;
  date: string;
  time: string;
  type: string;
}

function parseEntry(filename: string): StateEntry | null {
  // Format: YYYY-MM-DD_HH-MM_type.md
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})_(.+)\.md$/);
  if (!match) return null;
  return {
    filename,
    date: match[1],
    time: match[2].replace("-", ":"),
    type: match[3],
  };
}

export default function ReplayView() {
  const [entries, setEntries] = useState<StateEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<StateEntry | null>(null);
  const [content, setContent] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    try {
      const files = await commands.listDirectory("zustandslog");
      const parsed = files
        .map(parseEntry)
        .filter((e): e is StateEntry => e !== null);
      setEntries(parsed);
      if (parsed.length > 0) {
        // Select most recent date
        setSelectedDate(parsed[0].date);
        selectEntry(parsed[0]);
      }
    } catch {
      // zustandslog not accessible, try statelog (English)
      try {
        const files = await commands.listDirectory("statelog");
        const parsed = files
          .map(parseEntry)
          .filter((e): e is StateEntry => e !== null);
        setEntries(parsed);
        if (parsed.length > 0) {
          setSelectedDate(parsed[0].date);
          selectEntry(parsed[0]);
        }
      } catch {
        // No state log available
      }
    }
  };

  const selectEntry = async (entry: StateEntry) => {
    setSelectedEntry(entry);
    try {
      const text = await commands.readSoulFile(`zustandslog/${entry.filename}`);
      setContent(text);
    } catch {
      try {
        const text = await commands.readSoulFile(`statelog/${entry.filename}`);
        setContent(text);
      } catch (e) {
        setContent(`Error loading: ${e}`);
      }
    }
  };

  const filteredEntries = entries.filter((e) => e.date === selectedDate);
  const uniqueDates = [...new Set(entries.map((e) => e.date))].sort().reverse();

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Header with date selector */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-white/5 flex-shrink-0">
        <h2 className="text-sm uppercase tracking-wider" style={{ color: "var(--statelog)", opacity: 0.7 }}>
          State Replay
        </h2>
        <select
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="px-3 py-1 rounded-md text-sm"
          style={{
            backgroundColor: "var(--bg-surface)",
            color: "var(--text)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          {uniqueDates.map((date) => (
            <option key={date} value={date}>{date}</option>
          ))}
        </select>
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          {filteredEntries.length} snapshots
        </span>
        <span className="text-xs ml-auto" style={{ color: "var(--text-dim)" }}>
          {entries.length} total
        </span>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Timeline */}
        <div
          className="w-48 border-r border-white/5 overflow-auto p-3"
          style={{ backgroundColor: "var(--bg-surface)" }}
        >
          {filteredEntries.length === 0 ? (
            <p className="text-xs p-2" style={{ color: "var(--text-dim)" }}>
              No snapshots for this date
            </p>
          ) : (
            filteredEntries.map((entry) => (
              <button
                key={entry.filename}
                onClick={() => selectEntry(entry)}
                className="w-full text-left px-3 py-2 rounded-md text-xs mb-1 transition-colors"
                style={{
                  backgroundColor:
                    selectedEntry?.filename === entry.filename
                      ? "rgba(80, 200, 180, 0.15)"
                      : "transparent",
                  color:
                    selectedEntry?.filename === entry.filename
                      ? "var(--statelog)"
                      : "var(--text-dim)",
                }}
              >
                <div className="font-mono">{entry.time}</div>
                <div className="opacity-70">{entry.type}</div>
              </button>
            ))
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {content ? (
            <pre
              className="text-sm leading-relaxed whitespace-pre-wrap font-mono"
              style={{ color: "var(--text)" }}
            >
              {content}
            </pre>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                Select a snapshot to view
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
