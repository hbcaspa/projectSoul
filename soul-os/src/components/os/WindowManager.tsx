import { createContext, useContext, useCallback, useState, useRef, type ReactNode } from "react";

export interface WindowState {
  id: string;
  title: string;
  icon: ReactNode;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
}

interface WindowManagerContextType {
  windows: WindowState[];
  openWindow: (id: string, title: string, icon: ReactNode, color: string) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, width: number, height: number) => void;
  isOpen: (id: string) => boolean;
  toggleWindow: (id: string, title: string, icon: ReactNode, color: string) => void;
}

const WindowManagerContext = createContext<WindowManagerContextType | null>(null);

export function useWindowManager() {
  const ctx = useContext(WindowManagerContext);
  if (!ctx) throw new Error("useWindowManager must be inside WindowManagerProvider");
  return ctx;
}

const MIN_WIDTH = 420;
const MIN_HEIGHT = 320;
const DEFAULT_WIDTH = 700;
const DEFAULT_HEIGHT = 500;
const CASCADE_OFFSET = 30;

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const nextZ = useRef(100);
  const cascadeCount = useRef(0);

  const openWindow = useCallback((id: string, title: string, icon: ReactNode, color: string) => {
    setWindows((prev) => {
      const existing = prev.find((w) => w.id === id);
      if (existing) {
        // Already open — focus and unminimize
        const z = ++nextZ.current;
        return prev.map((w) =>
          w.id === id ? { ...w, zIndex: z, minimized: false } : w
        );
      }
      // New window — cascade position
      const offset = (cascadeCount.current % 8) * CASCADE_OFFSET;
      cascadeCount.current++;
      const z = ++nextZ.current;
      return [
        ...prev,
        {
          id,
          title,
          icon,
          color,
          x: 80 + offset,
          y: 40 + offset,
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
          zIndex: z,
          minimized: false,
          maximized: false,
        },
      ];
    });
  }, []);

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const focusWindow = useCallback((id: string) => {
    const z = ++nextZ.current;
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, zIndex: z } : w)));
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, minimized: !w.minimized } : w))
    );
  }, []);

  const maximizeWindow = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, maximized: !w.maximized } : w))
    );
  }, []);

  const moveWindow = useCallback((id: string, x: number, y: number) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, x, y } : w)));
  }, []);

  const resizeWindow = useCallback((id: string, width: number, height: number) => {
    setWindows((prev) =>
      prev.map((w) =>
        w.id === id
          ? { ...w, width: Math.max(MIN_WIDTH, width), height: Math.max(MIN_HEIGHT, height) }
          : w
      )
    );
  }, []);

  const isOpen = useCallback((id: string) => windows.some((w) => w.id === id), [windows]);

  const toggleWindow = useCallback(
    (id: string, title: string, icon: ReactNode, color: string) => {
      const existing = windows.find((w) => w.id === id);
      if (existing && !existing.minimized) {
        closeWindow(id);
      } else {
        openWindow(id, title, icon, color);
      }
    },
    [windows, openWindow, closeWindow]
  );

  return (
    <WindowManagerContext.Provider
      value={{
        windows,
        openWindow,
        closeWindow,
        focusWindow,
        minimizeWindow,
        maximizeWindow,
        moveWindow,
        resizeWindow,
        isOpen,
        toggleWindow,
      }}
    >
      {children}
    </WindowManagerContext.Provider>
  );
}
