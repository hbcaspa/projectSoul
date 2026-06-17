// EngineClient — spricht die Soul-Engine an.
//
// REST: via Tauri-Command `engine_fetch` (Rust/reqwest) → kein CORS, beide Nodes.
//   Fallback im reinen Browser (vite dev ohne Tauri): window.fetch.
// SSE:  via EventSource (webview-seitig) für lokale Nodes — der Live-Animationstreiber.
//       Remote-Nodes pollen /api/events.

import { invoke } from "@tauri-apps/api/core";
import type { BusEvent, NodeConfig } from "./types";
import { getKey } from "./nodes";

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export class EngineError extends Error {
  status?: number;
  constructor(msg: string, status?: number) {
    super(msg);
    this.status = status;
  }
}

async function rawFetch(
  base: string,
  path: string,
  key: string,
  method = "GET",
  body?: unknown
): Promise<string> {
  if (inTauri()) {
    return invoke<string>("engine_fetch", {
      base,
      path,
      key: key || null,
      method,
      body: body != null ? JSON.stringify(body) : null,
    });
  }
  // Browser-Dev-Fallback
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(body != null ? { "content-type": "application/json" } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new EngineError(text.slice(0, 240), res.status);
  return text;
}

export class EngineClient {
  constructor(public node: NodeConfig) {}

  private key() {
    return getKey(this.node.id);
  }

  async get<T = unknown>(path: string): Promise<T> {
    const text = await this.call(path, "GET");
    return JSON.parse(text) as T;
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const text = await this.call(path, "POST", body);
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private async call(path: string, method: string, body?: unknown): Promise<string> {
    try {
      return await rawFetch(this.node.base, path, this.key(), method, body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const m = msg.match(/HTTP (\d{3})/);
      const status = m ? parseInt(m[1], 10) : (e as EngineError)?.status;
      throw new EngineError(msg, status);
    }
  }

  /**
   * Live-Event-Stream. Für lokale Nodes via EventSource (echte Push-Updates).
   * Liefert eine cleanup-Funktion. onState meldet Verbindungszustand.
   */
  streamEvents(
    onEvent: (ev: BusEvent) => void,
    onState?: (s: "online" | "offline") => void
  ): () => void {
    if (this.node.local && typeof EventSource !== "undefined") {
      let es: EventSource | null = null;
      let stopped = false;
      let retry = 1000;

      const connect = () => {
        if (stopped) return;
        const key = this.key();
        const url = `${this.node.base.replace(/\/$/, "")}/api/events/stream${
          key ? `?key=${encodeURIComponent(key)}` : ""
        }`;
        es = new EventSource(url);
        es.onopen = () => {
          retry = 1000;
          onState?.("online");
        };
        es.onmessage = (m) => {
          try {
            onEvent(JSON.parse(m.data));
          } catch { /* ignore */ }
        };
        es.onerror = () => {
          onState?.("offline");
          es?.close();
          if (!stopped) {
            retry = Math.min(retry * 1.7, 15000);
            setTimeout(connect, retry);
          }
        };
      };
      connect();
      return () => {
        stopped = true;
        es?.close();
      };
    }

    // Remote-Fallback: /api/events pollen
    let since = 0;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const r = await this.get<{ events: BusEvent[]; lastId: number }>(
          `/api/events?since=${since}&limit=40`
        );
        if (r.events?.length) {
          for (const ev of r.events) onEvent(ev);
          since = r.lastId ?? since;
        }
        onState?.("online");
      } catch {
        onState?.("offline");
      }
      if (!stopped) setTimeout(tick, 2000);
    };
    tick();
    return () => {
      stopped = true;
    };
  }
}
