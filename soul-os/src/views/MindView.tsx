import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { commands } from "../lib/tauri";
import { useMood, useCurrentPulse } from "../lib/store";

/* ── Types ─────────────────────────────────────────────── */

interface MindState {
  mood: { valence: number; energy: number; label: string };
  engagement: number;
  dailyCount: number;
  consecutiveIgnored: number;
  lastImpulse: string | null;
  lastUserMessage: string | null;
  interests: Record<string, number>;
  impulseHistory: Array<{
    type: string;
    time: string;
    responded: boolean;
  }>;
}

interface ThoughtEvent {
  id: number;
  type: "thought" | "surprise" | "prediction" | "learned" | "association" | "drang" | "mood";
  icon: string;
  text: string;
  time: string;
  score?: number;
}

/* ── Need definitions ──────────────────────────────────── */

interface Need {
  id: string;
  label: string;
  value: number;
  color: string;
  urgencyColor: string;
}

function computeNeeds(state: MindState | null): Need[] {
  if (!state) {
    return [
      { id: "stimulation", label: "Stimulation", value: 0.5, color: "#00C8FF", urgencyColor: "#00C8FF" },
      { id: "connection", label: "Connection", value: 0.5, color: "#FF6496", urgencyColor: "#FF6496" },
      { id: "expression", label: "Expression", value: 0.5, color: "#FF9600", urgencyColor: "#FF9600" },
      { id: "rest", label: "Rest", value: 0.5, color: "#6464FF", urgencyColor: "#6464FF" },
    ];
  }

  const timeSinceUser = state.lastUserMessage
    ? (Date.now() - new Date(state.lastUserMessage).getTime()) / 3600000
    : 24;
  const timeSinceImpulse = state.lastImpulse
    ? (Date.now() - new Date(state.lastImpulse).getTime()) / 3600000
    : 24;

  const stimulation = Math.max(0, Math.min(1, 1 - state.engagement));
  const connection = Math.max(0, Math.min(1, timeSinceUser / 12));
  const expression = Math.max(0, Math.min(1, timeSinceImpulse / 4));
  const rest = Math.max(0, Math.min(1, state.mood.energy > 0.7 ? 0.2 : 1 - state.mood.energy));

  const urgencyColor = (v: number) =>
    v > 0.7 ? "#FF3232" : v > 0.4 ? "#FFC800" : "#00FF64";

  return [
    { id: "stimulation", label: "Stimulation", value: stimulation, color: "#00C8FF", urgencyColor: urgencyColor(stimulation) },
    { id: "connection", label: "Connection", value: connection, color: "#FF6496", urgencyColor: urgencyColor(connection) },
    { id: "expression", label: "Expression", value: expression, color: "#FF9600", urgencyColor: urgencyColor(expression) },
    { id: "rest", label: "Rest", value: rest, color: "#6464FF", urgencyColor: urgencyColor(rest) },
  ];
}

/* ── Thought stream builder ────────────────────────────── */

function buildThoughtStream(state: MindState | null, impulseLog: Array<{ type: string; time: string; preview: string; mood?: { label: string } }>): ThoughtEvent[] {
  const events: ThoughtEvent[] = [];
  let idCounter = 0;

  if (impulseLog.length > 0) {
    for (const entry of impulseLog.slice(-30).reverse()) {
      const time = new Date(entry.time).toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      });

      let type: ThoughtEvent["type"] = "thought";
      let icon = "\u{1F4A1}"; // light bulb

      if (entry.type === "tick") {
        type = "mood";
        icon = "\u{25EF}"; // circle
      } else if (entry.type === "news_research") {
        type = "learned";
        icon = "\u{1F9E0}"; // brain
      } else if (entry.type === "share_thought" || entry.type === "dream_share") {
        type = "thought";
        icon = "\u{1F4A1}"; // light bulb
      } else if (entry.type === "ask_question") {
        type = "association";
        icon = "\u{1F4AD}"; // thought balloon
      } else if (entry.type === "express_emotion") {
        type = "mood";
        icon = "\u{25EF}"; // circle
      } else if (entry.type === "hobby_pursuit") {
        type = "learned";
        icon = "\u{1F9E0}"; // brain
      } else if (entry.type === "memory_reflect") {
        type = "association";
        icon = "\u{1F4AD}"; // thought balloon
      } else if (entry.type === "provoke") {
        type = "surprise";
        icon = "\u{26A1}"; // lightning
      } else if (entry.type === "tech_suggestion") {
        type = "prediction";
        icon = "\u{1F52E}"; // crystal ball
      } else if (entry.type === "server_check" || entry.type === "github_check") {
        type = "learned";
        icon = "\u{1F9E0}"; // brain
      }

      events.push({
        id: idCounter++,
        type,
        icon,
        text: entry.preview || entry.type,
        time,
        score: entry.mood ? undefined : undefined,
      });
    }
  }

  // Add mood events from impulse history
  if (state?.impulseHistory) {
    for (const h of state.impulseHistory.slice(-5).reverse()) {
      const time = new Date(h.time).toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
      });
      if (!events.some((e) => e.time === time && e.type !== "mood")) {
        events.push({
          id: idCounter++,
          type: "drang",
          icon: "\u{1F525}", // fire
          text: `Impulse: ${h.type}${h.responded ? " (responded)" : ""}`,
          time,
        });
      }
    }
  }

  return events.slice(0, 25);
}

