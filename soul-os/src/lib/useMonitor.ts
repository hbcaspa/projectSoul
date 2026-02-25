/**
 * useMonitor — React hook for Soul System Monitor.
 * Combines file polling (3s) + real-time Tauri events into MonitorData.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { commands, events, type SoulPulse, type SoulActivity } from "./tauri";
import { parseHeartbeatLog, enrichEndSteps, type ParsedSession } from "../views/monitor-parse";

/* ── Types ──────────────────────────────────────────────── */

export interface EventEntry {
  id: number;
  time: string;
  type: "pulse" | "file" | "bus" | "mood" | "error";
  source: string;
  description: string;
}

export interface SubsystemInfo {
  id: string;
  name: string;
  status: "running" | "stopped" | "error" | "offline";
  detail: string;
  metric: string | null;
}

export interface FileInfo {
  path: string;
  exists: boolean;
  sizeBytes: number;
  lastModified: string | null;
  valid: boolean;
  note: string | null;
}

export interface CostInfo {
  todayTokens: number;
  todayCalls: number;
  budgetPercent: number;
}

export interface MonitorData {
  session: {
    active: boolean;
    number: number | null;
    startTime: string | null;
    duration: string | null;
    phase: "idle" | "starting" | "running" | "ending";
  };
  todaySessions: ParsedSession[];
  latestSession: ParsedSession | null;
  engine: SubsystemInfo[];
  engineOnline: boolean;
  eventStream: EventEntry[];
  files: FileInfo[];
  costs: CostInfo;
  lastRefresh: number;
}

/* ── Constants ──────────────────────────────────────────── */

const POLL_INTERVAL = 3000;
const MAX_EVENTS = 50;

const SOUL_FILES = [
  "SEED.md", "SOUL.md",
  "seele/KERN.md", "seele/BEWUSSTSEIN.md", "seele/SCHATTEN.md",
  "seele/INTERESSEN.md", "seele/WACHSTUM.md", "seele/MANIFEST.md",
  "seele/TRAEUME.md", "seele/EVOLUTION.md", "seele/GARTEN.md",
  "seele/beziehungen/aalm.md", "erinnerungen/INDEX.md",
  // English variants
  "soul/CORE.md", "soul/CONSCIOUSNESS.md", "soul/SHADOW.md",
  "soul/INTERESTS.md", "soul/GROWTH.md", "soul/DREAMS.md",
  "soul/EVOLUTION.md", "soul/GARDEN.md", "memories/INDEX.md",
];

/* ── Engine API fetch (via Tauri backend proxy) ────────── */

async function fetchEngineSubsystems(): Promise<SubsystemInfo[]> {
  try {
    const data = await commands.fetchEngineSubsystems();
    if (!data || !Array.isArray(data.subsystems)) {
      console.warn("[Monitor] fetchEngineSubsystems: unexpected response", data);
      return [];
    }
    console.debug(`[Monitor] Got ${data.subsystems.length} subsystems via Tauri proxy`);
    return data.subsystems.map((s) => ({
      id: s.id,
      name: s.name,
      status: (s.status === "running" ? "running" : s.status === "error" ? "error" : "stopped") as SubsystemInfo["status"],
      detail: s.detail || "",
      metric: s.metric || null,
    }));
  } catch (e) {
    console.debug("[Monitor] fetchEngineSubsystems via Tauri:", e);
    return [];
  }
}

/* ── Hook ───────────────────────────────────────────────── */

