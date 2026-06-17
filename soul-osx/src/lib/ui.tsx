// Geteilter UI-Zustand der Control-Plane: Haupt-View (terminal|control|kortex),
// ⌘K-Palette und das aktuell im Inspector geöffnete Modul. Plus globales
// Keyboard-Handling (⌘1/⌘2/⌘3 Views, ⌘K Palette, Esc schließt Overlays).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ViewMode = "terminal" | "control" | "kortex";

interface UIContextValue {
  view: ViewMode;
  setView: (v: ViewMode) => void;
  paletteOpen: boolean;
  setPaletteOpen: (b: boolean) => void;
  togglePalette: () => void;
  /** Modul-ID, das im Inspector (Slide-over) offen ist — oder null. */
  inspectId: string | null;
  /** Öffnet den Inspector; bringt zugleich die Control-View in den Vordergrund. */
  inspect: (id: string | null) => void;
}

const Ctx = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewMode>("terminal");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [inspectId, setInspectId] = useState<string | null>(null);

  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);

  const inspect = useCallback((id: string | null) => {
    setInspectId(id);
  }, []);

  // Aktuellen Overlay-Zustand für den Esc-Handler spiegeln (ohne Listener neu zu binden).
  const paletteRef = useRef(paletteOpen);
  paletteRef.current = paletteOpen;
  const inspectRef = useRef(inspectId);
  inspectRef.current = inspectId;

  // Globale Shortcuts. ⌘K überall; ⌘1/2/3 wenn nicht in einem Texteingabefeld.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inField = tag === "INPUT" || tag === "TEXTAREA";
      // xterm fängt Tastatur selbst ab; ⌘K muss trotzdem global gehen.
      if (meta && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (meta && !inField && (e.key === "1" || e.key === "2" || e.key === "3")) {
        e.preventDefault();
        setView(e.key === "1" ? "terminal" : e.key === "2" ? "control" : "kortex");
        return;
      }
      if (e.key === "Escape") {
        // Esc-Priorität: Palette → Inspector. Niemals Terminal stören.
        if (paletteRef.current) setPaletteOpen(false);
        else if (inspectRef.current) setInspectId(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const value = useMemo<UIContextValue>(
    () => ({ view, setView, paletteOpen, setPaletteOpen, togglePalette, inspectId, inspect }),
    [view, paletteOpen, inspectId, togglePalette, inspect]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useUI(): UIContextValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useUI must be used within UIProvider");
  return c;
}
