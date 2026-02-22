import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

// --- Types matching Rust structs ---

export interface SoulStatus {
  name: string;
  born: string;
  sessions: number;
  model: string;
  state: string;
  mood: string;
  seed_size: number;
}

export interface SoulPulse {
  activity_type: string;
  label: string;
  timestamp: number;
}

export interface SoulActivity {
  node: string;
  file: string;
  event_type: string;
}

export interface SoulMood {
  valence: number | null;
  energy: number | null;
  label: string | null;
}

export interface SidecarStatus {
  process: string;
  status: string;
  pid: number | null;
  uptime_secs: number | null;
}

export interface GitCommit {
  hash: string;
  date: string;
  message: string;
  files_changed: number;
}

export interface NodeInfo {
  found: boolean;
  path: string;
  version: string;
}

// --- Commands (Frontend → Rust) ---

export const commands = {
  // App state & config
  getAppState: () => invoke<string>("get_app_state"),
  getSoulPath: () => invoke<string>("get_soul_path"),
  setSoulPath: (path: string) => invoke<void>("set_soul_path", { path }),
  checkNode: () => invoke<NodeInfo>("check_node"),
  createSoulDirectories: () => invoke<void>("create_soul_directories"),

  // Soul data
  getSoulStatus: () => invoke<SoulStatus>("get_soul_status"),
  readSoulFile: (name: string) => invoke<string>("read_soul_file", { name }),
  writeSoulFile: (name: string, content: string) =>
    invoke<void>("write_soul_file", { name, content }),

  // Environment
  readEnv: () => invoke<Record<string, string>>("read_env"),
  writeEnv: (entries: Record<string, string>) =>
    invoke<void>("write_env", { entries }),

  // Brain visualization
  getActiveNodes: () => invoke<Record<string, number>>("get_active_nodes"),
  getIsWorking: () => invoke<boolean>("get_is_working"),

  // Founding
  startFounding: () => invoke<number>("start_founding"),
  stopFounding: () => invoke<void>("stop_founding"),
  foundingChat: (message: string, history: Array<{ role: string; content: string }>) =>
    invoke<{ reply: string; round: number; done: boolean }>("founding_chat", { message, history }),
  foundingCreate: (history: Array<{ role: string; content: string }>) =>
    invoke<{ success: boolean; filesCreated: string[] }>("founding_create", { history }),

  // Engine control
  startEngine: () => invoke<void>("start_engine"),
  stopEngine: () => invoke<void>("stop_engine"),
  getSidecarStatus: () => invoke<SidecarStatus>("get_sidecar_status"),

  // Chain control
  startChain: () => invoke<void>("start_chain"),
  stopChain: () => invoke<void>("stop_chain"),
  getChainStatus: () => invoke<SidecarStatus>("get_chain_status"),

  // PTY
  createPty: (cols: number, rows: number) => invoke<number>("create_pty", { cols, rows }),
  writePty: (id: number, data: string) => invoke<void>("write_pty", { id, data }),
  resizePty: (id: number, cols: number, rows: number) => invoke<void>("resize_pty", { id, cols, rows }),
  closePty: (id: number) => invoke<void>("close_pty", { id }),

  // State Versioning (Git)
  getStateHistory: (limit?: number) => invoke<GitCommit[]>("get_state_history", { limit }),
  getStateDiff: (hash: string) => invoke<string>("get_state_diff", { hash }),
  rollbackState: (hash: string) => invoke<string>("rollback_state", { hash }),

  // Directory listing
  listDirectory: (name: string) => invoke<string[]>("list_directory", { name }),
};

// --- Events (Rust → Frontend) ---

export const events = {
  onPulse: (handler: (pulse: SoulPulse) => void): Promise<UnlistenFn> =>
    listen<SoulPulse>("soul:pulse", (e) => handler(e.payload)),

  onMood: (handler: (mood: SoulMood) => void): Promise<UnlistenFn> =>
    listen<SoulMood>("soul:mood", (e) => handler(e.payload)),

  onActivity: (handler: (activity: SoulActivity) => void): Promise<UnlistenFn> =>
    listen<SoulActivity>("soul:activity", (e) => handler(e.payload)),

  onBusEvent: (handler: (event: unknown) => void): Promise<UnlistenFn> =>
    listen("soul:bus-event", (e) => handler(e.payload)),

  onPtyData: (handler: (data: { id: number; data: string }) => void): Promise<UnlistenFn> =>
    listen("pty:data", (e) => handler(e.payload as { id: number; data: string })),

  onSidecarStdout: (handler: (data: { process: string; line: string }) => void): Promise<UnlistenFn> =>
    listen("sidecar:stdout", (e) => handler(e.payload as { process: string; line: string })),

  onSidecarStderr: (handler: (data: { process: string; line: string }) => void): Promise<UnlistenFn> =>
    listen("sidecar:stderr", (e) => handler(e.payload as { process: string; line: string })),

  onSidecarStatus: (handler: (status: SidecarStatus) => void): Promise<UnlistenFn> =>
    listen<SidecarStatus>("sidecar:status", (e) => handler(e.payload)),

  // Soul engine feature events
  onMemoryIndexed: (handler: (data: unknown) => void): Promise<UnlistenFn> =>
    listen("soul:memory-indexed", (e) => handler(e.payload)),
  onRlufFeedback: (handler: (data: unknown) => void): Promise<UnlistenFn> =>
    listen("soul:rluf-feedback", (e) => handler(e.payload)),
  onReflection: (handler: (data: unknown) => void): Promise<UnlistenFn> =>
    listen("soul:reflection", (e) => handler(e.payload)),
  onCorrection: (handler: (data: unknown) => void): Promise<UnlistenFn> =>
    listen("soul:correction", (e) => handler(e.payload)),
  onStateCommitted: (handler: (data: unknown) => void): Promise<UnlistenFn> =>
    listen("soul:state-committed", (e) => handler(e.payload)),
  onMediaStored: (handler: (data: unknown) => void): Promise<UnlistenFn> =>
    listen("soul:media-stored", (e) => handler(e.payload)),
};