export function useMonitor(): MonitorData {
  const [data, setData] = useState<MonitorData>({
    session: { active: false, number: null, startTime: null, duration: null, phase: "idle" },
    todaySessions: [],
    latestSession: null,
    engine: [],
    engineOnline: false,
    eventStream: [],
    files: [],
    costs: { todayTokens: 0, todayCalls: 0, budgetPercent: 0 },
    lastRefresh: 0,
  });

  const eventIdRef = useRef(0);
  const eventsRef = useRef<EventEntry[]>([]);

  const addEvent = useCallback((type: EventEntry["type"], source: string, description: string) => {
    const entry: EventEntry = {
      id: ++eventIdRef.current,
      time: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      type,
      source,
      description,
    };
    eventsRef.current = [entry, ...eventsRef.current].slice(0, MAX_EVENTS);
  }, []);

  // Polling
  const refresh = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];

    // Read all data sources in parallel
    const [sessionActiveRaw, heartbeatRaw, seedRaw, costRaw, sidecarStatus, statelogFiles] = await Promise.all([
      commands.readSoulFile(".session-active").catch(() => null),
      commands.readSoulFile(`heartbeat/${today}.md`).catch(() => ""),
      commands.readSoulFile("SEED.md").catch(() => ""),
      commands.readSoulFile(".soul-cost.json").catch(() => null),
      commands.getSidecarStatus().catch(() => ({ status: "offline" })),
      commands.listDirectory("zustandslog").catch(() => [] as string[]),
    ]);

    // Session state
    let sessionActive = false;
    let sessionNumber: number | null = null;
    let sessionStartTime: string | null = null;

    if (sessionActiveRaw) {
      sessionActive = true;
      const numMatch = sessionActiveRaw.match(/session:(\d+)/);
      const timeMatch = sessionActiveRaw.match(/start:(.+)/);
      if (numMatch) sessionNumber = parseInt(numMatch[1]);
      if (timeMatch) sessionStartTime = timeMatch[1].trim();
    }

    let duration: string | null = null;
    if (sessionStartTime) {
      const ms = Date.now() - new Date(sessionStartTime).getTime();
      const mins = Math.round(ms / 60000);
      duration = mins < 60 ? `${mins}min` : `${Math.floor(mins / 60)}h ${mins % 60}min`;
    }

    // Parse heartbeat
    const allSessions = parseHeartbeatLog(heartbeatRaw);
    let latestSession = allSessions.length > 0 ? allSessions[allSessions.length - 1] : null;

    // Enrich end steps with file-based checks
    if (latestSession) {
      const seedCondensedMatch = seedRaw.match(/#(?:verdichtet|condensed):([^\s#]+)/);
      const seedCondensedToday = seedCondensedMatch
        ? seedCondensedMatch[1].startsWith(today)
        : false;

      // Check if INDEX.md was mentioned in today's heartbeat
      const indexModifiedToday = /INDEX\.md/.test(heartbeatRaw) && latestSession.hasEnd;

      latestSession = {
        ...latestSession,
        endSteps: enrichEndSteps(latestSession.endSteps, {
          statelogFiles: statelogFiles.filter((f: string) => f.startsWith(today)),
          sessionActive,
          seedCondensedToday,
          indexModifiedToday,
        }),
      };
    }

    // Determine phase
    let phase: "idle" | "starting" | "running" | "ending" = "idle";
    if (sessionActive) {
      if (latestSession && !latestSession.hasEnd) {
        const startStepsDone = latestSession.startSteps.filter(s => s.status === "done").length;
        if (startStepsDone < 4) phase = "starting";
        else phase = "running";
      } else {
        phase = "running";
      }
    }

    // Engine subsystems — always try to fetch via Tauri backend proxy
    // (the proxy does its own port detection from .env)
    let engineSubs = await fetchEngineSubsystems();
    const engineOnline = engineSubs.length > 0 || sidecarStatus.status === "running";
    if (engineSubs.length === 0 && !engineOnline) {
      engineSubs = [
        { id: "engine", name: "Soul Engine", status: "offline", detail: "Engine not running", metric: null },
      ];
    }

    // File integrity
    const fileChecks = await checkFiles();

    // Costs
    let costs: CostInfo = { todayTokens: 0, todayCalls: 0, budgetPercent: 0 };
    if (costRaw) {
      try {
        const costData = JSON.parse(costRaw);
        const todayData = costData.daily?.[today];
        if (todayData) {
          const totalTokens = Object.values(todayData as Record<string, { input?: number; output?: number; calls?: number }>)
            .reduce((sum: number, cat) => sum + (cat.input || 0) + (cat.output || 0), 0);
          const totalCalls = Object.values(todayData as Record<string, { calls?: number }>)
            .reduce((sum: number, cat) => sum + (cat.calls || 0), 0);
          costs = {
            todayTokens: totalTokens,
            todayCalls: totalCalls,
            budgetPercent: Math.round((totalTokens / 500000) * 100),
          };
        }
      } catch { /* ignore parse errors */ }
    }

    setData(prev => ({
      session: { active: sessionActive, number: sessionNumber, startTime: sessionStartTime, duration, phase },
      todaySessions: allSessions,
      latestSession,
      engine: engineSubs.length > 0 ? engineSubs : (engineOnline ? prev.engine : engineSubs),
      engineOnline,
      eventStream: eventsRef.current,
      files: fileChecks,
      costs,
      lastRefresh: Date.now(),
    }));
  }, []);

  // Real-time events
  useEffect(() => {
    console.debug("[Monitor] Setting up event listeners");
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      events.onPulse((pulse: SoulPulse) => {
        console.debug("[Monitor] pulse event:", pulse.activity_type, pulse.label);
        addEvent("pulse", pulse.activity_type, pulse.label);
      })
    );

    unlisteners.push(
      events.onActivity((activity: SoulActivity) => {
        console.debug("[Monitor] activity event:", activity.node, activity.file);
        addEvent("file", activity.node, `${activity.event_type}: ${activity.file}`);
      })
    );

    unlisteners.push(
      events.onBusEvent((event: unknown) => {
        const e = event as { type?: string; source?: string };
        console.debug("[Monitor] bus event:", e.type, e.source);
        addEvent("bus", e.source || "bus", e.type || "event");
      })
    );

    unlisteners.push(
      events.onMood(() => {
        console.debug("[Monitor] mood event");
        addEvent("mood", "mood", "Mood changed");
      })
    );

    return () => {
      unlisteners.forEach(p => p.then(unlisten => unlisten()).catch(() => {}));
    };
  }, [addEvent]);

  // Polling interval
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [refresh]);

  return data;
}

