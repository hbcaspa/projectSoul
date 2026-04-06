import { useCallback, useRef, useEffect, type ReactNode } from "react";
import { useWindowManager, type WindowState } from "./WindowManager";

interface WindowProps {
  state: WindowState;
  children: ReactNode;
}

export default function Window({ state, children }: WindowProps) {
  const { focusWindow, closeWindow, minimizeWindow, maximizeWindow, moveWindow, resizeWindow } =
    useWindowManager();
  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; winW: number; winH: number } | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);

  // Drag handling
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (state.maximized) return;
      e.preventDefault();
      focusWindow(state.id);
      dragRef.current = { startX: e.clientX, startY: e.clientY, winX: state.x, winY: state.y };
    },
    [state.id, state.x, state.y, state.maximized, focusWindow]
  );

  // Resize handling
  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (state.maximized) return;
      e.preventDefault();
      e.stopPropagation();
      focusWindow(state.id);
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        winW: state.width,
        winH: state.height,
      };
    },
    [state.id, state.width, state.height, state.maximized, focusWindow]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dy = e.clientY - dragRef.current.startY;
        moveWindow(state.id, dragRef.current.winX + dx, dragRef.current.winY + dy);
      }
      if (resizeRef.current) {
        const dx = e.clientX - resizeRef.current.startX;
        const dy = e.clientY - resizeRef.current.startY;
        resizeWindow(state.id, resizeRef.current.winW + dx, resizeRef.current.winH + dy);
      }
    };
    const onMouseUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [state.id, moveWindow, resizeWindow]);

  if (state.minimized) return null;

  const isMax = state.maximized;
  const style: React.CSSProperties = isMax
    ? { position: "absolute", inset: 0, zIndex: state.zIndex }
    : {
        position: "absolute",
        left: state.x,
        top: state.y,
        width: state.width,
        height: state.height,
        zIndex: state.zIndex,
      };

  return (
    <div
      ref={windowRef}
      className="os-window"
      style={style}
      onMouseDown={() => focusWindow(state.id)}
    >
      {/* Title bar */}
      <div className="os-titlebar" onMouseDown={onDragStart} onDoubleClick={() => maximizeWindow(state.id)}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="os-titlebar-icon" style={{ color: state.color, filter: `drop-shadow(0 0 4px ${state.color}88)` }}>
            {state.icon}
          </span>
          <span className="os-titlebar-text" style={{ color: state.color }}>
            {state.title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="os-win-btn os-win-btn-minimize"
            onClick={(e) => { e.stopPropagation(); minimizeWindow(state.id); }}
          >
            <svg viewBox="0 0 10 10" className="w-2.5 h-2.5"><path d="M2 5h6" stroke="currentColor" strokeWidth="1.5" /></svg>
          </button>
          <button
            className="os-win-btn os-win-btn-maximize"
            onClick={(e) => { e.stopPropagation(); maximizeWindow(state.id); }}
          >
            <svg viewBox="0 0 10 10" className="w-2.5 h-2.5"><rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
          </button>
          <button
            className="os-win-btn os-win-btn-close"
            onClick={(e) => { e.stopPropagation(); closeWindow(state.id); }}
          >
            <svg viewBox="0 0 10 10" className="w-2.5 h-2.5"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" /></svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="os-window-content">
        {children}
      </div>

      {/* Resize handle */}
      {!isMax && (
        <div className="os-resize-handle" onMouseDown={onResizeStart}>
          <svg viewBox="0 0 8 8" className="w-2 h-2" style={{ color: "var(--text-muted)" }}>
            <path d="M7 1L1 7M7 4L4 7M7 7L7 7" stroke="currentColor" strokeWidth="1" />
          </svg>
        </div>
      )}

      {/* Accent glow border */}
      <div
        className="absolute inset-0 rounded-xl pointer-events-none"
        style={{
          border: `1px solid ${state.color}30`,
          boxShadow: `0 0 20px ${state.color}10, inset 0 1px 0 rgba(255,255,255,0.05)`,
        }}
      />
    </div>
  );
}
