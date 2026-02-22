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

function MoodGauge({ label, value, color }: { label: string; value: number; color: string }) {
  const percentage = ((value + 1) / 2) * 100; // -1..1 → 0..100
  return (
    <div className="mb-3">
      <div className="flex justify-between text-xs mb-1">
        <span style={{ color: "var(--text-dim)" }}>{label}</span>
        <span style={{ color }}>{value.toFixed(2)}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(2, percentage)}%`,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
          }}
        />
      </div>
    </div>
  );
}

const REFLECTION_TYPES = [
  { type: "pattern_scan", label: "Pattern Scan", interval: "4h", color: "var(--bewusstsein)" },
  { type: "memory_consolidation", label: "Memory Consolidation", interval: "8h", color: "var(--mem)" },
  { type: "relationship_reflection", label: "Relationship Reflection", interval: "12h", color: "var(--bonds)" },
  { type: "goal_tracking", label: "Goal Tracking", interval: "24h", color: "var(--manifest)" },
  { type: "creative_collision", label: "Creative Collision", interval: "6h", color: "var(--garten)" },
];

export default function ImpulseView() {
  const [impulseState, setImpulseState] = useState<ImpulseState | null>(null);
  const [rlufState, setRlufState] = useState<RlufState | null>(null);
  const mood = useMood();
  const currentPulse = useCurrentPulse();

  useEffect(() => {
    commands
      .readSoulFile(".soul-impulse-state")
      .then((content) => {
        try {
          setImpulseState(JSON.parse(content));
        } catch { /* skip */ }
      })
      .catch(() => {});

    commands
      .readSoulFile(".soul-rluf-state")
      .then((content) => {
        try {
          setRlufState(JSON.parse(content));
        } catch { /* skip */ }
      })
      .catch(() => {});
  }, []);

  const moodValence = mood?.valence ?? impulseState?.mood?.valence ?? 0;
  const moodEnergy = mood?.energy ?? impulseState?.mood?.energy ?? 0;
  const moodLabel = mood?.label ?? impulseState?.mood?.label ?? "neutral";

  const valenceColor = moodValence > 0.2 ? "var(--wachstum)" : moodValence < -0.2 ? "var(--heartbeat)" : "var(--mem)";
  const energyColor = moodEnergy > 0.2 ? "var(--bewusstsein)" : moodEnergy < -0.2 ? "var(--traeume)" : "var(--accent)";

  const interests = impulseState?.interests || {};
  const sortedInterests = Object.entries(interests).sort(([, a], [, b]) => b - a);

  const rlufWeights = rlufState?.impulseWeights || {};
  const sortedRluf = Object.entries(rlufWeights).sort(([, a], [, b]) => b - a);

  return (
    <div className="h-full p-6 overflow-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <h2 className="text-sm uppercase tracking-wider mb-4" style={{ color: "var(--manifest)", opacity: 0.7 }}>
        Impulse
      </h2>

      {/* Mood section */}
      <div
        className="rounded-xl p-4 mb-4"
        style={{ backgroundColor: "var(--bg-surface)" }}
      >
        <div className="flex items-center gap-3 mb-4">
          <span className="text-2xl">{moodValence > 0.3 ? "\u2600" : moodValence < -0.3 ? "\u2601" : "\u26C5"}</span>
          <span className="text-lg font-medium" style={{ color: valenceColor }}>{moodLabel}</span>
        </div>
        <MoodGauge label="Valence" value={moodValence} color={valenceColor} />
        <MoodGauge label="Energy" value={moodEnergy} color={energyColor} />
      </div>

      {/* Current action */}
      {currentPulse && (
        <div
          className="rounded-xl p-4 mb-4"
          style={{ backgroundColor: "var(--bg-surface)" }}
        >
          <div className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--text-dim)" }}>
            Current Activity
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono" style={{ color: "var(--accent)" }}>
              {currentPulse.activity_type}
            </span>
            <span className="text-sm" style={{ color: "var(--text)" }}>
              {currentPulse.label}
            </span>
          </div>
        </div>
      )}

      {/* RLUF Learned Weights */}
      {sortedRluf.length > 0 && (
        <div
          className="rounded-xl p-4 mb-4"
          style={{ backgroundColor: "var(--bg-surface)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>
              RLUF Learned Weights
            </div>
            {rlufState?.totalFeedback != null && (
              <span className="text-xs" style={{ color: "var(--bonds)" }}>
                {rlufState.totalFeedback} signals
              </span>
            )}
          </div>
          {sortedRluf.map(([type, weight]) => (
            <div key={type} className="flex items-center gap-3 mb-2">
              <span className="text-xs w-28 truncate font-mono" style={{ color: "var(--text)" }}>{type}</span>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (weight / 3) * 100)}%`,
                    backgroundColor: weight > 1.5 ? "var(--wachstum)" : weight < 0.5 ? "var(--heartbeat)" : "var(--bonds)",
                  }}
                />
              </div>
              <span className="text-xs font-mono w-10 text-right" style={{ color: "var(--text-dim)" }}>
                {weight.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Reflection Schedule */}
      <div
        className="rounded-xl p-4 mb-4"
        style={{ backgroundColor: "var(--bg-surface)" }}
      >
        <div className="text-xs uppercase tracking-wider mb-3" style={{ color: "var(--text-dim)" }}>
          Reflection Schedule
        </div>
        {REFLECTION_TYPES.map((r) => (
          <div key={r.type} className="flex items-center justify-between py-1.5">
            <span className="text-xs" style={{ color: "var(--text)" }}>{r.label}</span>
            <span
              className="text-xs font-mono px-2 py-0.5 rounded"
              style={{ backgroundColor: `${r.color}15`, color: r.color }}
            >
              every {r.interval}
            </span>
          </div>
        ))}
      </div>

      {/* Interest weights */}
      {sortedInterests.length > 0 && (
        <div
          className="rounded-xl p-4 mb-4"
          style={{ backgroundColor: "var(--bg-surface)" }}
        >
          <div className="text-xs uppercase tracking-wider mb-3" style={{ color: "var(--text-dim)" }}>
            Interest Weights
          </div>
          {sortedInterests.slice(0, 10).map(([name, weight]) => (
            <div key={name} className="flex items-center gap-3 mb-2">
              <span className="text-xs w-24 truncate" style={{ color: "var(--text)" }}>{name}</span>
              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, weight * 100)}%`,
                    backgroundColor: "var(--interessen)",
                  }}
                />
              </div>
              <span className="text-xs font-mono w-8 text-right" style={{ color: "var(--text-dim)" }}>
                {(weight * 100).toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Stats footer */}
      <div className="flex gap-6 text-xs" style={{ color: "var(--text-dim)" }}>
        {impulseState?.dailyCount != null && (
          <span>Daily: {impulseState.dailyCount}</span>
        )}
        {impulseState?.consecutiveIgnored != null && (
          <span>Ignored: {impulseState.consecutiveIgnored}</span>
        )}
        {impulseState?.lastImpulse && (
          <span>Last: {impulseState.lastImpulse}</span>
        )}
      </div>
    </div>
  );
}
