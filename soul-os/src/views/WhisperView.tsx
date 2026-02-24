import { useState, useCallback, useEffect, useRef } from "react";
import { commands } from "../lib/tauri";
import { openUrl } from "../lib/browser";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Extract [BROWSER:url] tags from response, return clean text + urls */
function extractBrowserActions(text: string): { cleanText: string; urls: string[] } {
  const urls: string[] = [];
  const cleanText = text
    .replace(/\[BROWSER:(https?:\/\/[^\]]+)\]/g, (_, url) => {
      urls.push(url.trim());
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { cleanText, urls };
}

export default function WhisperView() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<"connecting" | "online" | "offline">("connecting");
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountedRef = useRef(true);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  // WebSocket lifecycle
  useEffect(() => {
    mountedRef.current = true;

    async function connect() {
      try {
        const env = await commands.readEnv();
        const port = env.API_PORT || "3001";
        const apiKey = env.API_KEY;

        if (!apiKey) {
          if (mountedRef.current) {
            setStatus("offline");
            setMessages((prev) => [
              ...prev,
              { role: "system", content: "Kein API_KEY in .env konfiguriert." },
            ]);
          }
          return;
        }

        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        wsRef.current = ws;

        ws.onopen = () => {
          ws.send(JSON.stringify({ type: "auth", apiKey }));
        };

        ws.onmessage = (event) => {
          if (!mountedRef.current) return;
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "auth_ok":
              setConnected(true);
              setStatus("online");
              break;

            case "auth_error":
              setStatus("offline");
              setMessages((prev) => [
                ...prev,
                { role: "system", content: "Auth fehlgeschlagen — API_KEY stimmt nicht." },
              ]);
              break;

            case "typing":
              setLoading(true);
              break;

            case "response": {
              const { cleanText, urls } = extractBrowserActions(msg.text);
              setMessages((prev) => [...prev, { role: "assistant", content: cleanText }]);
              setLoading(false);
              // Open each extracted URL in the embedded browser
              for (const url of urls) {
                openUrl(url, false);
              }
              break;
            }

            case "error":
              setMessages((prev) => [
                ...prev,
                { role: "system", content: `Fehler: ${msg.message}` },
              ]);
              setLoading(false);
              break;

            case "browser":
              // Remote browser open (e.g. from Claude Code via API)
              if (msg.url) openUrl(msg.url, false);
              break;

            case "pulse":
              // Ignore pulse events in chat view
              break;
          }
        };

        ws.onclose = () => {
          if (!mountedRef.current) return;
          setConnected(false);
          setStatus("offline");
          wsRef.current = null;
          // Reconnect after 5s
          reconnectRef.current = setTimeout(() => {
            if (mountedRef.current) connect();
          }, 5000);
        };

        ws.onerror = () => {
          // onclose fires after onerror
        };
      } catch {
        if (mountedRef.current) setStatus("offline");
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

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !wsRef.current || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setLoading(true);
    wsRef.current.send(JSON.stringify({ type: "message", text }));

    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = "auto";
  }, [input, loading]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  // Auto-resize textarea
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-4">
        {messages.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background:
                  "linear-gradient(135deg, rgba(100,200,255,0.06), rgba(var(--accent-rgb),0.03))",
                border: "1px solid rgba(100,200,255,0.08)",
                boxShadow: "0 4px 24px rgba(100,200,255,0.06)",
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="w-8 h-8"
                style={{ color: "var(--accent)", opacity: 0.4 }}
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-sm font-light" style={{ color: "var(--text-dim)" }}>
              {status === "online"
                ? "Sprich mit mir..."
                : status === "connecting"
                  ? "Verbinde..."
                  : "Engine offline"}
            </p>
            {status === "offline" && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Starte die Soul Engine um zu chatten
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className="max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap"
                  style={
                    msg.role === "user"
                      ? {
                          background: "rgba(var(--accent-rgb), 0.15)",
                          border: "1px solid rgba(var(--accent-rgb), 0.2)",
                          color: "var(--text-bright)",
                        }
                      : msg.role === "system"
                        ? {
                            background: "rgba(255,60,60,0.08)",
                            border: "1px solid rgba(255,60,60,0.15)",
                            color: "var(--text-dim)",
                            fontSize: "0.75rem",
                          }
                        : {
                            background: "rgba(var(--white-rgb), 0.04)",
                            border: "1px solid rgba(var(--white-rgb), 0.06)",
                            color: "var(--text)",
                          }
                  }
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div
                  className="px-4 py-3 rounded-2xl"
                  style={{
                    background: "rgba(var(--white-rgb), 0.04)",
                    border: "1px solid rgba(var(--white-rgb), 0.06)",
                  }}
                >
                  <div className="flex gap-1.5">
                    {[0, 150, 300].map((delay) => (
                      <span
                        key={delay}
                        className="w-1.5 h-1.5 rounded-full"
                        style={{
                          backgroundColor: "var(--accent)",
                          animation: "pulse 1.4s ease-in-out infinite",
                          animationDelay: `${delay}ms`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="px-6 pb-5 pt-2">
        <div
          className="flex gap-3 items-end"
          style={{
            background: "rgba(var(--white-rgb), 0.03)",
            border: "1px solid rgba(var(--white-rgb), 0.08)",
            borderRadius: "1rem",
            padding: "0.625rem 0.875rem",
          }}
        >
          {/* Connection dot */}
          <span
            className="w-2 h-2 rounded-full flex-shrink-0 mb-1.5"
            title={status === "online" ? "Verbunden" : "Offline"}
            style={{
              backgroundColor:
                status === "online" ? "var(--wachstum)" : "var(--kern)",
              opacity: 0.8,
              boxShadow:
                status === "online"
                  ? "0 0 6px rgba(0,255,100,0.4)"
                  : "0 0 6px rgba(255,60,60,0.3)",
            }}
          />

          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={connected ? "Nachricht..." : "Engine offline..."}
            disabled={!connected}
            rows={1}
            className="flex-1 bg-transparent border-none outline-none resize-none text-sm"
            style={{
              color: "var(--text-bright)",
              minHeight: "1.25rem",
              maxHeight: "7.5rem",
              lineHeight: "1.5",
            }}
          />

          <button
            onClick={sendMessage}
            disabled={!input.trim() || !connected || loading}
            className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200"
            style={{
              background:
                input.trim() && connected && !loading
                  ? "rgba(var(--accent-rgb), 0.2)"
                  : "transparent",
              color:
                input.trim() && connected && !loading
                  ? "var(--accent)"
                  : "var(--text-muted)",
              cursor:
                input.trim() && connected && !loading ? "pointer" : "default",
            }}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-4 h-4"
            >
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
