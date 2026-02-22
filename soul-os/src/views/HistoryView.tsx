import { useEffect, useState } from "react";
import { commands, type GitCommit } from "../lib/tauri";

export default function HistoryView() {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const history = await commands.getStateHistory(100);
      setCommits(history);
      if (history.length > 0) {
        selectCommit(history[0]);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const selectCommit = async (commit: GitCommit) => {
    setSelectedCommit(commit);
    try {
      const d = await commands.getStateDiff(commit.hash);
      setDiff(d);
    } catch (e) {
      setDiff(`Error loading diff: ${e}`);
    }
  };

  const handleRollback = async (commit: GitCommit) => {
    if (!confirm(`Revert commit "${commit.message}"?`)) return;
    try {
      await commands.rollbackState(commit.hash);
      await loadHistory();
    } catch (e) {
      setError(`Rollback failed: ${e}`);
    }
  };

  // Group commits by date
  const grouped: Record<string, GitCommit[]> = {};
  for (const c of commits) {
    const date = c.date.split(" ")[0];
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(c);
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <p style={{ color: "var(--text-dim)" }}>Loading history...</p>
      </div>
    );
  }

  if (error && commits.length === 0) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="text-center">
          <p className="text-sm mb-2" style={{ color: "var(--text-dim)" }}>
            No version history available
          </p>
          <p className="text-xs" style={{ color: "var(--text-dim)", opacity: 0.5 }}>
            State versioning creates git commits as your soul evolves.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-white/5 flex-shrink-0">
        <h2 className="text-sm uppercase tracking-wider" style={{ color: "var(--evolution)", opacity: 0.7 }}>
          State History
        </h2>
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          {commits.length} commits
        </span>
        <button
          onClick={loadHistory}
          className="ml-auto text-xs px-2 py-1 rounded"
          style={{ color: "var(--text-dim)", backgroundColor: "var(--bg-surface)" }}
        >
          Refresh
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Timeline */}
        <div
          className="w-72 border-r border-white/5 overflow-auto p-3"
          style={{ backgroundColor: "var(--bg-surface)" }}
        >
          {Object.entries(grouped).map(([date, dateCommits]) => (
            <div key={date} className="mb-4">
              <div className="text-xs font-mono mb-2 px-2" style={{ color: "var(--text-dim)" }}>
                {date}
              </div>
              {dateCommits.map((commit) => (
                <button
                  key={commit.hash}
                  onClick={() => selectCommit(commit)}
                  className="w-full text-left px-3 py-2 rounded-md text-xs mb-1 transition-colors group"
                  style={{
                    backgroundColor:
                      selectedCommit?.hash === commit.hash
                        ? "rgba(139, 128, 240, 0.15)"
                        : "transparent",
                    color:
                      selectedCommit?.hash === commit.hash
                        ? "var(--accent)"
                        : "var(--text)",
                  }}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono opacity-50">
                      {commit.hash.slice(0, 7)}
                    </span>
                    <span className="opacity-50">
                      {commit.date.split(" ")[1]?.slice(0, 5)}
                    </span>
                  </div>
                  <div className="truncate">{commit.message}</div>
                  {commit.files_changed > 0 && (
                    <div className="opacity-40 mt-0.5">
                      {commit.files_changed} file{commit.files_changed > 1 ? "s" : ""}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Diff view */}
        <div className="flex-1 flex flex-col min-w-0">
          {selectedCommit && (
            <div className="flex items-center gap-3 px-6 py-3 border-b border-white/5 flex-shrink-0">
              <span className="font-mono text-xs" style={{ color: "var(--accent)" }}>
                {selectedCommit.hash.slice(0, 12)}
              </span>
              <span className="text-xs truncate flex-1" style={{ color: "var(--text)" }}>
                {selectedCommit.message}
              </span>
              <button
                onClick={() => handleRollback(selectedCommit)}
                className="text-xs px-3 py-1 rounded-md transition-colors hover:opacity-80 flex-shrink-0"
                style={{
                  backgroundColor: "rgba(255, 50, 50, 0.1)",
                  color: "var(--heartbeat)",
                }}
              >
                Revert
              </button>
            </div>
          )}
          <div className="flex-1 overflow-auto p-6">
            {diff ? (
              <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap">
                {diff.split("\n").map((line, i) => {
                  let color = "var(--text-dim)";
                  if (line.startsWith("+") && !line.startsWith("+++")) color = "var(--wachstum)";
                  else if (line.startsWith("-") && !line.startsWith("---")) color = "var(--heartbeat)";
                  else if (line.startsWith("@@")) color = "var(--accent)";
                  else if (line.startsWith("diff") || line.startsWith("commit")) color = "var(--text-bright)";
                  return (
                    <span key={i} style={{ color }}>
                      {line}
                      {"\n"}
                    </span>
                  );
                })}
              </pre>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                  Select a commit to view changes
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
