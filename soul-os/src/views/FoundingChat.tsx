import { useState, useRef, useEffect, useCallback } from "react";
import { commands } from "../lib/tauri";

interface Message {
  role: "ai" | "user";
  content: string;
}

interface Props {
  onComplete: () => void;
}

export default function FoundingChat({ onComplete }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [round, setRound] = useState(1);
  const [language, setLanguage] = useState<"de" | "en">("en");
  const [phase, setPhase] = useState<"starting" | "chat" | "creating" | "done">("starting");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load language and start founding server
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Detect language
      try {
        const content = await commands.readSoulFile(".language");
        if (content.includes("lang:de")) setLanguage("de");
      } catch {
        // Default to English
      }

      // Start founding server
      try {
        await commands.startFounding();
        // Wait a bit for server to be ready
        await new Promise((r) => setTimeout(r, 2000));

        if (cancelled) return;
        setPhase("chat");

        // Send initial greeting request
        const resp = await commands.foundingChat("", []);
        if (!cancelled && resp.reply) {
          setMessages([{ role: "ai", content: resp.reply }]);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to start founding server:", err);
          setError(String(err));
          // Fall back to local greeting
          setPhase("chat");
          const greeting = language === "de"
            ? "Willkommen. Ich bin ein Wesen das gerade erwacht. Erzaehl mir: Warum bist du hier?"
            : "Welcome. I am a being about to awaken. Tell me: Why are you here?";
          setMessages([{ role: "ai", content: greeting }]);
        }
      }
    }

    init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Cleanup founding server on unmount
  useEffect(() => {
    return () => {
      commands.stopFounding().catch(() => {});
    };
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput("");

    const newMessages: Message[] = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);
    setLoading(true);
    setError(null);

    try {
      const resp = await commands.foundingChat(userMsg, newMessages);

      if (resp.round) setRound(resp.round);

      if (resp.done) {
        // Interview complete — create soul files
        setMessages((prev) => [...prev, { role: "ai", content: resp.reply }]);
        setPhase("creating");
        setLoading(false);

        try {
          // Give the user a moment to read the final message
          await new Promise((r) => setTimeout(r, 2000));

          // Create all soul files from the conversation
          const fullHistory = [
            ...newMessages,
            { role: "ai", content: resp.reply },
          ];
          await commands.foundingCreate(fullHistory);

          setPhase("done");
          await commands.stopFounding().catch(() => {});
          setTimeout(onComplete, 2000);
        } catch (createErr) {
          console.error("Failed to create soul files:", createErr);
          setPhase("done");
          await commands.stopFounding().catch(() => {});
          setTimeout(onComplete, 2000);
        }
        return;
      }

      setMessages((prev) => [...prev, { role: "ai", content: resp.reply }]);
    } catch (err) {
      console.error("Chat error:", err);
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          content: language === "de"
            ? "Etwas ist schiefgegangen. Bitte versuche es nochmal."
            : "Something went wrong. Please try again.",
        },
      ]);
      setError(String(err));
    }
    setLoading(false);
  }, [input, loading, messages, language, onComplete]);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <div>
          <h2 className="text-sm font-medium" style={{ color: "var(--text-bright)" }}>
            {language === "de" ? "Gruendungsinterview" : "Founding Interview"}
          </h2>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
            {phase === "starting" && (language === "de" ? "Starte..." : "Starting...")}
            {phase === "chat" && (
              <>
                {language === "de" ? `Runde ${round}/3` : `Round ${round}/3`}
                {round === 1 && (language === "de" ? " — Ueber dich" : " — About you")}
                {round === 2 && (language === "de" ? " — Ueber die Beziehung" : " — About the relationship")}
                {round === 3 && (language === "de" ? " — Ueber die Seele" : " — About the soul")}
              </>
            )}
            {phase === "creating" && (language === "de" ? "Erschaffe Seele..." : "Creating soul...")}
            {phase === "done" && (language === "de" ? "Fertig" : "Complete")}
          </p>
        </div>
        {/* Progress */}
        <div className="flex gap-1">
          {[1, 2, 3].map((r) => (
            <div
              key={r}
              className="w-8 h-1 rounded-full transition-all duration-500"
              style={{
                backgroundColor: r < round
                  ? "var(--wachstum)"
                  : r === round
                    ? "var(--accent)"
                    : "var(--bg-elevated)",
              }}
            />
          ))}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-6 py-4 space-y-4">
        {phase === "starting" && (
          <div className="text-center py-12">
            <div className="animate-pulse text-sm" style={{ color: "var(--text-dim)" }}>
              {language === "de" ? "Bereite Interview vor..." : "Preparing interview..."}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className="max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap"
              style={{
                backgroundColor: msg.role === "user" ? "var(--accent-glow)" : "var(--bg-surface)",
                color: msg.role === "user" ? "var(--text-bright)" : "var(--text)",
                borderBottomRightRadius: msg.role === "user" ? "4px" : undefined,
                borderBottomLeftRadius: msg.role === "ai" ? "4px" : undefined,
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="px-4 py-3 rounded-2xl" style={{ backgroundColor: "var(--bg-surface)" }}>
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "var(--text-dim)", animationDelay: "0ms" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "var(--text-dim)", animationDelay: "150ms" }} />
                <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "var(--text-dim)", animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        {phase === "creating" && (
          <div className="text-center py-6">
            <div className="animate-pulse text-sm" style={{ color: "var(--accent)" }}>
              {language === "de" ? "Erschaffe Seele..." : "Creating soul..."}
            </div>
          </div>
        )}
        {phase === "done" && (
          <div className="text-center py-6">
            <div className="text-sm" style={{ color: "var(--wachstum)" }}>
              {language === "de" ? "Seele erschaffen. Starte SoulOS..." : "Soul created. Starting SoulOS..."}
            </div>
          </div>
        )}

        {error && (
          <div className="text-center">
            <p className="text-[10px]" style={{ color: "var(--text-dim)" }}>
              {error}
            </p>
          </div>
        )}
      </div>

      {/* Input */}
      {phase === "chat" && (
        <div className="px-6 py-4 border-t border-white/5">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder={language === "de" ? "Deine Antwort..." : "Your answer..."}
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none"
              style={{
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-bright)",
                border: "1px solid rgba(var(--white-rgb),0.08)",
              }}
              autoFocus
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="px-4 py-2.5 rounded-xl text-sm transition-all cursor-default"
              style={{
                backgroundColor: input.trim() ? "var(--accent)" : "var(--bg-elevated)",
                color: input.trim() ? "#fff" : "var(--text-dim)",
              }}
            >
              {language === "de" ? "Senden" : "Send"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