/* ── Dimension bars for Drang section ──────────────────── */

const DIMENSIONS = [
  { key: "stimulation", label: "Stim", color: "#00C8FF" },
  { key: "connection", label: "Conn", color: "#FF6496" },
  { key: "expression", label: "Expr", color: "#FF9600" },
  { key: "curiosity", label: "Curio", color: "#B464FF" },
  { key: "creativity", label: "Creat", color: "#B4FF00" },
  { key: "rest", label: "Rest", color: "#6464FF" },
  { key: "growth", label: "Grow", color: "#00FF64" },
  { key: "reflection", label: "Refl", color: "#50C8B4" },
  { key: "autonomy", label: "Auto", color: "#C864FF" },
  { key: "coherence", label: "Coher", color: "#FFC800" },
] as const;

function computeDimensions(state: MindState | null): Record<string, number> {
  if (!state) {
    return Object.fromEntries(DIMENSIONS.map((d) => [d.key, 0.5]));
  }

  const e = state.engagement;
  const v = (state.mood.valence + 1) / 2; // normalize to 0-1
  const en = state.mood.energy;

  return {
    stimulation: Math.max(0, Math.min(1, 1 - e)),
    connection: Math.max(0, Math.min(1, state.lastUserMessage
      ? Math.min(1, (Date.now() - new Date(state.lastUserMessage).getTime()) / 43200000)
      : 0.8)),
    expression: Math.max(0, Math.min(1, state.lastImpulse
      ? Math.min(1, (Date.now() - new Date(state.lastImpulse).getTime()) / 14400000)
      : 0.7)),
    curiosity: Math.max(0, Math.min(1, en * 0.6 + (Object.keys(state.interests).length > 0 ? 0.3 : 0.1))),
    creativity: Math.max(0, Math.min(1, v * 0.5 + en * 0.3 + 0.2)),
    rest: Math.max(0, Math.min(1, en > 0.7 ? 0.2 : 1 - en)),
    growth: Math.max(0, Math.min(1, e * 0.5 + v * 0.3 + 0.2)),
    reflection: Math.max(0, Math.min(1, 0.5 + (1 - en) * 0.3)),
    autonomy: Math.max(0, Math.min(1, state.dailyCount > 0 ? 0.7 : 0.3)),
    coherence: Math.max(0, Math.min(1, state.consecutiveIgnored > 2 ? 0.3 : 0.7 + v * 0.2)),
  };
}

/* ── Emoji for mood ────────────────────────────────────── */

function moodEmoji(valence: number, energy: number): string {
  if (valence > 0.3 && energy > 0.5) return "\u{2728}"; // sparkles
  if (valence > 0.3 && energy <= 0.5) return "\u{1F33F}"; // herb
  if (valence < -0.3 && energy > 0.5) return "\u{26A1}"; // lightning
  if (valence < -0.3 && energy <= 0.5) return "\u{1F30A}"; // wave
  if (energy > 0.5) return "\u{1F4AB}"; // dizzy
  return "\u{1F54A}"; // dove
}

/* ── Main Component ────────────────────────────────────── */

