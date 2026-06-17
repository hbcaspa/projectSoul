// PTY-Client — Brücke zwischen xterm (Frontend) und dem Rust-PtyManager.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function createPty(cols: number, rows: number): Promise<number> {
  return invoke<number>("create_pty", { cols, rows });
}
export async function writePty(id: number, data: string): Promise<void> {
  return invoke("write_pty", { id, data });
}
export async function resizePty(id: number, cols: number, rows: number): Promise<void> {
  return invoke("resize_pty", { id, cols, rows });
}
export async function closePty(id: number): Promise<void> {
  return invoke("close_pty", { id });
}

// Globaler Demux: ein "pty:data"/"pty:exit"-Listener, der nach id verteilt.
type DataCb = (data: string) => void;
type ExitCb = () => void;
const dataSubs = new Map<number, DataCb>();
const exitSubs = new Map<number, ExitCb>();
let wired = false;
let unlistenData: UnlistenFn | null = null;
let unlistenExit: UnlistenFn | null = null;

async function ensureWired() {
  if (wired || !inTauri()) return;
  wired = true;
  unlistenData = await listen<{ id: number; data: string }>("pty:data", (e) => {
    dataSubs.get(e.payload.id)?.(e.payload.data);
  });
  unlistenExit = await listen<{ id: number }>("pty:exit", (e) => {
    exitSubs.get(e.payload.id)?.();
  });
}

export async function subscribePty(id: number, onData: DataCb, onExit: ExitCb): Promise<() => void> {
  await ensureWired();
  dataSubs.set(id, onData);
  exitSubs.set(id, onExit);
  return () => {
    dataSubs.delete(id);
    exitSubs.delete(id);
    if (dataSubs.size === 0) {
      unlistenData?.();
      unlistenExit?.();
      unlistenData = unlistenExit = null;
      wired = false;
    }
  };
}
