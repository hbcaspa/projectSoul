import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { commands, events } from "../lib/tauri";
import "@xterm/xterm/css/xterm.css";

export default function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);

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

    // Try WebGL addon for GPU-accelerated rendering
    try {
      const webgl = new WebglAddon();
      term.loadAddon(webgl);
      webgl.onContextLoss(() => webgl.dispose());
    } catch {
      // WebGL not available, fallback to canvas
    }

    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Create PTY session
    const cols = term.cols;
    const rows = term.rows;

    commands
      .createPty(cols, rows)
      .then((id) => {
        ptyIdRef.current = id;
        setReady(true);

        // Terminal input → PTY
        term.onData((data) => {
          commands.writePty(id, data).catch(console.error);
        });

        // Terminal resize → PTY
        term.onResize(({ cols, rows }) => {
          commands.resizePty(id, cols, rows).catch(console.error);
        });
      })
      .catch((e) => {
        term.writeln(`\r\n\x1b[31mFailed to create PTY: ${e}\x1b[0m`);
      });

    // PTY output → Terminal
    const unsubPromise = events.onPtyData(({ id, data }) => {
      if (id === ptyIdRef.current) {
        term.write(data);
      }
    });

    // Handle window resize
    const handleResize = () => {
      if (fitRef.current) {
        fitRef.current.fit();
      }
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
  }, []);

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: "#0D0F1A" }}>
      {!ready && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs" style={{ color: "var(--text-dim)" }}>
          <span className="animate-pulse">Starting terminal...</span>
        </div>
      )}
      <div ref={containerRef} className="flex-1 min-h-0 px-1 py-1" />
    </div>
  );
}