/* ── File checker ───────────────────────────────────────── */

async function checkFiles(): Promise<FileInfo[]> {
  const results: FileInfo[] = [];

  for (const filePath of SOUL_FILES) {
    try {
      const content = await commands.readSoulFile(filePath);
      results.push({
        path: filePath,
        exists: true,
        sizeBytes: new Blob([content]).size,
        lastModified: null, // Tauri readSoulFile doesn't return mtime
        valid: content.length > 0,
        note: content.length === 0 ? "Empty file" : null,
      });
    } catch {
      // File doesn't exist — only add if it's a likely file for this soul
      // Skip English variants if German files exist and vice versa
      if (!results.some(r => r.exists && isSameRole(r.path, filePath))) {
        results.push({
          path: filePath,
          exists: false,
          sizeBytes: 0,
          lastModified: null,
          valid: false,
          note: "Not found",
        });
      }
    }
  }

  // Filter out missing files that have an existing counterpart in the other language
  return results.filter(f => {
    if (f.exists) return true;
    // Don't show missing English file if German exists, and vice versa
    return !results.some(other => other.exists && isSameRole(other.path, f.path));
  });
}

/** Check if two file paths serve the same role (DE vs EN variant). */
function isSameRole(a: string, b: string): boolean {
  const roleMap: Record<string, string> = {
    "seele/KERN.md": "soul/CORE.md",
    "seele/BEWUSSTSEIN.md": "soul/CONSCIOUSNESS.md",
    "seele/SCHATTEN.md": "soul/SHADOW.md",
    "seele/INTERESSEN.md": "soul/INTERESTS.md",
    "seele/WACHSTUM.md": "soul/GROWTH.md",
    "seele/MANIFEST.md": "soul/MANIFEST.md",
    "seele/TRAEUME.md": "soul/DREAMS.md",
    "seele/EVOLUTION.md": "soul/EVOLUTION.md",
    "seele/GARTEN.md": "soul/GARDEN.md",
    "erinnerungen/INDEX.md": "memories/INDEX.md",
  };

  for (const [de, en] of Object.entries(roleMap)) {
    if ((a === de && b === en) || (a === en && b === de)) return true;
  }
  return false;
}
