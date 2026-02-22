import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";
import { useMood, useCurrentPulse } from "../lib/store";

interface ImpulseState {
  mood?: { valence: number; energy: number; label: string };
  interests?: Record<string, number>;
  dailyCount?: number;
  consecutiveIgnored?: number;
  lastImpulse?: string;
}

interface RlufState {
  impulseWeights?: Record<string, number>;
  totalFeedback?: number;
  lastUpdated?: string;
}

const REFLECTIONS = [
  { label: "Pattern Scan", interval: "4h", icon: "\u25C9", color: "var(--bewusstsein)", desc: "Scans for behavioral patterns" },
  { label: "Memory Consolidation", interval: "8h", icon: "\u25CB", color: "var(--mem)", desc: "Strengthens important memories" },
  { label: "Relationship Reflection", interval: "12h", icon: "\u25C7", color: "var(--bonds)", desc: "Reviews connection quality" },
  { label: "Goal Tracking", interval: "24h", icon: "\u25B3", color: "var(--manifest)", desc: "Tracks progress toward goals" },
  { label: "Creative Collision", interval: "6h", icon: "\u2726", color: "var(--garten)", desc: "Generates unexpected connections" },
];

export default function ImpulseView() {
  const [impulseState, setImpulseState] = useState<ImpulseState | null>(null);
  const [rlufState, setRlufState] = useState<RlufState | null>(null);
  const mood = useMood();
  const currentPulse = useCurrentPulse();

  useEffect(() => {
    commands.readSoulFile(".soul-impulse-state")
      .then((c) => { try { setImpulseState(JSON.parse(c)); } catch {} })
      .catch(() => {});
    commands.readSoulFile(".soul-rluf-state")
      .then((c) => { try { setRlufState(JSON.parse(c)); } catch {} })
      .catch(() => {});
  }, []);

  const v = mood?.valence ?? impulseState?.mood?.valence ?? 0;
  const e = mood?.energy ?? impulseState?.mood?.energy ?? 0;
  const label = mood?.label ?? impulseState?.mood?.label ?? "neutral";
  const vColor = v > 0.2 ? "var(--wachstum)" : v < -0.2 ? "var(--heartbeat)" : "var(--bewusstsein)";
  const eColor = e > 0.2 ? "var(--bewusstsein)" : e < -0.2 ? "var(--traeume)" : "var(--accent)";

  const interests = impulseState?.interests || {};
  const sortedInterests = Object.entries(interests).sort(([, a], [, b]) => b - a);
  const rlufWeights = rlufState?.impulseWeights || {};
  const sortedRluf = Object.entries(rlufWeights).sort(([, a], [, b]) => b - a);

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="h-full flex flex-col px-8 py-6">

        {/* ── Top Row: Mood + Activity ────────────────────── */}
        <div className="grid grid-cols-3 gap-4 mb-5">
          {/* Mood Card — large */}
          <div className="col-span-2 glass-card p-7" style={{ background: `linear-gradient(135deg, ${vColor}08, rgba(255,255,255,0.02))` }}>
            <div className="flex items-center gap-6">
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center shrink-0"
                style={{
                  background: `linear-gradient(135deg, ${vColor}18, ${vColor}08)`,
                  border: `1px solid ${vColor}20`,
                  boxShadow: `0 4px 20px ${vColor}15`,
                }}
              >
                <span className="text-4xl" style={{ filter: "saturate(0.8)" }}>
                  {v > 0.3 ? "\u2600\uFE0F" : v < -0.3 ? "\u2601\uFE0F" : "\u26C5"}
                </span>
              </div>
              <div className="flex-1">
                <div className="text-2xl font-light tracking-wide capitalize" style={{ color: vColor }}>
                  {label}
                </div>
                <div className="text-xs mt-1 uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>
                  Emotional State
                </div>
                <div className="grid grid-cols-2 gap-4 mt-5">
                  <MiniGauge label="Valence" value={v} color={vColor} />
                  <MiniGauge label="Energy" value={e} color={eColor} />
                </div>
              </div>
            </div>
          </div>

          {/* Stats column */}
          <div className="flex flex-col gap-4">
            {currentPulse ? (
              <div className="glass-card p-5 flex-1">
                <div className="text-[11px] uppercase tracking-wider mb-2" style={{ color: "var(--text-dim)" }}>Now</div>
                <div className="text-sm font-mono font-semibold" style={{ color: "var(--accent)" }}>
                  {currentPulse.activity_type}
                </div>
                <div className="text-xs mt-1 truncate" style={{ color: "var(--text-dim)" }}>
                  {currentPulse.label}
                </div>
              </div>
            ) : (
              <div className="glass-card p-5 flex-1 flex items-center justify-center">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>Idle</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <StatBox label="Daily" value={impulseState?.dailyCount ?? 0} />
              <StatBox label="RLUF" value={rlufState?.totalFeedback ?? 0} />
            </div>
          </div>
        </div>

        {/* ── Bottom: Schedule + Weights ──────────────────── */}
        <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">

          {/* Reflection Schedule */}
          <div className="glass-card p-6 flex flex-col overflow-hidden">
            <div className="text-[11px] uppercase tracking-[0.15em] font-semibold mb-4" style={{ color: "var(--text-dim)" }}>
              Reflection Schedule
            </div>
            <div className="flex flex-col gap-2.5 flex-1 overflow-auto">
              {REFLECTIONS.map((r) => (
                <div
                  key={r.label}
                  className="flex items-center gap-4 px-5 py-3.5 rounded-xl transition-all"
                  style={{
                    background: "linear-gradient(135deg, rgba(255,255,255,0.02), rgba(255,255,255,0.005))",
                    border: "1px solid rgba(255,255,255,0.04)",
                  }}
                >
                  <span className="text-lg" style={{ color: r.color, opacity: 0.6 }}>{r.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: "var(--text-bright)" }}>{r.label}</div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: "var(--text-dim)" }}>{r.desc}</div>
                  </div>
                  <span
                    className="text-xs font-mono px-3 py-1.5 rounded-lg shrink-0"
                    style={{
                      background: `color-mix(in srgb, ${r.color} 10%, transparent)`,
                      color: r.color,
                      border: `1px solid color-mix(in srgb, ${r.color} 12%, transparent)`,
                    }}
                  >
                    {r.interval}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Weights */}
          <div className="glass-card p-6 flex flex-col overflow-hidden">
            {sortedRluf.length > 0 ? (
              <>
                <div className="text-[11px] uppercase tracking-[0.15em] font-semibold mb-4" style={{ color: "var(--text-dim)" }}>
                  RLUF Learned Weights
                </div>
                <div className="flex flex-col gap-3 flex-1 overflow-auto">
                  {sortedRluf.map(([type, weight]) => (
                    <WeightBar key={type} name={type} value={weight} max={3} color={weight > 1.5 ? "var(--wachstum)" : weight < 0.5 ? "var(--heartbeat)" : "var(--accent)"} />
                  ))}
                </div>
              </>
            ) : sortedInterests.length > 0 ? (
              <>
                <div className="text-[11px] uppercase tracking-[0.15em] font-semibold mb-4" style={{ color: "var(--text-dim)" }}>
                  Interest Weights
                </div>
                <div className="flex flex-col gap-3 flex-1 overflow-auto">
                  {sortedInterests.slice(0, 10).map(([name, weight]) => (
                    <WeightBar key={name} name={name} value={weight * 100} max={100} color="var(--interessen)" suffix="%" />
                  ))}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: "rgba(139,128,240,0.06)" }}>
                  <span className="text-xl" style={{ color: "var(--accent)", opacity: 0.3 }}>{"\u2726"}</span>
                </div>
                <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
                  Weights emerge from experience
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────── */

function MiniGauge({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = ((value + 1) / 2) * 100;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>{label}</span>
        <span className="text-xs font-mono" style={{ color }}>{value > 0 ? "+" : ""}{value.toFixed(2)}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.max(3, pct)}%`, background: `linear-gradient(90deg, ${color}60, ${color})` }}
        />
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass-card p-4 text-center">
      <div className="text-xl font-light" style={{ color: "var(--text-bright)" }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: "var(--text-dim)" }}>{label}</div>
    </div>
  );
}

function WeightBar({ name, value, max, color, suffix }: { name: string; value: number; max: number; color: string; suffix?: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className="text-xs w-32 truncate font-mono" style={{ color: "var(--text)" }}>{name}</span>
      <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: `linear-gradient(90deg, ${color}60, ${color})` }}
        />
      </div>
      <span className="text-xs font-mono w-12 text-right" style={{ color: "var(--text-dim)" }}>
        {suffix ? `${value.toFixed(0)}${suffix}` : value.toFixed(2)}
      </span>
    </div>
  );
}
