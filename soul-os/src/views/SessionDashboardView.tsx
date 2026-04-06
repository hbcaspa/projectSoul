import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
} from "recharts";

const ENGINE_URL = "http://localhost:3002";

interface SessionData {
  number: number;
  state: string;
  started_at: string;
  ended_at: string | null;
  tokens_used: number;
  input_tokens: number;
  output_tokens: number;
  metadata: string;
}

interface StatsData {
  total: number;
  completed: number;
  crashed: number;
  completionRate: string;
  totalTokens: number;
}

interface CurrentSession {
  number: number;
  state: string;
  started_at: string;
  checkpoints: { phase: string; status: string }[];
}

export default function SessionDashboardView() {
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [current, setCurrent] = useState<CurrentSession | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Fetch session data
  useEffect(() => {
    const apiKey = localStorage.getItem("soul-api-key") || "";
    const headers = { Authorization: `Bearer ${apiKey}` };

    const load = async () => {
      try {
        const [sessRes, curRes] = await Promise.all([
          fetch(`${ENGINE_URL}/api/sessions?limit=100`, { headers }),
          fetch(`${ENGINE_URL}/api/sessions/current`, { headers }),
        ]);
        if (sessRes.ok) {
          const d = await sessRes.json();
          setSessions(d.sessions || []);
          setStats(d.stats || null);
        }
        if (curRes.ok) {
          setCurrent(await curRes.json());
        } else {
          setCurrent(null);
        }
      } catch { /* engine down */ }
    };

    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  // Elapsed timer for current session
  useEffect(() => {
    if (!current) { setElapsed(0); return; }
    const calc = () => {
      const start = new Date(current.started_at.replace(" ", "T")).getTime();
      setElapsed(Math.round((Date.now() - start) / 60000));
    };
    calc();
    const t = setInterval(calc, 30000);
    return () => clearInterval(t);
  }, [current]);

  // Prepare chart data
  const dailyData = prepareDailyData(sessions);
  const tokenData = prepareTokenData(sessions);
  const stateColor = getStateColor(current?.state || "");

  const completedPhases = current?.checkpoints?.filter((c) => c.status === "completed").length || 0;
  const totalPhases = current?.checkpoints?.length || 7;

  return (
    <div className="p-5 space-y-5 text-xs" style={{ color: "var(--text)" }}>
      {/* Current Session Card */}
      <div className="grid grid-cols-2 gap-4">
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--text-dim)" }}>
            Active Session
          </div>
          {current ? (
            <div className="space-y-3">
              <div className="flex items-baseline gap-3">
                <span className="text-2xl font-bold" style={{ color: "var(--neon)" }}>#{current.number}</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: `${stateColor}20`, color: stateColor }}>
                  {current.state}
                </span>
              </div>
              <div style={{ color: "var(--text-dim)" }}>
                {elapsed} min elapsed
              </div>
              {/* Checkpoint progress bar */}
              <div>
                <div className="flex justify-between mb-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
                  <span>Checkpoints</span>
                  <span>{completedPhases}/{totalPhases}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(var(--white-rgb),0.06)" }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${(completedPhases / totalPhases) * 100}%`, backgroundColor: "var(--neon)" }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="text-lg font-semibold" style={{ color: "var(--text-muted)" }}>No active session</div>
          )}
        </div>

        {/* Stats Card */}
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--text-dim)" }}>
            Overview
          </div>
          {stats && (
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total" value={stats.total} color="var(--neon)" />
              <Stat label="Completed" value={stats.completed} color="#00FF64" />
              <Stat label="Crashed" value={stats.crashed} color="#FF3232" />
              <Stat label="Tokens" value={formatTokens(stats.totalTokens)} color="var(--accent)" />
            </div>
          )}
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Sessions per day */}
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider mb-3" style={{ color: "var(--text-dim)" }}>
            Sessions / Day
          </div>
          <div style={{ height: 140 }}>
            <ResponsiveContainer>
              <BarChart data={dailyData}>
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={20} />
                <Tooltip contentStyle={{ backgroundColor: "var(--bg-surface)", border: "1px solid rgba(var(--neon-rgb),0.2)", borderRadius: 8, fontSize: 10, color: "var(--text)" }} />
                <Bar dataKey="sessions" fill="rgba(var(--neon-rgb),0.6)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Duration trend */}
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider mb-3" style={{ color: "var(--text-dim)" }}>
            Avg Duration (min)
          </div>
          <div style={{ height: 140 }}>
            <ResponsiveContainer>
              <AreaChart data={dailyData}>
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={25} />
                <Tooltip contentStyle={{ backgroundColor: "var(--bg-surface)", border: "1px solid rgba(var(--accent-rgb),0.2)", borderRadius: 8, fontSize: 10, color: "var(--text)" }} />
                <Area type="monotone" dataKey="avgDuration" stroke="rgb(var(--accent-rgb))" fill="rgba(var(--accent-rgb),0.15)" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Completion Rate Donut */}
        <div className="glass-card p-4">
          <div className="text-[10px] uppercase tracking-wider mb-3" style={{ color: "var(--text-dim)" }}>
            Completion Rate
          </div>
          <div style={{ height: 140 }} className="flex items-center justify-center relative">
            {stats && (
              <>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Completed", value: stats.completed },
                        { name: "Crashed", value: stats.crashed },
                        { name: "Other", value: Math.max(0, stats.total - stats.completed - stats.crashed) },
                      ]}
                      innerRadius={38}
                      outerRadius={55}
                      dataKey="value"
                      strokeWidth={0}
                    >
                      <Cell fill="#00FF64" />
                      <Cell fill="#FF3232" />
                      <Cell fill="rgba(var(--white-rgb),0.1)" />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold" style={{ color: "var(--neon)" }}>
                    {stats.completionRate}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Token usage chart */}
      <div className="glass-card p-4">
        <div className="text-[10px] uppercase tracking-wider mb-3" style={{ color: "var(--text-dim)" }}>
          Token Usage / Day
        </div>
        <div style={{ height: 120 }}>
          <ResponsiveContainer>
            <BarChart data={tokenData}>
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={35} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={{ backgroundColor: "var(--bg-surface)", border: "1px solid rgba(var(--neon-rgb),0.2)", borderRadius: 8, fontSize: 10, color: "var(--text)" }} />
              <Bar dataKey="input" stackId="a" fill="rgba(var(--neon-rgb),0.5)" radius={[0, 0, 0, 0]} name="Input" />
              <Bar dataKey="output" stackId="a" fill="rgba(var(--accent-rgb),0.5)" radius={[3, 3, 0, 0]} name="Output" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div>
      <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-base font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function getStateColor(state: string): string {
  switch (state) {
    case "boot": case "loading": return "#FFC800";
    case "heartbeat": return "#FF9600";
    case "active": return "#00FFC8";
    case "closing_a": case "closing_b": return "#8B80F0";
    case "completed": return "#00FF64";
    case "crashed": return "#FF3232";
    default: return "var(--text-muted)";
  }
}

function prepareDailyData(sessions: any[]) {
  const byDay: Record<string, { count: number; totalDuration: number }> = {};
  for (const s of sessions) {
    const day = s.started_at.split(" ")[0].slice(5); // MM-DD
    if (!byDay[day]) byDay[day] = { count: 0, totalDuration: 0 };
    byDay[day].count++;
    if (s.ended_at) {
      const dur = (new Date(s.ended_at).getTime() - new Date(s.started_at.replace(" ", "T")).getTime()) / 60000;
      byDay[day].totalDuration += dur;
    }
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([day, d]) => ({
      day,
      sessions: d.count,
      avgDuration: d.count > 0 ? Math.round(d.totalDuration / d.count) : 0,
    }));
}

function prepareTokenData(sessions: any[]) {
  const byDay: Record<string, { input: number; output: number }> = {};
  for (const s of sessions) {
    const day = s.started_at.split(" ")[0].slice(5);
    if (!byDay[day]) byDay[day] = { input: 0, output: 0 };
    byDay[day].input += s.input_tokens || 0;
    byDay[day].output += s.output_tokens || 0;
  }
  return Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([day, d]) => ({ day, ...d }));
}
