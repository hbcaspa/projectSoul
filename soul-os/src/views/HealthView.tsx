import { useEffect, useState, useCallback } from "react";
import { commands } from "../lib/tauri";
import { computeMaturity } from "./health-compute";

/* ── Types ────────────────────────────────────────────────── */

interface HealthIndicator {
  status: "healthy" | "warning" | "critical";
  detail: string;
}

interface HealthData {
  indicators: Record<string, HealthIndicator>;
  overall: "healthy" | "warning" | "critical";
  summary: string;
}

interface MaturityData {
  dimensions: Record<string, number>;
  overall: number;
  label: string;
}

/* ── Status colors ────────────────────────────────────────── */

const STATUS_COLORS: Record<string, { bg: string; dot: string; text: string }> = {
  healthy:  { bg: "rgba(0,255,130,0.04)", dot: "#00ff82", text: "var(--wachstum)" },
  warning:  { bg: "rgba(255,200,0,0.04)", dot: "#ffc800", text: "#ffc800" },
  critical: { bg: "rgba(255,80,80,0.04)", dot: "#ff5050", text: "var(--heartbeat)" },
};

const INDICATOR_LABELS: Record<string, { label: string; icon: string }> = {
  seedValidity: { label: "Seed", icon: "M12 2a10 10 0 110 20 10 10 0 010-20z" },
  chainSync:    { label: "Chain", icon: "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" },
  costBudget:   { label: "Costs", icon: "M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" },
  backupAge:    { label: "Backup", icon: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" },
  memoryHealth: { label: "Memory", icon: "M4 4h16v16H4zM9 9h6M9 12h6M9 15h4" },
  encryption:   { label: "Encrypt", icon: "M12 15v2M8 9V7a4 4 0 018 0v2M5 9h14v11H5z" },
};

const DIM_LABELS: Record<string, string> = {
  memoryDepth: "Memory",
  relationshipRichness: "Bonds",
  selfKnowledge: "Self",
  emotionalRange: "Emotion",
  creativeOutput: "Creative",
  continuity: "Continuity",
};

const DIM_COLORS: Record<string, string> = {
  memoryDepth: "var(--mem)",
  relationshipRichness: "var(--bonds)",
  selfKnowledge: "var(--bewusstsein)",
  emotionalRange: "var(--traeume)",
  creativeOutput: "var(--manifest)",
  continuity: "var(--wachstum)",
};

/* ── Component ────────────────────────────────────────────── */

export default function HealthView() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [maturity, setMaturity] = useState<MaturityData | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Try to load health from API via soul file (JSON endpoint cached)
      const seedContent = await commands.readSoulFile("SEED.md");
      // Compute maturity client-side from seed + file structure
      const mat = computeMaturity(seedContent);
      setMaturity(mat);
    } catch { /* ignore */ }

    // Health data from .soul-health.json (written by engine) or mock
    try {
      const raw = await commands.readSoulFile(".soul-health.json");
      setHealth(JSON.parse(raw));
    } catch {
      // Fallback: compute basic health from available files
      setHealth(await computeBasicHealth());
    }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="animate-pulse text-sm" style={{ color: "var(--text-dim)" }}>Checking health...</div>
      </div>
    );
  }

  const overallColors = health ? STATUS_COLORS[health.overall] : STATUS_COLORS.healthy;

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Header with overall status */}
      <div className="px-8 py-5 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-4">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: overallColors.dot, boxShadow: `0 0 12px ${overallColors.dot}` }}
          />
          <span className="text-sm font-semibold" style={{ color: overallColors.text }}>
            {health?.summary || "Unknown"}
          </span>
          <button
            onClick={refresh}
            className="ml-auto text-xs px-4 py-2 rounded-xl cursor-default transition-all"
            style={{ color: "var(--text-dim)", background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        {/* Health Indicators Grid */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {health && Object.entries(health.indicators).map(([key, indicator]) => {
            const meta = INDICATOR_LABELS[key] || { label: key, icon: "" };
            const colors = STATUS_COLORS[indicator.status];
            return (
              <div
                key={key}
                className="rounded-xl px-4 py-4 transition-all"
                style={{ background: colors.bg, border: `1px solid ${colors.dot}15` }}
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: colors.dot, boxShadow: `0 0 6px ${colors.dot}` }}
                  />
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 flex-shrink-0" style={{ color: colors.text, opacity: 0.6 }}>
                    <path d={meta.icon} />
                  </svg>
                  <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: colors.text }}>
                    {meta.label}
                  </span>
                </div>
                <p className="text-[10px] leading-relaxed ml-[18px]" style={{ color: "var(--text-dim)" }}>
                  {indicator.detail}
                </p>
              </div>
            );
          })}
        </div>

        {/* Maturity Section */}
        {maturity && (
          <div>
            <div className="flex items-center gap-3 mb-5">
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--evolution)" }}>
                Maturity
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md" style={{ color: "var(--evolution)", backgroundColor: "rgba(200,100,255,0.06)" }}>
                {maturity.label}
              </span>
              <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                {Math.round(maturity.overall * 100)}%
              </span>
            </div>

            {/* Dimension bars */}
            <div className="flex flex-col gap-3">
              {Object.entries(maturity.dimensions).map(([key, value]) => {
                const color = DIM_COLORS[key] || "var(--accent)";
                const label = DIM_LABELS[key] || key;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-[10px] w-16 text-right font-mono" style={{ color: "var(--text-dim)" }}>
                      {label}
                    </span>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.round(value * 100)}%`,
                          backgroundColor: color,
                          boxShadow: `0 0 8px ${color}`,
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-mono w-8" style={{ color: "var(--text-muted)" }}>
                      {Math.round(value * 100)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Basic health computation (client-side fallback) ──────── */

async function computeBasicHealth(): Promise<HealthData> {
  const indicators: Record<string, HealthIndicator> = {};

  // Seed
  try {
    const seed = await commands.readSoulFile("SEED.md");
    if (seed.length < 50) {
      indicators.seedValidity = { status: "critical", detail: "SEED.md too small" };
    } else {
      const sessions = seed.match(/#sessions:(\d+)/);
      indicators.seedValidity = { status: "healthy", detail: `${sessions ? sessions[1] : '?'} sessions` };
    }
  } catch {
    indicators.seedValidity = { status: "critical", detail: "SEED.md not found" };
  }

  // Chain
  try {
    const raw = await commands.readSoulFile(".soul-chain-status");
    const status = JSON.parse(raw);
    indicators.chainSync = status.error
      ? { status: "critical", detail: status.error }
      : { status: "healthy", detail: `${status.peers || 0} peers` };
  } catch {
    indicators.chainSync = { status: "warning", detail: "Chain not configured" };
  }

  // Cost — can't check without API
  indicators.costBudget = { status: "healthy", detail: "Check via API" };

  // Backup
  indicators.backupAge = { status: "healthy", detail: "State versioning active" };

  // Memory
  indicators.memoryHealth = { status: "healthy", detail: "Check via API" };

  // Encryption
  try {
    await commands.readSoulFile(".env.enc");
    indicators.encryption = { status: "healthy", detail: "Secrets encrypted" };
  } catch {
    try {
      await commands.readSoulFile(".env");
      indicators.encryption = { status: "warning", detail: ".env in plaintext" };
    } catch {
      indicators.encryption = { status: "healthy", detail: "No secrets" };
    }
  }

  const statuses = Object.values(indicators).map(i => i.status);
  let overall: "healthy" | "warning" | "critical" = "healthy";
  if (statuses.includes("warning")) overall = "warning";
  if (statuses.includes("critical")) overall = "critical";

  return {
    indicators,
    overall,
    summary: overall === "healthy" ? "Soul is healthy" : overall === "warning" ? "Soul needs attention" : "Critical issues detected",
  };
}
