import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { commands, events } from "../lib/tauri";
import "@xterm/xterm/css/xterm.css";

interface Pane {
  id: number;
  label: string;
}

let nextPaneId = 1;

export default function TerminalView() {
  const [panes, setPanes] = useState<Pane[]>([{ id: nextPaneId++, label: "1" }]);
  const [activeId, setActiveId] = useState(1);

  const addPane = useCallback(() => {
    const id = nextPaneId++;
    setPanes((prev) => [...prev, { id, label: String(prev.length + 1) }]);
    setActiveId(id);
  }, []);

  const closePane = useCallback((id: number) => {
    setPanes((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((p) => p.id !== id);
      // relabel
      return next.map((p, i) => ({ ...p, label: String(i + 1) }));
    });
    setActiveId((prevActive) => {
      if (prevActive === id) {
        const remaining = panes.filter((p) => p.id !== id);
        return remaining.length > 0 ? remaining[remaining.length - 1].id : prevActive;
      }
      return prevActive;
    });
  }, [panes]);

  // Keyboard shortcuts: Cmd+T new, Cmd+W close current
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === "t" || e.key === "T") {
        // Only capture if focus is in terminal area
        const el = document.activeElement;
        if (el?.closest(".xterm") || el?.closest("[data-terminal-area]")) {
          e.preventDefault();
          addPane();
        }
      }
      if (e.key === "w" || e.key === "W") {
        const el = document.activeElement;
        if (el?.closest(".xterm") || el?.closest("[data-terminal-area]")) {
          e.preventDefault();
          if (panes.length > 1) closePane(activeId);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addPane, closePane, activeId, panes.length]);

  return (
    <div className="h-full flex flex-col" data-terminal-area style={{ backgroundColor: "#0D0F1A" }}>
      {/* Tab bar */}
      <div
        className="flex items-center gap-0.5 px-2 py-1 flex-shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
      >
        {panes.map((pane) => (
          <button
            key={pane.id}
            onClick={() => setActiveId(pane.id)}
            className="group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] cursor-default transition-all"
            style={{
              backgroundColor: pane.id === activeId ? "rgba(139,128,240,0.1)" : "transparent",
              color: pane.id === activeId ? "var(--accent)" : "var(--text-dim)",
            }}
          >
            <span className="font-mono">{pane.label}</span>
            {panes.length > 1 && (
              <span
                onClick={(e) => { e.stopPropagation(); closePane(pane.id); }}
                className="w-3 h-3 rounded flex items-center justify-center text-[8px] opacity-0 group-hover:opacity-60 transition-opacity"
                style={{ color: "var(--text-dim)" }}
              >
                {"\u2715"}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={addPane}
          className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] cursor-default transition-all ml-0.5"
          style={{ color: "var(--text-dim)" }}
          title="New terminal (Cmd+T)"
        >
          +
        </button>
      </div>

      {/* Terminal panes side by side */}
      <div className="flex-1 flex min-h-0">
        {panes.map((pane, i) => (
          <div
            key={pane.id}
            className="flex-1 min-w-0"
            style={{
              borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.04)" : "none",
            }}
            onClick={() => setActiveId(pane.id)}
          >
            <TerminalPane paneId={pane.id} isActive={pane.id === activeId} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Single Terminal Pane ──────────────────────────────────── */

function TerminalPane({ paneId, isActive }: { paneId: number; isActive: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

  // Focus terminal when it becomes active
  useEffect(() => {
    if (isActive && termRef.current) {
      termRef.current.focus();
    }
  }, [isActive]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      lineHeight: 1.2,
      theme: {
        background: "#0D0F1A",
        foreground: "#C8C4D6",
        cursor: "#8B80F0",
        cursorAccent: "#0D0F1A",
        selectionBackground: "rgba(139, 128, 240, 0.3)",
        selectionForeground: "#DCDCFF",
        black: "#161830",
        red: "#FF3C3C",
        green: "#00FF64",
        yellow: "#FFC800",
        blue: "#6464FF",
        magenta: "#A000FF",
        cyan: "#00FFC8",
        white: "#C8C4D6",
        brightBlack: "#646482",
        brightRed: "#FF6464",
        brightGreen: "#64FF96",
        brightYellow: "#FFE064",
        brightBlue: "#9696FF",
        brightMagenta: "#C864FF",
        brightCyan: "#64FFE0",
        brightWhite: "#DCDCFF",
      },
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);

    try {
      const webgl = new WebglAddon();
      term.loadAddon(webgl);
      webgl.onContextLoss(() => webgl.dispose());
    } catch { /* fallback to canvas */ }

    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const cols = term.cols;
    const rows = term.rows;

    commands
      .createPty(cols, rows)
      .then((id) => {
        ptyIdRef.current = id;
        setReady(true);

        term.onData((data) => {
          commands.writePty(id, data).catch(console.error);
        });

        term.onResize(({ cols, rows }) => {
          commands.resizePty(id, cols, rows).catch(console.error);
        });
      })
      .catch((e) => {
        term.writeln(`\r\n\x1b[31mFailed to create PTY: ${e}\x1b[0m`);
      });

    const unsubPromise = events.onPtyData(({ id, data }) => {
      if (id === ptyIdRef.current) {
        term.write(data);
      }
    });

    const handleResize = () => {
      if (fitRef.current) fitRef.current.fit();
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      unsubPromise.then((fn) => fn());
      if (ptyIdRef.current !== null) {
        commands.closePty(ptyIdRef.current).catch(() => {});
      }
      term.dispose();
    };
  }, [paneId]);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "#0D0F1A" }}>
      {!ready && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs" style={{ color: "var(--text-dim)" }}>
          <span className="animate-pulse">Starting...</span>
        </div>
      )}
      <div ref={containerRef} className="flex-1 min-h-0 px-1 py-1" />
    </div>
  );
}
