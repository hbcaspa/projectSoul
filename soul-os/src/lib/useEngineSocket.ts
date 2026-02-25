/**
 * Global Engine WebSocket — persistent connection to soul-engine.
 *
 * Lives at App level so browser commands from the engine (e.g. via
 * POST /api/browser from Claude Code) arrive regardless of which
 * panel is open. WhisperView keeps its own WS for chat messages.
 */

import { useEffect, useRef } from "react";
import { commands } from "./tauri";
import { openUrl } from "./browser";

const BROWSER_RE = /\[BROWSER:(https?:\/\/[^\]]+)\]/g;

export function useEngineSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    mountedRef.current = true;

    async function connect() {
      try {
        const env = await commands.readEnv();
        const port = env.API_PORT || "3001";
        const apiKey = env.API_KEY;
        if (!apiKey) return;

        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "auth", apiKey }));
        };

        ws.onmessage = (event) => {
          if (!mountedRef.current) return;
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "browser":
              if (msg.url) openUrl(msg.url, false);
              break;

            case "response": {
              // Extract [BROWSER:url] tags from any engine response
              let match: RegExpExecArray | null;
              while ((match = BROWSER_RE.exec(msg.text || "")) !== null) {
                openUrl(match[1].trim(), false);
              }
              BROWSER_RE.lastIndex = 0;
              break;
            }

            // Ignore all other message types (chat, pulse, events)
            // — those are handled by WhisperView and useMonitor
          }
        };

        ws.onclose = () => {
          if (!mountedRef.current) return;
          wsRef.current = null;
          reconnectRef.current = setTimeout(() => {
            if (mountedRef.current) connect();
          }, 5000);
        };

        ws.onerror = () => {
          // onclose fires after onerror
        };
      } catch {
        // Engine not available — will retry via onclose
      }
    }

    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);
}
