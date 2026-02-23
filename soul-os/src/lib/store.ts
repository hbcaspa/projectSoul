import { useCallback, useEffect, useRef, useState } from "react";
import { commands, events, type SoulPulse, type SoulActivity, type SoulMood, type SoulStatus, type SidecarStatus } from "./tauri";
import { transform } from "./whisper-templates";

// --- Active Nodes (polled from Rust) ---

export function useActiveNodes(intervalMs = 200) {
  const [nodes, setNodes] = useState<Record<string, number>>({});
  const [isWorking, setIsWorking] = useState(false);

  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const [n, w] = await Promise.all([
          commands.getActiveNodes(),
          commands.getIsWorking(),
        ]);
        setNodes(n);
        setIsWorking(w);
      } catch {
        // Backend not ready yet
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return { nodes, isWorking };
}

// --- Soul Status ---

export function useSoulStatus() {
  const [status, setStatus] = useState<SoulStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await commands.getSoulStatus();
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, error, refresh };
}

// --- Activity Feed ---

export interface ActivityEntry {
  time: string;
  node: string;
  file: string;
  eventType: string;
  label: string;
}

export function useActivityFeed(maxEntries = 20) {
  const bufferRef = useRef<ActivityEntry[]>([]);
  const [feed, setFeed] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    let unsubFn: (() => void) | null = null;

    const unsub = events.onActivity((activity: SoulActivity) => {
      const time = new Date().toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const entry = { time, node: activity.node, file: activity.file, eventType: activity.event_type, label: activity.node };
      const buf = bufferRef.current;
      buf.unshift(entry);
      if (buf.length > maxEntries) buf.length = maxEntries;
      setFeed([...buf]);
    });

    unsub.then((fn) => { unsubFn = fn; });

    return () => {
      if (unsubFn) unsubFn();
      else unsub.then((fn) => fn());
    };
  }, [maxEntries]);

  return feed;
}

// --- Whisper Stream ---

export interface WhisperEntry {
  text: string;
  type: string;
  time: string;
}

export function useWhisperStream(maxEntries = 50) {
  const bufferRef = useRef<WhisperEntry[]>([]);
  const [stream, setStream] = useState<WhisperEntry[]>([]);

  useEffect(() => {
    let unsubFn: (() => void) | null = null;

    const unsub = events.onPulse((pulse: SoulPulse) => {
      const text = transform(pulse.activity_type, pulse.label);
      const time = new Date().toLocaleTimeString("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const buf = bufferRef.current;
      buf.unshift({ text, type: pulse.activity_type, time });
      if (buf.length > maxEntries) buf.length = maxEntries;
      setStream([...buf]);
    });

    unsub.then((fn) => { unsubFn = fn; });

    return () => {
      if (unsubFn) unsubFn();
      else unsub.then((fn) => fn());
    };
  }, [maxEntries]);

  return stream;
}

// --- Mood ---

export function useMood() {
  const [mood, setMood] = useState<SoulMood | null>(null);

  useEffect(() => {
    let unsubFn: (() => void) | null = null;
    const unsub = events.onMood((m: SoulMood) => setMood(m));
    unsub.then((fn) => { unsubFn = fn; });
    return () => {
      if (unsubFn) unsubFn();
      else unsub.then((fn) => fn());
    };
  }, []);

  return mood;
}

// --- Sidecar Status ---

export function useSidecarStatus() {
  const [status, setStatus] = useState<SidecarStatus | null>(null);

  useEffect(() => {
    // Initial fetch
    commands.getSidecarStatus().then(setStatus).catch(() => {});

    // Listen for updates
    let unsubFn: (() => void) | null = null;
    const unsub = events.onSidecarStatus((s: SidecarStatus) => setStatus(s));
    unsub.then((fn) => { unsubFn = fn; });
    return () => {
      if (unsubFn) unsubFn();
      else unsub.then((fn) => fn());
    };
  }, []);

  return status;
}

// --- Current Pulse (latest action) ---

export function useCurrentPulse() {
  const [pulse, setPulse] = useState<SoulPulse | null>(null);

  useEffect(() => {
    let unsubFn: (() => void) | null = null;
    const unsub = events.onPulse((p: SoulPulse) => setPulse(p));
    unsub.then((fn) => { unsubFn = fn; });
    return () => {
      if (unsubFn) unsubFn();
      else unsub.then((fn) => fn());
    };
  }, []);

  return pulse;
}

// --- Animation tick (for Canvas rendering) ---

export function useAnimationTick(fps = 30) {
  const tickRef = useRef(0);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const interval = 1000 / fps;
    let lastTime = 0;
    let animId: number;

    const loop_ = (time: number) => {
      animId = requestAnimationFrame(loop_);
      if (time - lastTime < interval) return;
      lastTime = time;
      tickRef.current += 0.15; // Match soul-monitor tick increment
      forceUpdate((n) => n + 1);
    };

    animId = requestAnimationFrame(loop_);
    return () => cancelAnimationFrame(animId);
  }, [fps]);

  return tickRef.current;
}
