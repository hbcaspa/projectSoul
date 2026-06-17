// Zentraler Live-State von soulOSX.
// Pro Node: Status-Polling (/api/status, 5s) + Event-Stream (SSE/Poll). Hält Mood,
// einen Event-Ringpuffer und "kürzlich gefeuerte" Module (fürs Kortex-Leuchten).

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EngineClient, EngineError } from "./engine";
import { configuredNodes, getKey, setKey as persistKey } from "./nodes";
import { modulesForEvent } from "./manifest";
import type { BusEvent, ConnState, NodeConfig, SoulStatus } from "./types";

interface NodeState {
  node: NodeConfig;
  client: EngineClient;
  conn: ConnState;
  status: SoulStatus | null;
  error?: string;
}

interface SoulContextValue {
  nodes: NodeState[];
  activeId: string;
  setActiveId: (id: string) => void;
  active: NodeState | undefined;
  events: BusEvent[];
  lastEvent: BusEvent | null;
  recentFires: Map<string, number>;
  mood: string;
  needsKey: boolean;
  submitKey: (key: string) => void;
  reloadTick: number;
}

const Ctx = createContext<SoulContextValue | null>(null);

const EVENT_BUFFER = 200;

export function SoulProvider({ children }: { children: ReactNode }) {
  const cfg = useMemo(() => configuredNodes(), []);
  const clients = useMemo(() => cfg.map((n) => new EngineClient(n)), [cfg]);

  const [activeId, setActiveId] = useState(cfg[0]?.id ?? "mac");
  const [conns, setConns] = useState<Record<string, ConnState>>(
    Object.fromEntries(cfg.map((n) => [n.id, "connecting" as ConnState]))
  );
  const [statuses, setStatuses] = useState<Record<string, SoulStatus | null>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<BusEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<BusEvent | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const firesRef = useRef<Map<string, number>>(new Map());
  const [, forceFire] = useState(0);

  const activeClient = clients.find((c) => c.node.id === activeId);

  // Status-Polling pro Node
  useEffect(() => {
    let stop = false;
    const timers: number[] = [];
    for (const client of clients) {
      const id = client.node.id;
      const poll = async () => {
        if (stop) return;
        try {
          const st = await client.get<SoulStatus>("/api/status");
          if (stop) return;
          setStatuses((s) => ({ ...s, [id]: st }));
          setConns((c) => ({ ...c, [id]: "online" }));
          setErrors((e) => ({ ...e, [id]: "" }));
        } catch (e) {
          if (stop) return;
          const err = e as EngineError;
          setConns((c) => ({ ...c, [id]: err.status === 401 ? "auth" : "offline" }));
          setErrors((er) => ({ ...er, [id]: err.message }));
        }
        timers.push(setTimeout(poll, 5000) as unknown as number);
      };
      poll();
    }
    return () => {
      stop = true;
      timers.forEach(clearTimeout);
    };
  }, [clients, reloadTick]);

  // Event-Stream nur des aktiven Node (spart Verbindungen/Re-Renders)
  useEffect(() => {
    if (!activeClient) return;
    setEvents([]);
    const cleanup = activeClient.streamEvents(
      (ev) => {
        setLastEvent(ev);
        setEvents((prev) => {
          const next = prev.concat(ev);
          return next.length > EVENT_BUFFER ? next.slice(-EVENT_BUFFER) : next;
        });
        const hit = modulesForEvent(ev.type);
        if (hit.length) {
          const now = Date.now();
          for (const id of hit) firesRef.current.set(id, now);
          forceFire((n) => n + 1);
        }
      },
      (s) => setConns((c) => ({ ...c, [activeId]: s }))
    );
    return cleanup;
  }, [activeClient, activeId, reloadTick]);

  const nodes: NodeState[] = clients.map((client) => ({
    node: client.node,
    client,
    conn: conns[client.node.id] ?? "connecting",
    status: statuses[client.node.id] ?? null,
    error: errors[client.node.id],
  }));

  const active = nodes.find((n) => n.node.id === activeId);
  const mood = active?.status?.mood ?? "still";
  const needsKey =
    (active?.conn === "auth") || (active?.conn === "offline" && !getKey(activeId));

  const submitKey = (key: string) => {
    persistKey(activeId, key.trim());
    setReloadTick((t) => t + 1);
  };

  const value: SoulContextValue = {
    nodes,
    activeId,
    setActiveId,
    active,
    events,
    lastEvent,
    recentFires: firesRef.current,
    mood,
    needsKey,
    submitKey,
    reloadTick,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSoul(): SoulContextValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSoul must be used within SoulProvider");
  return c;
}
