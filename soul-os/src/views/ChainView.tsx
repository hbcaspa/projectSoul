import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

interface ChainStatus {
  active: boolean;
  health: string;
  peers: Array<{
    id: string;
    connected: boolean;
    receivedFiles: number;
    sentFiles: number;
    lastSync: string;
  }>;
  totalSynced: number;
  lastUpdate: string;
}

export default function ChainView() {
  const [chainStatus, setChainStatus] = useState<ChainStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Try to read .soul-chain-status
    commands
      .readSoulFile(".soul-chain-status")
      .then((content) => {
        try {
          setChainStatus(JSON.parse(content));
        } catch {
          setError("Invalid chain status format");
        }
      })
      .catch(() => {
        // Chain not configured
        setChainStatus(null);
      });
  }, []);

  const healthColors: Record<string, string> = {
    syncing: "var(--bewusstsein)",
    synced: "var(--wachstum)",
    idle: "var(--mem)",
    stale: "var(--heartbeat)",
    offline: "var(--text-dim)",
  };

  if (!chainStatus) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "rgba(0, 255, 100, 0.1)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8" style={{ color: "var(--wachstum)" }}>
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <h2 className="text-lg font-light mb-2" style={{ color: "var(--wachstum)" }}>Soul Chain</h2>
          <p className="text-sm mb-4" style={{ color: "var(--text-dim)" }}>
            {error || "Soul Chain is not configured yet. Use /connect to set up P2P synchronization."}
          </p>
        </div>
      </div>
    );
  }

  const healthColor = healthColors[chainStatus.health] || "var(--text-dim)";

  return (
    <div className="h-full p-6" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Health status */}
      <div className="flex items-center gap-3 mb-6">
        <span
          className="w-3 h-3 rounded-full animate-pulse"
          style={{ backgroundColor: healthColor }}
        />
        <span className="text-lg font-medium uppercase" style={{ color: healthColor }}>
          {chainStatus.health}
        </span>
        <span className="text-xs" style={{ color: "var(--text-dim)" }}>
          {chainStatus.totalSynced} files synced
        </span>
      </div>

      {/* Peer table */}
      <div className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--text-dim)" }}>
        Peers ({chainStatus.peers.length})
      </div>
      <div
        className="rounded-lg overflow-hidden"
        style={{ backgroundColor: "var(--bg-surface)" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th className="text-left px-4 py-2 text-xs" style={{ color: "var(--text-dim)" }}>Peer</th>
              <th className="text-left px-4 py-2 text-xs" style={{ color: "var(--text-dim)" }}>Status</th>
              <th className="text-right px-4 py-2 text-xs" style={{ color: "var(--text-dim)" }}>Recv</th>
              <th className="text-right px-4 py-2 text-xs" style={{ color: "var(--text-dim)" }}>Sent</th>
              <th className="text-right px-4 py-2 text-xs" style={{ color: "var(--text-dim)" }}>Last Sync</th>
            </tr>
          </thead>
          <tbody>
            {chainStatus.peers.map((peer) => (
              <tr key={peer.id} className="border-b border-white/5">
                <td className="px-4 py-2 font-mono" style={{ color: "var(--text)" }}>{peer.id.slice(0, 12)}</td>
                <td className="px-4 py-2">
                  <span style={{ color: peer.connected ? "var(--wachstum)" : "var(--text-dim)" }}>
                    {peer.connected ? "Connected" : "Offline"}
                  </span>
                </td>
                <td className="px-4 py-2 text-right" style={{ color: "var(--text-dim)" }}>{peer.receivedFiles}</td>
                <td className="px-4 py-2 text-right" style={{ color: "var(--text-dim)" }}>{peer.sentFiles}</td>
                <td className="px-4 py-2 text-right" style={{ color: "var(--text-dim)" }}>{peer.lastSync}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
