// Gemeinsame Typen für soulOSX.

export interface NodeConfig {
  id: string;        // 'mac' | 'alm'
  label: string;     // 'macbook' | 'server'
  base: string;      // http://localhost:3002
  local: boolean;    // true → SSE direkt via EventSource erlaubt
}

export interface SoulStatus {
  name?: string;
  mood?: string;
  born?: string;
  sessions?: number;
  ageDays?: number;
  language?: string;
  model?: string;
  lastHeartbeat?: string;
  connections?: number;
  isWorking?: boolean;
  hibernating?: boolean;
  pulse?: { type?: string; label?: string; activity?: string } | null;
}

export interface BusEvent {
  id?: number;
  type?: string;
  ts?: number;
  source?: string;
  // beliebige Payload
  [k: string]: unknown;
}

export type ConnState = "online" | "offline" | "auth" | "connecting";

export interface NodeRuntime {
  node: NodeConfig;
  state: ConnState;
  status: SoulStatus | null;
  events: BusEvent[];
  lastError?: string;
}
