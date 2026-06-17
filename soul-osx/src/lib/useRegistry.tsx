// Modul-Registry-Layer für die Control-Plane.
//
// Lädt /api/modules/registry vom aktiven Node (echter Laufzeit-Status + Steuerbarkeit
// aus der Engine) und merged ihn mit dem manifest.ts (endpoint, events, Region-Zuordnung).
// Liefert control(id, action) das POST /api/modules/:id/control feuert, mit optimistic UI.
//
// EINZIGE Wahrheitsquelle als Context: ControlPlane, CommandPalette und Inspector teilen
// sich denselben Registry-Zustand (eine Poll-Schleife, geteiltes busy/optimistic).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSoul } from "./store";
import { EngineError } from "./engine";
import { MODULES, REGIONS, type ModuleDef, type RegionDef } from "./manifest";

export type ControlKind =
  | "runtime"
  | "env"
  | "action"
  | "readonly"
  | "critical_locked";

export type ControlAction = "enable" | "disable" | "trigger";

// Roh aus der Engine
export interface RegistryEntry {
  id: string;
  name: string;
  group: string; // == RegionDef.id
  enabled: boolean | null;
  control: ControlKind;
  available: boolean;
  endpoint?: string;
  locked?: boolean;
}

// Voll angereicherter View-Datensatz für die UI
export interface ModuleView extends RegistryEntry {
  region: RegionDef; // aufgelöste Region (group → REGIONS)
  endpoint?: string; // bevorzugt Registry, sonst manifest
  events: string[]; // aus manifest
  def?: ModuleDef; // manifest-Definition (falls vorhanden)
  toggleable: boolean; // schaltbar via Switch (enable/disable möglich)
  triggerable: boolean; // hat eine auslösbare Aktion
}

export interface ControlResult {
  ok?: boolean;
  error?: string;
  note?: string;
  atUse?: boolean;
  available?: boolean;
  method?: string;
  action?: string;
  id?: string;
  control?: string;
}

const REGION_BY_ID = new Map(REGIONS.map((r) => [r.id, r]));
const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));
// Fallback-Region, falls die Engine eine unbekannte group liefert.
const FALLBACK_REGION: RegionDef = {
  id: "infra",
  name: "Sonstige",
  color: "var(--color-ash)",
  blurb: "",
};

function enrich(e: RegistryEntry): ModuleView {
  const def = MODULE_BY_ID.get(e.id);
  const region = REGION_BY_ID.get(e.group) || REGION_BY_ID.get(def?.region ?? "") || FALLBACK_REGION;
  const toggleable = e.control === "runtime" || e.control === "env";
  const triggerable = e.control === "action";
  return {
    ...e,
    region,
    endpoint: e.endpoint || def?.endpoint,
    events: def?.events ?? [],
    def,
    toggleable,
    triggerable,
  };
}

interface RegistryState {
  modules: ModuleView[];
  loading: boolean;
  error: string;
  unsupported: boolean; // Engine kennt /api/modules/registry nicht (404)
  /** Modul-ID, das gerade eine Control-Operation ausführt (für Spinner/Disable). */
  busyId: string | null;
  refetch: () => void;
  /** Optimistisch + busy setzen und die Operation feuern. Eine Anlaufstelle für alle. */
  control: (id: string, action: ControlAction) => Promise<ControlResult>;
  /** Letzte Control-Antwort (für Toasts/Feedback). */
  lastResult: { id: string; result: ControlResult } | null;
}

const Ctx = createContext<RegistryState | null>(null);

function useRegistryState(): RegistryState {
  const { active, reloadTick } = useSoul();
  const [raw, setRaw] = useState<RegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unsupported, setUnsupported] = useState(false);
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ id: string; result: ControlResult } | null>(null);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!active) return;
    let stop = false;
    let timer: number | undefined;
    const run = async () => {
      try {
        const r = await active.client.get<{ modules: RegistryEntry[] }>("/api/modules/registry");
        if (stop) return;
        setRaw(Array.isArray(r?.modules) ? r.modules : []);
        setError("");
        setUnsupported(false);
      } catch (e) {
        if (stop) return;
        const err = e as EngineError;
        if (err.status === 404) setUnsupported(true);
        setError(err.message || String(e));
      } finally {
        if (!stop) setLoading(false);
      }
      // Sanftes Re-Poll alle 10s, hält den Live-Status frisch.
      if (!stop) timer = setTimeout(run, 10000) as unknown as number;
    };
    setLoading(true);
    run();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [active?.node.id, reloadTick, tick]);

  const control = useCallback(
    async (id: string, action: ControlAction): Promise<ControlResult> => {
      if (!active) return { error: "kein aktiver Node" };
      setBusyId(id);
      // Optimistic UI — nur bei echten Toggles, nicht bei trigger (kein an/aus-Zustand).
      if (action === "enable") setRaw((p) => p.map((m) => (m.id === id ? { ...m, enabled: true } : m)));
      if (action === "disable") setRaw((p) => p.map((m) => (m.id === id ? { ...m, enabled: false } : m)));
      try {
        const res = await active.client.post<ControlResult>(`/api/modules/${id}/control`, { action });
        const result = typeof res === "object" && res ? res : ({ ok: true } as ControlResult);
        setLastResult({ id, result });
        // Echten Status nachladen (auch bei atUse:false wichtig).
        setTimeout(refetch, 350);
        return result;
      } catch (e) {
        const err = e as EngineError;
        // Engine liefert strukturierte 4xx-Bodies; versuche JSON zu extrahieren.
        let parsed: ControlResult = { error: err.message };
        const m = err.message.match(/\{[\s\S]*\}$/);
        if (m) {
          try {
            parsed = JSON.parse(m[0]);
          } catch {
            /* keep raw */
          }
        }
        setLastResult({ id, result: parsed });
        // Optimistic zurückdrehen → echten Status neu holen.
        setTimeout(refetch, 200);
        return parsed;
      } finally {
        setBusyId((b) => (b === id ? null : b));
      }
    },
    [active, refetch]
  );

  const modules = useMemo(() => raw.map(enrich), [raw]);

  return useMemo(
    () => ({ modules, loading, error, unsupported, busyId, refetch, control, lastResult }),
    [modules, loading, error, unsupported, busyId, refetch, control, lastResult]
  );
}

export function RegistryProvider({ children }: { children: ReactNode }) {
  const state = useRegistryState();
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useRegistry(): RegistryState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRegistry must be used within RegistryProvider");
  return c;
}
