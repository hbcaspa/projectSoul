import { useState, useMemo } from "react";
import { useMonitor, type EventEntry, type SubsystemInfo, type FileInfo } from "../lib/useMonitor";
import type { ProtocolStep, ParsedSession } from "./monitor-parse";

/* ── Status styling ──────────────────────────────────────── */

const STATUS = {
  done:          { dot: "#00ff82", bg: "rgba(0,255,130,0.06)", icon: "✓" },
  pending:       { dot: "rgba(255,255,255,0.2)", bg: "rgba(255,255,255,0.02)", icon: "○" },
  skipped:       { dot: "#ffc800", bg: "rgba(255,200,0,0.04)", icon: "–" },
  failed:        { dot: "#ff5050", bg: "rgba(255,80,80,0.06)", icon: "✗" },
  not_triggered: { dot: "#4488ff", bg: "rgba(68,136,255,0.04)", icon: "◇" },
} as const;

const SUB_STATUS = {
  running: { dot: "#00ff82", text: "var(--wachstum)" },
  stopped: { dot: "rgba(255,255,255,0.2)", text: "var(--text-dim)" },
  error:   { dot: "#ff5050", text: "var(--heartbeat)" },
  offline: { dot: "rgba(255,255,255,0.1)", text: "var(--text-muted)" },
} as const;

const EVENT_COLORS: Record<string, string> = {
  pulse: "var(--bewusstsein)",
  file: "var(--manifest)",
  bus: "var(--evolution)",
  mood: "var(--traeume)",
  error: "var(--heartbeat)",
};

/* ── Step Item ───────────────────────────────────────────── */

