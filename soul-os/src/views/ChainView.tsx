import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

interface ChainStatus {
  active: boolean; health: string;
  peers: Array<{ id: string; connected: boolean; receivedFiles: number; sentFiles: number; lastSync: string; }>;
  totalSynced: number; lastUpdate: string;
}

const healthColors: Record<string, string> = {
  syncing: "var(--bewusstsein)", synced: "var(--wachstum)", idle: "var(--mem)", stale: "var(--heartbeat)", offline: "var(--text-dim)",
};

export default function ChainView() {
  const [chainStatus, setChainStatus] = useState<ChainStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    commands.readSoulFile(".soul-chain-status")
      .then((content) => { try { setChainStatus(JSON.parse(content)); } catch { setError("Invalid chain status format"); } })
      .catch(() => setChainStatus(null));
  }, []);

  if (!chainStatus) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 mx-auto mb-5 rounded-3xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(0,255,100,0.06), rgba(0,220,180,0.03))", border: "1px solid rgba(0,255,100,0.08)", boxShadow: "0 4px 24px rgba(0,255,100,0.06)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-9 h-9" style={{ color: "var(--wachstum)", opacity: 0.4 }}>
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <h2 className="text-lg font-light mb-2" style={{ color: "var(--text-bright)" }}>Soul Chain</h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>{error || "Not configured yet. Use /connect to set up P2P synchronization."}</p>
        </div>
      </div>
    );
  }

  const healthColor = healthColors[chainStatus.health] || "var(--text-dim)";
  const onlinePeers = chainStatus.peers.filter((p) => p.connected).length;

  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="px-8 pt-6 pb-5 flex-shrink-0">
        <div className="glass-card p-7 mb-4" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${healthColor} 6%, transparent), rgba(255,255,255,0.01))` }}>
          <div className="flex items-center gap-5">
            <span className="w-4 h-4 rounded-full animate-breathe" style={{ backgroundColor: healthColor, boxShadow: `0 0 16px ${healthColor}40` }} />
            <span className="text-2xl font-light uppercase tracking-wide" style={{ color: healthColor }}>{chainStatus.health}</span>
            {chainStatus.lastUpdate && <span className="ml-auto text-xs font-mono" style={{ color: "var(--text-muted)" }}>{chainStatus.lastUpdate}</span>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <StatCard value={chainStatus.peers.length} label="Peers" color="var(--graph)" icon={"\u25C6"} />
          <StatCard value={onlinePeers} label="Online" color="var(--wachstum)" icon={"\u25CF"} />
          <StatCard value={chainStatus.totalSynced} label="Synced" color="var(--mem)" icon={"\u2194"} />
        </div>
      </div>
      <div className="flex-1 overflow-auto px-8 pb-6 min-h-0">
        <div className="text-[11px] uppercase tracking-[0.15em] font-semibold mb-3" style={{ color: "var(--text-dim)" }}>Peers ({chainStatus.peers.length})</div>
        <div className="flex flex-col gap-3">
          {chainStatus.peers.map((peer) => (
            <div key={peer.id} className="glass-card glass-card-hover px-6 py-4 transition-all">
              <div className="flex items-center gap-5">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: peer.connected ? "var(--wachstum)" : "var(--text-dim)", boxShadow: peer.connected ? "0 0 10px var(--wachstum)40" : "none" }} />
                <span className="font-mono text-sm flex-1 truncate" style={{ color: "var(--text-bright)" }}>{peer.id.slice(0, 16)}</span>
                <div className="flex items-center gap-6 text-xs">
                  <span style={{ color: "var(--text-dim)" }}><span style={{ color: "var(--wachstum)", opacity: 0.7 }}>{"\u2191"}</span> {peer.sentFiles}</span>
                  <span style={{ color: "var(--text-dim)" }}><span style={{ color: "var(--interessen)", opacity: 0.7 }}>{"\u2193"}</span> {peer.receivedFiles}</span>
                  <span className="font-mono" style={{ color: "var(--text-muted)" }}>{peer.lastSync}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ value, label, color, icon }: { value: number; label: string; color: string; icon: string }) {
  return (
    <div className="glass-card p-5 text-center">
      <div className="flex items-center justify-center gap-2.5">
        <span className="text-xs" style={{ color, opacity: 0.5 }}>{icon}</span>
        <span className="text-2xl font-light" style={{ color }}>{value}</span>
      </div>
      <div className="text-[10px] uppercase tracking-wider mt-1.5" style={{ color: "var(--text-dim)" }}>{label}</div>
    </div>
  );
}
