import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { createPty, writePty, resizePty, closePty, subscribePty, inTauri } from "../lib/pty";

// Apple-Terminal-Theme: transparent (die Karte/Vibrancy scheint durch), SF Mono,
// zurückhaltende ANSI-Palette die zur macOS-Ästhetik passt.
const THEME = {
  background: "rgba(0,0,0,0)",
  foreground: "#e9e9ee",
  cursor: "#7d7aff",
  cursorAccent: "#15131f",
  selectionBackground: "rgba(125,122,255,0.30)",
  black: "#1c1c1e",
  red: "#ff453a",
  green: "#30d158",
  yellow: "#ffd60a",
  blue: "#64d2ff",
  magenta: "#7d7aff",
  cyan: "#66d4cf",
  white: "#e9e9ee",
  brightBlack: "#5a5a62",
  brightRed: "#ff6961",
  brightGreen: "#5ce08a",
  brightYellow: "#ffe066",
  brightBlue: "#8fe0ff",
  brightMagenta: "#a5a3ff",
  brightCyan: "#9bece8",
  brightWhite: "#ffffff",
};

export default function Terminal({
  id,
  active,
  onReady,
  onExit,
}: {
  id: string;
  active: boolean;
  onReady?: (ptyId: number) => void;
  onExit?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const term = new XTerm({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.35,
      letterSpacing: 0.2,
      cursorBlink: true,
      cursorStyle: "bar",
      allowTransparency: true,
      theme: THEME,
      scrollback: 10000,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    termRef.current = term;
    fitRef.current = fit;
    try { fit.fit(); } catch { /* */ }

    let unsub: (() => void) | null = null;
    let disposed = false;

    if (inTauri()) {
      (async () => {
        const ptyId = await createPty(term.cols, term.rows);
        if (disposed) { closePty(ptyId); return; }
        ptyRef.current = ptyId;
        unsub = await subscribePty(
          ptyId,
          (data) => term.write(data),
          () => { term.writeln("\r\n\x1b[2m— Sitzung beendet —\x1b[0m"); onExit?.(); }
        );
        term.onData((d) => writePty(ptyId, d));
        onReady?.(ptyId);
      })();
    } else {
      term.writeln("\x1b[2m soulOSX — Terminal nur in der nativen App (Tauri) aktiv.\x1b[0m");
    }

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        if (ptyRef.current != null) resizePty(ptyRef.current, term.cols, term.rows);
      } catch { /* */ }
    });
    ro.observe(ref.current);

    return () => {
      disposed = true;
      ro.disconnect();
      unsub?.();
      if (ptyRef.current != null) closePty(ptyRef.current);
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Beim Sichtbarwerden neu einpassen + fokussieren
  useEffect(() => {
    if (active && termRef.current && fitRef.current) {
      requestAnimationFrame(() => {
        try {
          fitRef.current!.fit();
          if (ptyRef.current != null) resizePty(ptyRef.current, termRef.current!.cols, termRef.current!.rows);
          termRef.current!.focus();
        } catch { /* */ }
      });
    }
  }, [active]);

  return <div ref={ref} className="h-full w-full" />;
}