function StepItem({ step }: { step: ProtocolStep }) {
  const s = STATUS[step.status];
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all"
      style={{ background: s.bg, border: `1px solid ${s.dot}10` }}
    >
      <span
        className="w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-bold flex-shrink-0"
        style={{ backgroundColor: `${s.dot}20`, color: s.dot, boxShadow: step.status === "done" ? `0 0 8px ${s.dot}40` : "none" }}
      >
        {s.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold" style={{ color: step.status === "done" ? "#e0e0e0" : "var(--text-dim)" }}>
            {step.label}
          </span>
          {step.conditional && (
            <span className="text-[8px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-mono"
              style={{ color: "var(--text-muted)", backgroundColor: "rgba(255,255,255,0.04)" }}>
              cond
            </span>
          )}
          {step.resultCode && (
            <span className="text-[8px] px-1.5 py-0.5 rounded font-mono"
              style={{ color: s.dot, backgroundColor: `${s.dot}10` }}>
              {step.resultCode}
            </span>
          )}
        </div>
        {step.detail && (
          <p className="text-[9px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
            {step.detail}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Session Protocol Section ────────────────────────────── */

function SessionProtocol({ session, latest }: { session: { active: boolean; number: number | null; startTime: string | null; duration: string | null; phase: string }; latest: ParsedSession | null }) {
  const startSteps = latest?.startSteps || [];
  const endSteps = latest?.endSteps || [];

  const startDone = startSteps.filter(s => s.status === "done").length;
  const startTotal = startSteps.filter(s => s.status !== "not_triggered").length;
  const endDone = endSteps.filter(s => s.status === "done").length;
  const endTotal = endSteps.length;

  const totalDone = startDone + endDone;
  const totalAll = startTotal + endTotal;
  const pct = totalAll > 0 ? Math.round((totalDone / totalAll) * 100) : 0;

  const phaseColors: Record<string, string> = {
    idle: "var(--text-muted)",
    starting: "#ffc800",
    running: "#00ff82",
    ending: "var(--evolution)",
  };

  return (
    <div>
      {/* Session banner */}
      <div className="flex items-center gap-4 mb-4 px-1">
        <div className="flex items-center gap-2">
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{
              backgroundColor: session.active ? "#00ff82" : "rgba(255,255,255,0.15)",
              boxShadow: session.active ? "0 0 10px #00ff8260" : "none",
            }}
          />
          <span className="text-xs font-semibold" style={{ color: session.active ? "#e0e0e0" : "var(--text-dim)" }}>
            {session.active
              ? `Session ${session.number || "?"} — ${session.duration || "..."}`
              : latest ? `Session ${latest.number} (ended)` : "No session today"}
          </span>
        </div>
        <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: phaseColors[session.phase] || "var(--text-muted)" }}>
          {session.phase}
        </span>
        <span className="ml-auto text-[10px] font-mono" style={{ color: pct === 100 ? "#00ff82" : "var(--text-dim)" }}>
          {totalDone}/{totalAll} — {pct}%
        </span>
      </div>

      {/* Completion bar */}
      <div className="h-1 rounded-full mb-5 overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            backgroundColor: pct === 100 ? "#00ff82" : pct > 50 ? "#ffc800" : "#ff5050",
            boxShadow: `0 0 8px ${pct === 100 ? "#00ff82" : pct > 50 ? "#ffc800" : "#ff5050"}40`,
          }}
        />
      </div>

      {/* Two-column layout: Start | End */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--bewusstsein)" }}>
            Session Start
          </h4>
          <div className="flex flex-col gap-1.5">
            {startSteps.map(step => <StepItem key={step.id} step={step} />)}
          </div>
        </div>
        <div>
          <h4 className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--evolution)" }}>
            Session End
          </h4>
          <div className="flex flex-col gap-1.5">
            {endSteps.map(step => <StepItem key={step.id} step={step} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Engine Status Grid ──────────────────────────────────── */

function EngineGrid({ subsystems, online }: { subsystems: SubsystemInfo[]; online: boolean }) {
  if (!online && subsystems.length <= 1) {
    return (
      <div className="text-center py-6">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>Engine offline — start with Soul OS or CLI</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {subsystems.map(sub => {
        const s = SUB_STATUS[sub.status];
        return (
          <div key={sub.id} className="rounded-lg px-3 py-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.dot, boxShadow: `0 0 4px ${s.dot}` }} />
              <span className="text-[10px] font-semibold truncate" style={{ color: s.text }}>{sub.name}</span>
            </div>
            <p className="text-[9px] truncate" style={{ color: "var(--text-muted)" }}>{sub.detail}</p>
            {sub.metric && <p className="text-[8px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>{sub.metric}</p>}
          </div>
        );
      })}
    </div>
  );
}

/* ── Event Stream ────────────────────────────────────────── */

function EventStream({ entries, filter }: { entries: EventEntry[]; filter: string }) {
  const filtered = filter === "all" ? entries : entries.filter(e => e.type === filter);

  return (
    <div className="flex flex-col gap-0.5 max-h-[200px] overflow-auto">
      {filtered.length === 0 && (
        <span className="text-[10px] py-4 text-center" style={{ color: "var(--text-muted)" }}>No events yet</span>
      )}
      {filtered.map(e => (
        <div key={e.id} className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.01)" }}>
          <span className="text-[9px] font-mono flex-shrink-0 w-14" style={{ color: "var(--text-muted)" }}>{e.time}</span>
          <span
            className="text-[8px] px-1.5 py-0.5 rounded font-mono uppercase flex-shrink-0 w-10 text-center"
            style={{ color: EVENT_COLORS[e.type] || "var(--text-dim)", backgroundColor: `${EVENT_COLORS[e.type] || "var(--text-dim)"}10` }}
          >
            {e.type}
          </span>
          <span className="text-[9px] truncate" style={{ color: "var(--text-dim)" }}>{e.description}</span>
        </div>
      ))}
    </div>
  );
}

/* ── File Integrity ──────────────────────────────────────── */

function FileIntegrity({ files }: { files: FileInfo[] }) {
  return (
    <div className="flex flex-col gap-0.5 max-h-[200px] overflow-auto">
      {files.map(f => {
        const color = !f.exists ? "#ff5050" : !f.valid ? "#ffc800" : "#00ff82";
        return (
          <div key={f.path} className="flex items-center gap-2 px-2 py-1 rounded" style={{ background: "rgba(255,255,255,0.01)" }}>
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[9px] font-mono flex-1 truncate" style={{ color: "var(--text-dim)" }}>{f.path}</span>
            <span className="text-[8px] font-mono flex-shrink-0" style={{ color: "var(--text-muted)" }}>
              {f.exists ? `${(f.sizeBytes / 1024).toFixed(1)}KB` : "—"}
            </span>
            {f.note && <span className="text-[8px] flex-shrink-0" style={{ color }}>{f.note}</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ── Cost Panel ──────────────────────────────────────────── */

function CostPanel({ costs }: { costs: { todayTokens: number; todayCalls: number; budgetPercent: number } }) {
  const barColor = costs.budgetPercent > 80 ? "#ff5050" : costs.budgetPercent > 50 ? "#ffc800" : "#00ff82";

  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <span className="text-[10px] font-mono" style={{ color: "var(--text-dim)" }}>
          {costs.todayTokens.toLocaleString()} tokens
        </span>
        <span className="text-[10px] font-mono" style={{ color: "var(--text-dim)" }}>
          {costs.todayCalls} calls
        </span>
        <span className="text-[10px] font-mono ml-auto" style={{ color: barColor }}>
          {costs.budgetPercent}% budget
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.04)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(costs.budgetPercent, 100)}%`, backgroundColor: barColor, boxShadow: `0 0 6px ${barColor}` }}
        />
      </div>
    </div>
  );
}

/* ── Session History (today's sessions) ──────────────────── */

function SessionHistory({ sessions, activeNumber }: { sessions: ParsedSession[]; activeNumber: number | null }) {
  if (sessions.length <= 1) return null;

  return (
    <div className="flex gap-1.5 flex-wrap">
      {sessions.map(s => {
        const isActive = s.number === activeNumber;
        const isComplete = s.hasEnd;
        const color = isActive ? "#00ff82" : isComplete ? "var(--text-dim)" : "#ff5050";
        return (
          <div
            key={s.number}
            className="px-2 py-1 rounded text-[9px] font-mono"
            style={{
              color,
              backgroundColor: isActive ? "rgba(0,255,130,0.08)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${color}20`,
            }}
          >
            S{s.number} {s.startTime || ""} {isComplete ? "✓" : isActive ? "▸" : "✗"}
          </div>
        );
      })}
    </div>
  );
}

/* ── Main MonitorView ────────────────────────────────────── */

export default function MonitorView() {
  const monitor = useMonitor();
  const [eventFilter, setEventFilter] = useState("all");

  const sectionStyle = useMemo(() => ({
    background: "rgba(255,255,255,0.015)",
    border: "1px solid rgba(255,255,255,0.04)",
    borderRadius: "12px",
    padding: "16px",
    marginBottom: "12px",
  }), []);

  const headerStyle = useMemo(() => ({
    color: "var(--heartbeat)",
    fontSize: "10px",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginBottom: "12px",
  }), []);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Header */}
      <div className="px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4" style={{ color: "var(--heartbeat)" }}>
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 17v4" />
            <path d="M7 10h2l2-3 2 6 2-3h2" />
          </svg>
          <span className="text-xs font-semibold" style={{ color: "var(--heartbeat)" }}>System Monitor</span>
          <span className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>
            {new Date().toISOString().split("T")[0]}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {/* Today's session dots */}
        {monitor.todaySessions.length > 1 && (
          <div style={{ ...sectionStyle, padding: "10px 16px" }}>
            <SessionHistory sessions={monitor.todaySessions} activeNumber={monitor.session.number} />
          </div>
        )}

        {/* Section 1: Session Protocol */}
        <div style={sectionStyle}>
          <h3 style={headerStyle}>Session Protocol</h3>
          <SessionProtocol session={monitor.session} latest={monitor.latestSession} />
        </div>

        {/* Section 2: Engine Status */}
        <div style={sectionStyle}>
          <h3 style={headerStyle}>Engine Subsystems</h3>
          <EngineGrid subsystems={monitor.engine} online={monitor.engineOnline} />
        </div>

        {/* Section 3: Event Stream */}
        <div style={sectionStyle}>
          <div className="flex items-center gap-3 mb-3">
            <h3 style={{ ...headerStyle, marginBottom: 0 }}>Event Stream</h3>
            <div className="flex gap-1 ml-auto">
              {["all", "pulse", "file", "bus", "error"].map(f => (
                <button
                  key={f}
                  onClick={() => setEventFilter(f)}
                  className="text-[8px] px-2 py-0.5 rounded-full font-mono uppercase cursor-default transition-all"
                  style={{
                    color: eventFilter === f ? "#e0e0e0" : "var(--text-muted)",
                    backgroundColor: eventFilter === f ? "rgba(255,255,255,0.08)" : "transparent",
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <EventStream entries={monitor.eventStream} filter={eventFilter} />
        </div>

        {/* Section 4: File Integrity */}
        <div style={sectionStyle}>
          <h3 style={headerStyle}>File Integrity</h3>
          <FileIntegrity files={monitor.files} />
        </div>

        {/* Section 5: Cost Panel */}
        <div style={sectionStyle}>
          <h3 style={headerStyle}>Cost Tracking</h3>
          <CostPanel costs={monitor.costs} />
        </div>
      </div>
    </div>
  );
}
