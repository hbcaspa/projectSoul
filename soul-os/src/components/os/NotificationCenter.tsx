import { createContext, useContext, useCallback, useState, useEffect, type ReactNode } from "react";

export interface Notification {
  id: number;
  title: string;
  body: string;
  type: "info" | "warning" | "error";
  timestamp: number;
  read: boolean;
}

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  push: (title: string, body: string, type?: "info" | "warning" | "error") => void;
  markAllRead: () => void;
  dismiss: (id: number) => void;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be inside NotificationProvider");
  return ctx;
}

let nextId = 1;

export function NotificationProvider({ children, engineUrl, apiKey }: { children: ReactNode; engineUrl: string; apiKey: string }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [toasts, setToasts] = useState<Notification[]>([]);

  const push = useCallback((title: string, body: string, type: "info" | "warning" | "error" = "info") => {
    const n: Notification = { id: nextId++, title, body, type, timestamp: Date.now(), read: false };
    setNotifications((prev) => [n, ...prev].slice(0, 50));
    setToasts((prev) => [n, ...prev].slice(0, 3));
    // Auto-dismiss toast after 5s
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== n.id)), 5000);
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Poll engine /api/monitor every 30s for alerts
  useEffect(() => {
    if (!engineUrl || !apiKey) return;
    const check = async () => {
      try {
        const res = await fetch(`${engineUrl}/api/sessions/current`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return;
        const session = await res.json();
        // Alert: session stuck in heartbeat > 2 minutes
        if (session.state && !["active", "closing_a", "closing_b", "completed"].includes(session.state)) {
          const started = new Date(session.started_at.replace(" ", "T")).getTime();
          const age = (Date.now() - started) / 60000;
          if (age > 2) {
            push(
              "Session stuck",
              `Session ${session.number} is in state "${session.state}" for ${Math.round(age)} min`,
              "warning"
            );
          }
        }
      } catch { /* engine down, ignore */ }

      try {
        const res = await fetch(`${engineUrl}/api/monitor`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        // Alert: cost budget > 80%
        if (data.costs?.budgetPercent > 80) {
          push(
            "Cost budget warning",
            `Token budget at ${data.costs.budgetPercent}%`,
            "warning"
          );
        }
        // Alert: subsystem crashed
        const crashed = data.subsystems?.filter((s: any) => s.status === "error");
        if (crashed?.length > 0) {
          push(
            "Subsystem error",
            `${crashed.map((s: any) => s.name).join(", ")} in error state`,
            "error"
          );
        }
      } catch { /* ignore */ }
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [engineUrl, apiKey, push]);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, push, markAllRead, dismiss }}>
      {children}
      {/* Toast overlay */}
      {toasts.length > 0 && (
        <div className="os-toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`os-toast os-toast-${t.type}`} onClick={() => dismiss(t.id)}>
              <div className="os-toast-title">{t.title}</div>
              <div className="os-toast-body">{t.body}</div>
            </div>
          ))}
        </div>
      )}
    </NotificationContext.Provider>
  );
}

/** Notification list panel — opens from system tray */
export function NotificationList({ onClose }: { onClose: () => void }) {
  const { notifications, markAllRead } = useNotifications();

  useEffect(() => {
    markAllRead();
  }, [markAllRead]);

  return (
    <div className="os-notification-list">
      <div className="os-notification-list-header">
        <span>Notifications</span>
        <button onClick={onClose} className="os-notification-close">✕</button>
      </div>
      {notifications.length === 0 ? (
        <div className="os-notification-empty">No notifications</div>
      ) : (
        <div className="os-notification-items">
          {notifications.slice(0, 20).map((n) => (
            <div key={n.id} className={`os-notification-item os-notification-${n.type}`}>
              <div className="os-notification-item-title">{n.title}</div>
              <div className="os-notification-item-body">{n.body}</div>
              <div className="os-notification-item-time">
                {new Date(n.timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