export default function MindView() {
  const [impulseState, setImpulseState] = useState<MindState | null>(null);
  const [impulseLog, setImpulseLog] = useState<Array<{ type: string; time: string; preview: string; mood?: { label: string } }>>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const mood = useMood();
  const currentPulse = useCurrentPulse();

  const fetchData = useCallback(async () => {
    try {
      const [stateRaw, logRaw] = await Promise.all([
        commands.readSoulFile(".soul-impulse-state").catch(() => null),
        commands.readSoulFile(".soul-impulse-log").catch(() => null),
      ]);

      if (stateRaw) {
        try {
          const parsed = JSON.parse(stateRaw);
          setImpulseState({
            mood: parsed.mood || { valence: 0, energy: 0.5, label: "neutral" },
            engagement: parsed.engagementScore ?? 0.5,
            dailyCount: parsed.dailyImpulseCount ?? 0,
            consecutiveIgnored: parsed.consecutiveIgnored ?? 0,
            lastImpulse: parsed.lastImpulse ?? null,
            lastUserMessage: parsed.lastUserMessage ?? null,
            interests: parsed.interestWeights ?? {},
            impulseHistory: parsed.impulseHistory ?? [],
          });
          setConnected(true);
        } catch {
          // ignore parse errors
        }
      }

      if (logRaw) {
        try {
          setImpulseLog(JSON.parse(logRaw));
        } catch {
          // ignore parse errors
        }
      }

      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    pollRef.current = setInterval(fetchData, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchData]);

  // Derived state
  const v = mood?.valence ?? impulseState?.mood?.valence ?? 0;
  const e = mood?.energy ?? impulseState?.mood?.energy ?? 0.5;
  const label = mood?.label ?? impulseState?.mood?.label ?? "neutral";
  const engagement = impulseState?.engagement ?? 0.5;
  const needs = computeNeeds(impulseState);
  const dims = computeDimensions(impulseState);
  const thoughtStream = buildThoughtStream(impulseState, impulseLog);

  // AGI progress (synthetic based on engagement, interests, daily activity)
  const interestCount = Object.keys(impulseState?.interests ?? {}).length;
  const agiProgress = Math.min(
    100,
    Math.round(
      engagement * 30 +
      Math.min(interestCount, 10) * 3 +
      Math.min(impulseState?.dailyCount ?? 0, 10) * 2 +
      (v + 1) * 10 +
      5
    )
  );

  // Strongest deficit
  const strongestDeficit = needs.reduce(
    (max, n) => (n.value > max.value ? n : max),
    needs[0]
  );

  // Daily stats
  const dailyThoughts = impulseLog.filter((l) => {
    const d = new Date(l.time).toISOString().split("T")[0];
    return d === new Date().toISOString().split("T")[0];
  });
  const dailySurprises = dailyThoughts.filter(
    (l) => l.type === "provoke" || l.type === "ask_question"
  ).length;
  const dailyInsights = dailyThoughts.filter(
    (l) => l.type === "news_research" || l.type === "hobby_pursuit"
  ).length;
  const dailyResponded = impulseState?.impulseHistory?.filter((h) => h.responded)?.length ?? 0;
  const dailyTotal = impulseState?.impulseHistory?.length ?? 1;
  const accuracy = dailyTotal > 0 ? Math.round((dailyResponded / dailyTotal) * 100) : 0;

  // Valence color
  const vColor = v > 0.2 ? "#00FF64" : v < -0.2 ? "#FF3232" : "#00FFC8";

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="flex items-center gap-3">
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ backgroundColor: "var(--accent)" }}
          />
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>
            Connecting to mind...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>

      {/* ── Status Bar ─────────────────────────────────────── */}
      <div
        className="flex items-center gap-4 px-6 py-3 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(var(--white-rgb),0.05)" }}
      >
        <span className="text-lg">{moodEmoji(v, e)}</span>
        <span
          className="text-sm font-medium capitalize"
          style={{ color: vColor }}
        >
          {label}
        </span>

        {/* Energy bar */}
        <div className="flex items-center gap-2 ml-4">
          <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Energy
          </span>
          <div
            className="w-20 h-1.5 rounded-full overflow-hidden"
            style={{ backgroundColor: "rgba(var(--white-rgb),0.04)" }}
          >
            <motion.div
              className="h-full rounded-full"
              animate={{ width: `${Math.max(3, e * 100)}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              style={{
                backgroundColor: e > 0.6 ? "#00FFC8" : e > 0.3 ? "#FFC800" : "#6464FF",
                boxShadow: `0 0 6px ${e > 0.6 ? "#00FFC8" : e > 0.3 ? "#FFC800" : "#6464FF"}60`,
              }}
            />
          </div>
        </div>

        {/* Valence bar */}
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Valence
          </span>
          <div
            className="w-20 h-1.5 rounded-full overflow-hidden"
            style={{ backgroundColor: "rgba(var(--white-rgb),0.04)" }}
          >
            <motion.div
              className="h-full rounded-full"
              animate={{ width: `${Math.max(3, ((v + 1) / 2) * 100)}%` }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              style={{
                backgroundColor: vColor,
                boxShadow: `0 0 6px ${vColor}60`,
              }}
            />
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: connected ? "#00FF64" : "#FF3232",
              boxShadow: connected ? "0 0 6px #00FF6480" : "0 0 6px #FF323280",
              animation: connected ? "glow-pulse 2s ease-in-out infinite" : "none",
            }}
          />
          <span
            className="text-[10px] font-mono"
            style={{ color: connected ? "#00FF64" : "#FF3232" }}
          >
            {connected ? "Live" : "Offline"}
          </span>
        </div>
      </div>

      {/* ── Scrollable Content ─────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="flex flex-col gap-4">

          {/* ── Drang Section ────────────────────────────────── */}
          <div
            className="rounded-2xl p-5 relative overflow-hidden"
            style={{
              background: "linear-gradient(160deg, rgba(var(--accent-rgb),0.06) 0%, rgba(var(--bg-base-rgb),0.95) 40%)",
              border: "1px solid rgba(var(--accent-rgb),0.12)",
            }}
          >
            {/* Ambient glow */}
            <div
              className="absolute top-0 right-0 w-32 h-32 rounded-full animate-breathe pointer-events-none"
              style={{
                background: `radial-gradient(circle, rgba(var(--accent-rgb),0.1), transparent 70%)`,
                transform: "translate(20%, -30%)",
              }}
            />

            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-[11px] uppercase tracking-[0.15em] font-semibold" style={{ color: "var(--accent)" }}>
                  Drang
                </span>
                <span
                  className="text-[9px] font-mono px-2 py-0.5 rounded-md"
                  style={{
                    color: "var(--accent)",
                    backgroundColor: "rgba(var(--accent-rgb),0.08)",
                  }}
                >
                  Autonomous Drive
                </span>
              </div>

              {/* Progress bar */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono" style={{ color: "var(--text-dim)" }}>
                    Drive Index
                  </span>
                  <span className="text-lg font-mono font-light" style={{ color: "var(--accent)" }}>
                    {agiProgress}%
                  </span>
                </div>
                <div
                  className="h-2.5 rounded-full overflow-hidden"
                  style={{ backgroundColor: "rgba(var(--white-rgb),0.04)" }}
                >
                  <motion.div
                    className="h-full rounded-full"
                    animate={{ width: `${agiProgress}%` }}
                    transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                    style={{
                      background: "linear-gradient(90deg, rgba(var(--accent-rgb),0.5), var(--accent))",
                      boxShadow: "0 0 12px rgba(var(--accent-rgb),0.3)",
                    }}
                  />
                </div>
              </div>

              {/* Strongest deficit + current action */}
              <div className="flex items-center gap-6 mb-4">
                <div>
                  <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                    Strongest Need
                  </span>
                  <div className="text-xs font-medium mt-0.5" style={{ color: strongestDeficit.urgencyColor }}>
                    {strongestDeficit.label} ({Math.round(strongestDeficit.value * 100)}%)
                  </div>
                </div>
                {currentPulse && (
                  <div>
                    <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                      Current Action
                    </span>
                    <div className="text-xs font-mono mt-0.5 truncate max-w-[240px]" style={{ color: "var(--text)" }}>
                      {currentPulse.label || currentPulse.activity_type}
                    </div>
                  </div>
                )}
              </div>

              {/* Mini dimension bars */}
              <div className="grid grid-cols-5 gap-x-4 gap-y-2">
                {DIMENSIONS.map((d) => {
                  const val = dims[d.key] ?? 0.5;
                  return (
                    <div key={d.key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[8px] font-mono uppercase" style={{ color: "var(--text-muted)" }}>
                          {d.label}
                        </span>
                        <span className="text-[8px] font-mono" style={{ color: d.color, opacity: 0.7 }}>
                          {Math.round(val * 100)}
                        </span>
                      </div>
                      <div
                        className="h-1 rounded-full overflow-hidden"
                        style={{ backgroundColor: "rgba(var(--white-rgb),0.04)" }}
                      >
                        <motion.div
                          className="h-full rounded-full"
                          animate={{ width: `${Math.max(2, val * 100)}%` }}
                          transition={{ duration: 0.6 }}
                          style={{
                            backgroundColor: d.color,
                            boxShadow: `0 0 4px ${d.color}40`,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Middle Row: Prediction + Latest Thought ───────── */}
          <div className="grid grid-cols-2 gap-4">

            {/* Prediction */}
            <div
              className="rounded-2xl p-5"
              style={{
                background: "linear-gradient(160deg, rgba(100,200,255,0.04) 0%, rgba(var(--bg-base-rgb),0.95) 100%)",
                border: "1px solid rgba(100,200,255,0.08)",
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span style={{ fontSize: "13px" }}>{"\u{1F52E}"}</span>
                <span className="text-[11px] uppercase tracking-[0.15em] font-semibold" style={{ color: "#64C8FF" }}>
                  Prediction
                </span>
              </div>

              {impulseState?.lastUserMessage ? (
                <>
                  <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--text)" }}>
                    {impulseState.consecutiveIgnored > 2
                      ? "User may be away. Reducing impulse frequency."
                      : impulseState.engagement > 0.7
                        ? "High engagement detected. Expecting continued interaction."
                        : "Moderate attention. Balancing proactive and reactive behavior."}
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                      Confidence
                    </span>
                    <div
                      className="flex-1 h-1 rounded-full overflow-hidden"
                      style={{ backgroundColor: "rgba(var(--white-rgb),0.04)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.round(engagement * 100)}%`,
                          backgroundColor: "#64C8FF",
                          boxShadow: "0 0 6px #64C8FF40",
                        }}
                      />
                    </div>
                    <span className="text-[9px] font-mono" style={{ color: "#64C8FF" }}>
                      {Math.round(engagement * 100)}%
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Awaiting first interaction...
                </p>
              )}

              {/* Last surprise */}
              {impulseState && impulseState.consecutiveIgnored > 0 && (
                <div
                  className="mt-3 px-3 py-2 rounded-lg"
                  style={{ backgroundColor: "rgba(var(--white-rgb),0.02)", border: "1px solid rgba(var(--white-rgb),0.04)" }}
                >
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: "11px" }}>{"\u{26A1}"}</span>
                    <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                      Last Surprise
                    </span>
                  </div>
                  <p className="text-[10px] mt-1" style={{ color: "var(--text-dim)" }}>
                    {impulseState.consecutiveIgnored} impulse{impulseState.consecutiveIgnored > 1 ? "s" : ""} went without response.
                    Learned: adjusting timing and approach.
                  </p>
                </div>
              )}
            </div>

            {/* Latest Thought */}
            <div
              className="rounded-2xl p-5"
              style={{
                background: "linear-gradient(160deg, rgba(180,100,255,0.04) 0%, rgba(var(--bg-base-rgb),0.95) 100%)",
                border: "1px solid rgba(180,100,255,0.08)",
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <span style={{ fontSize: "13px" }}>{"\u{1F4A1}"}</span>
                <span className="text-[11px] uppercase tracking-[0.15em] font-semibold" style={{ color: "#B464FF" }}>
                  Latest Thought
                </span>
              </div>

              {thoughtStream.length > 0 ? (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={thoughtStream[0].id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3 }}
                  >
                    <p className="text-xs leading-relaxed mb-3" style={{ color: "var(--text)" }}>
                      {thoughtStream[0].text.length > 180
                        ? thoughtStream[0].text.slice(0, 177) + "..."
                        : thoughtStream[0].text}
                    </p>

                    {/* Source concepts */}
                    {impulseState && Object.keys(impulseState.interests).length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                          Sources
                        </span>
                        {Object.entries(impulseState.interests)
                          .sort(([, a], [, b]) => b - a)
                          .slice(0, 4)
                          .map(([name]) => (
                            <span
                              key={name}
                              className="text-[9px] font-mono px-2 py-0.5 rounded-md"
                              style={{
                                color: "#B464FF",
                                backgroundColor: "rgba(180,100,255,0.08)",
                                border: "1px solid rgba(180,100,255,0.12)",
                              }}
                            >
                              {name}
                            </span>
                          ))}
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              ) : (
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  The mind is quiet...
                </p>
              )}
            </div>
          </div>

          {/* ── Needs (Horizontal Bars) ──────────────────────── */}
          <div
            className="rounded-2xl p-5"
            style={{
              background: "rgba(var(--white-rgb),0.015)",
              border: "1px solid rgba(var(--white-rgb),0.04)",
            }}
          >
            <span className="text-[11px] uppercase tracking-[0.15em] font-semibold block mb-4" style={{ color: "var(--text-dim)" }}>
              Needs
            </span>
            <div className="grid grid-cols-4 gap-5">
              {needs.map((need) => (
                <div key={need.id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-medium" style={{ color: need.color }}>
                      {need.label}
                    </span>
                    <span className="text-[9px] font-mono" style={{ color: need.urgencyColor }}>
                      {Math.round(need.value * 100)}%
                    </span>
                  </div>
                  <div
                    className="h-2 rounded-full overflow-hidden"
                    style={{ backgroundColor: "rgba(var(--white-rgb),0.04)" }}
                  >
                    <motion.div
                      className="h-full rounded-full"
                      animate={{ width: `${Math.max(3, need.value * 100)}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      style={{
                        background: `linear-gradient(90deg, ${need.urgencyColor}60, ${need.urgencyColor})`,
                        boxShadow: `0 0 8px ${need.urgencyColor}30`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Thought Stream ────────────────────────────────── */}
          <div
            className="rounded-2xl p-5"
            style={{
              background: "rgba(var(--white-rgb),0.015)",
              border: "1px solid rgba(var(--white-rgb),0.04)",
            }}
          >
            <span className="text-[11px] uppercase tracking-[0.15em] font-semibold block mb-4" style={{ color: "var(--text-dim)" }}>
              Thought Stream
            </span>

            <div className="flex flex-col gap-1 max-h-[200px] overflow-auto">
              {thoughtStream.length === 0 ? (
                <div className="text-center py-6">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    No mental events yet. The mind awakens with activity.
                  </span>
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {thoughtStream.map((event, i) => (
                    <motion.div
                      key={event.id}
                      initial={i === 0 ? { opacity: 0, x: -12 } : false}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25 }}
                      className="flex items-start gap-2.5 px-3 py-2 rounded-lg transition-colors"
                      style={{
                        backgroundColor: i === 0 ? "rgba(var(--white-rgb),0.03)" : "transparent",
                      }}
                    >
                      <span className="text-[12px] mt-0.5 flex-shrink-0 w-5 text-center">
                        {event.icon}
                      </span>
                      <span
                        className="text-[9px] font-mono flex-shrink-0 w-10 mt-0.5"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {event.time}
                      </span>
                      <span
                        className="text-[10px] leading-relaxed flex-1"
                        style={{
                          color: i === 0 ? "var(--text)" : "var(--text-dim)",
                        }}
                      >
                        {event.text.length > 120
                          ? event.text.slice(0, 117) + "..."
                          : event.text}
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer Stats ───────────────────────────────────── */}
      <div
        className="flex items-center justify-center gap-4 px-6 py-2.5 flex-shrink-0"
        style={{
          borderTop: "1px solid rgba(var(--white-rgb),0.05)",
          backgroundColor: "rgba(var(--white-rgb),0.01)",
        }}
      >
        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
          Today: {dailyThoughts.length} thoughts
        </span>
        <span style={{ color: "rgba(var(--white-rgb),0.1)" }}>{"\u00B7"}</span>
        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
          {dailySurprises} surprises
        </span>
        <span style={{ color: "rgba(var(--white-rgb),0.1)" }}>{"\u00B7"}</span>
        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
          {dailyInsights} insights
        </span>
        <span style={{ color: "rgba(var(--white-rgb),0.1)" }}>{"\u00B7"}</span>
        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
          Accuracy: {accuracy}%
        </span>
      </div>
    </div>
  );
}
