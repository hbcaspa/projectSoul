import { useEffect, useState } from "react";
import { useSoul } from "./store";

// Pollt einen Endpunkt des aktiven Node. Re-fetch bei Node-Wechsel/Reload + Intervall.
export function usePoll<T = unknown>(path: string | null, intervalMs = 8000) {
  const { active, reloadTick } = useSoul();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!active || !path) return;
    let stop = false;
    let timer: number | undefined;
    const run = async () => {
      try {
        const d = await active.client.get<T>(path);
        if (stop) return;
        setData(d);
        setError("");
      } catch (e) {
        if (stop) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!stop) setLoading(false);
      }
      if (!stop) timer = setTimeout(run, intervalMs) as unknown as number;
    };
    setLoading(true);
    run();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [active?.node.id, path, intervalMs, reloadTick]);

  return { data, error, loading };
}
