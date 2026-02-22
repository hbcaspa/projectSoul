import { useEffect, useState } from "react";
import { commands, type GitCommit } from "../lib/tauri";

export default function HistoryView() {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<GitCommit | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { loadHistory(); }, []);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const history = await commands.getStateHistory(100);
      setCommits(history);
      if (history.length > 0) selectCommit(history[0]);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const selectCommit = async (commit: GitCommit) => {
    setSelectedCommit(commit);
    try { setDiff(await commands.getStateDiff(commit.hash)); }
    catch (e) { setDiff(`Error loading diff: ${e}`); }
  };

  const handleRollback = async (commit: GitCommit) => {
    if (!confirm(`Revert commit "${commit.message}"?`)) return;
    try {
      await commands.rollbackState(commit.hash);
      await loadHistory();
    } catch (e) { setError(`Rollback failed: ${e}`); }
  };

  const grouped: Record<string, GitCommit[]> = {};
  for (const c of commits) {
    const date = c.date.split(" ")[0];
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(c);
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="animate-pulse text-sm" style={{ color: "var(--text-dim)" }}>Loading history...</div>
      </div>
    );
  }

  if (error && commits.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5" style={{ background: "linear-gradient(135deg, rgba(200,100,255,0.06), rgba(139,128,240,0.03))", border: "1px solid rgba(200,100,255,0.08)", boxShadow: "0 4px 24px rgba(200,100,255,0.06)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-9 h-9" style={{ color: "var(--evolution)", opacity: 0.4 }}>
            <circle cx="12" cy="5" r="2" /><circle cx="12" cy="19" r="2" /><circle cx="18" cy="12" r="2" /><path d="M12 7v10M14 12h2" />
          </svg>
        </div>
        <p className="text-base font-light" style={{ color: "var(--text-dim)" }}>No version history</p>
        <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>State versioning creates git commits as your soul evolves</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="flex items-center gap-4 px-8 py-3.5 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="text-xs font-mono" style={{ color: "var(--text-dim)" }}>{commits.length} commits</span>
        <button onClick={loadHistory} className="ml-auto text-xs px-4 py-2 rounded-xl cursor-default transition-all" style={{ color: "var(--text-dim)", background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.06)" }}>
          Refresh
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="w-80 overflow-auto py-4 px-4" style={{ borderRight: "1px solid rgba(255,255,255,0.04)" }}>
          {Object.entries(grouped).map(([date, dateCommits]) => (
            <div key={date} className="mb-5">
              <div className="text-xs font-mono mb-2 px-3 font-semibold" style={{ color: "var(--text-dim)" }}>{date}</div>
              <div className="flex flex-col gap-1">
                {dateCommits.map((commit) => {
                  const isSel = selectedCommit?.hash === commit.hash;
                  return (
                    <button key={commit.hash} onClick={() => selectCommit(commit)} className="w-full text-left px-4 py-3 rounded-xl text-xs transition-all cursor-default" style={{ background: isSel ? "linear-gradient(135deg, rgba(139,128,240,0.1), rgba(139,128,240,0.03))" : "transparent", border: isSel ? "1px solid rgba(139,128,240,0.15)" : "1px solid transparent", color: isSel ? "var(--accent)" : "var(--text)" }}>
                      <div className="flex items-center gap-2.5 mb-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isSel ? "var(--accent)" : "var(--text-dim)", opacity: isSel ? 1 : 0.3 }} />
                        <span className="font-mono" style={{ opacity: 0.5 }}>{commit.hash.slice(0, 7)}</span>
                        <span style={{ opacity: 0.4 }}>{commit.date.split(" ")[1]?.slice(0, 5)}</span>
                      </div>
                      <div className="truncate pl-5">{commit.message}</div>
                      {commit.files_changed > 0 && <div className="mt-0.5 pl-5" style={{ opacity: 0.3 }}>{commit.files_changed} file{commit.files_changed > 1 ? "s" : ""}</div>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {selectedCommit && (
            <div className="flex items-center gap-4 px-8 py-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <span className="font-mono text-xs" style={{ color: "var(--accent)" }}>{selectedCommit.hash.slice(0, 12)}</span>
              <span className="text-sm truncate flex-1" style={{ color: "var(--text)" }}>{selectedCommit.message}</span>
              <button onClick={() => handleRollback(selectedCommit)} className="text-xs px-4 py-2 rounded-xl transition-all cursor-default flex-shrink-0" style={{ background: "linear-gradient(135deg, rgba(255,50,50,0.08), rgba(255,50,50,0.02))", color: "var(--heartbeat)", border: "1px solid rgba(255,50,50,0.1)" }}>
                Revert
              </button>
            </div>
          )}
          <div className="flex-1 overflow-auto p-8">
            {diff ? (
              <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap">
                {diff.split("\n").map((line, i) => {
                  let color = "var(--text-dim)";
                  if (line.startsWith("+") && !line.startsWith("+++")) color = "var(--wachstum)";
                  else if (line.startsWith("-") && !line.startsWith("---")) color = "var(--heartbeat)";
                  else if (line.startsWith("@@")) color = "var(--accent)";
                  else if (line.startsWith("diff") || line.startsWith("commit")) color = "var(--text-bright)";
                  return <span key={i} style={{ color }}>{line}{"\n"}</span>;
                })}
              </pre>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>Select a commit</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
