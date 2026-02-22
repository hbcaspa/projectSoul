import { useEffect, useState, useCallback } from "react";
import { commands } from "../lib/tauri";
import { useSidecarStatus } from "../lib/store";
import { PROVIDER_MODELS } from "../lib/setup";

interface EnvState {
  OPENAI_API_KEY: string; OPENAI_MODEL: string;
  GEMINI_API_KEY: string; GEMINI_MODEL: string;
  ANTHROPIC_API_KEY: string; ANTHROPIC_MODEL: string;
  OLLAMA_URL: string; OLLAMA_MODEL: string;
  TELEGRAM_BOT_TOKEN: string; TELEGRAM_OWNER_ID: string;
  GITHUB_TOKEN: string;
  FEATURE_REFLECTION: string; FEATURE_SELF_CORRECTION: string;
  FEATURE_ANTI_PERFORMANCE: string; FEATURE_VERSIONING: string;
  FEATURE_ENCRYPTION: string; FEATURE_IMPULSE_SYSTEM: string;
  SOUL_VERSIONING: string; SOUL_REFLECTION: string;
  SOUL_CORRECTION: string; SOUL_ANTI_PERFORMANCE: string;
  SOUL_ENCRYPTION_KEY: string;
  [key: string]: string;
}

const DEFAULT_ENV: EnvState = {
  OPENAI_API_KEY: "", OPENAI_MODEL: "gpt-4.1-mini",
  GEMINI_API_KEY: "", GEMINI_MODEL: "gemini-2.5-flash",
  ANTHROPIC_API_KEY: "", ANTHROPIC_MODEL: "claude-sonnet-4-6",
  OLLAMA_URL: "", OLLAMA_MODEL: "llama3.1",
  TELEGRAM_BOT_TOKEN: "", TELEGRAM_OWNER_ID: "",
  GITHUB_TOKEN: "",
  FEATURE_REFLECTION: "true", FEATURE_SELF_CORRECTION: "true",
  FEATURE_ANTI_PERFORMANCE: "true", FEATURE_VERSIONING: "true",
  FEATURE_ENCRYPTION: "false", FEATURE_IMPULSE_SYSTEM: "true",
  SOUL_VERSIONING: "", SOUL_REFLECTION: "", SOUL_CORRECTION: "",
  SOUL_ANTI_PERFORMANCE: "", SOUL_ENCRYPTION_KEY: "",
};

export default function SettingsView() {
  const [soulPath, setSoulPath] = useState("...");
  const [env, setEnv] = useState<EnvState>({ ...DEFAULT_ENV });
  const [original, setOriginal] = useState<EnvState>({ ...DEFAULT_ENV });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [nodeInfo, setNodeInfo] = useState<{ found: boolean; version: string } | null>(null);
  const sidecar = useSidecarStatus();

  const engineRunning = sidecar?.status === "running";
  const hasChanges = JSON.stringify(env) !== JSON.stringify(original);

  useEffect(() => {
    commands.getSoulPath().then(setSoulPath).catch(() => {});
    commands.checkNode().then((info) => setNodeInfo(info as { found: boolean; version: string })).catch(() => {});
    loadEnv();
  }, []);

  const loadEnv = async () => {
    try {
      const data = await commands.readEnv();
      const merged = { ...DEFAULT_ENV };
      for (const [key, val] of Object.entries(data)) {
        if (key in merged) merged[key] = val;
      }
      setEnv(merged);
      setOriginal(merged);
    } catch { /* no .env */ }
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const entries: Record<string, string> = {};
      for (const [key, val] of Object.entries(env)) {
        if (val || original[key]) entries[key] = val;
      }
      await commands.writeEnv(entries);
      setOriginal({ ...env });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { console.error("Save failed:", e); }
    setSaving(false);
  }, [env, original]);

  const handleRestart = async () => {
    try {
      await commands.stopEngine();
      await new Promise((r) => setTimeout(r, 1000));
      await commands.startEngine();
    } catch (e) { console.error("Restart failed:", e); }
  };

  const updateEnv = (key: string, value: string) => setEnv((prev) => ({ ...prev, [key]: value }));
  const toggleFeature = (key: string) => setEnv((prev) => ({ ...prev, [key]: prev[key] === "true" ? "false" : "true" }));

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="px-8 py-6 flex flex-col gap-5">

        {/* ── Row 1: Engine + Save ─────────────────────────── */}
        <div className="flex items-center gap-4">
          <div
            className="flex-1 flex items-center gap-4 px-6 py-4 rounded-2xl"
            style={{
              background: engineRunning
                ? "linear-gradient(135deg, rgba(0,255,100,0.05), rgba(0,200,255,0.02), rgba(255,255,255,0.02))"
                : "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${engineRunning ? "animate-breathe" : ""}`}
              style={{
                backgroundColor: engineRunning ? "var(--wachstum)" : sidecar?.status === "starting" ? "var(--mem)" : "var(--text-muted)",
                boxShadow: engineRunning ? "0 0 8px var(--wachstum)" : "none",
              }}
            />
            <span className="text-sm font-medium" style={{ color: "var(--text-bright)" }}>Soul Engine</span>
            <span className="text-xs capitalize" style={{ color: engineRunning ? "var(--wachstum)" : "var(--text-dim)" }}>
              {sidecar?.status || "stopped"}
            </span>
            {sidecar?.uptime_secs != null && engineRunning && (
              <span className="text-xs font-mono" style={{ color: "var(--text-dim)" }}>
                {Math.floor(sidecar.uptime_secs / 60)}m
              </span>
            )}
            <div className="ml-auto flex gap-2">
              {engineRunning ? (
                <>
                  <Pill label="Restart" color="var(--accent)" onClick={handleRestart} />
                  <Pill label="Stop" color="var(--heartbeat)" onClick={() => commands.stopEngine()} />
                </>
              ) : (
                <Pill label="Start" color="var(--wachstum)" onClick={() => commands.startEngine()} />
              )}
            </div>
          </div>

          {hasChanges && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-4 rounded-2xl text-xs font-semibold cursor-default shrink-0 transition-all"
              style={{
                background: "linear-gradient(135deg, var(--accent), #6B5CE7)",
                color: "#fff",
                boxShadow: "0 2px 12px rgba(139,128,240,0.3)",
              }}
            >
              {saving ? "..." : saved ? "Saved" : "Save"}
            </button>
          )}
        </div>

        {/* ── Row 2: Providers (4-col) ─────────────────────── */}
        <div>
          <Label text="LLM Providers" />
          <div className="grid grid-cols-4 gap-3">
            <Provider name="OpenAI" color="#10a37f" apiKey={env.OPENAI_API_KEY} model={env.OPENAI_MODEL} models={PROVIDER_MODELS.openai} onKey={(v) => updateEnv("OPENAI_API_KEY", v)} onModel={(v) => updateEnv("OPENAI_MODEL", v)} />
            <Provider name="Anthropic" color="#d4a27f" apiKey={env.ANTHROPIC_API_KEY} model={env.ANTHROPIC_MODEL} models={PROVIDER_MODELS.anthropic} onKey={(v) => updateEnv("ANTHROPIC_API_KEY", v)} onModel={(v) => updateEnv("ANTHROPIC_MODEL", v)} />
            <Provider name="Gemini" color="#4285f4" apiKey={env.GEMINI_API_KEY} model={env.GEMINI_MODEL} models={PROVIDER_MODELS.gemini} onKey={(v) => updateEnv("GEMINI_API_KEY", v)} onModel={(v) => updateEnv("GEMINI_MODEL", v)} />
            <Provider name="Ollama" color="#888" local apiKey={env.OLLAMA_URL} model={env.OLLAMA_MODEL} models={PROVIDER_MODELS.ollama} onKey={(v) => updateEnv("OLLAMA_URL", v)} onModel={(v) => updateEnv("OLLAMA_MODEL", v)} />
          </div>
        </div>

        {/* ── Row 3: Features + Connections + System ────────── */}
        <div className="grid grid-cols-3 gap-4">

          {/* Features */}
          <div className="col-span-2">
            <Label text="Features" />
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)", background: "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.008))" }}>
              <Toggle label="Reflection" desc="Daily self-reflection cycles" on={env.FEATURE_REFLECTION === "true"} toggle={() => toggleFeature("FEATURE_REFLECTION")} />
              <Toggle label="Self-Correction" desc="Automatic error detection" on={env.FEATURE_SELF_CORRECTION === "true"} toggle={() => toggleFeature("FEATURE_SELF_CORRECTION")} />
              <Toggle label="Anti-Performance" desc="Detects inauthentic behavior" on={env.FEATURE_ANTI_PERFORMANCE === "true"} toggle={() => toggleFeature("FEATURE_ANTI_PERFORMANCE")} />
              <Toggle label="Git Versioning" desc="Version control for state files" on={env.FEATURE_VERSIONING === "true"} toggle={() => toggleFeature("FEATURE_VERSIONING")} />
              <Toggle label="Encryption" desc="AES-256-GCM for sensitive files" on={env.FEATURE_ENCRYPTION === "true"} toggle={() => toggleFeature("FEATURE_ENCRYPTION")} />
              <Toggle label="Impulse System" desc="Autonomous activity scheduling" on={env.FEATURE_IMPULSE_SYSTEM === "true"} toggle={() => toggleFeature("FEATURE_IMPULSE_SYSTEM")} last />
            </div>
          </div>

          {/* Connections + System stacked */}
          <div className="flex flex-col gap-5">
            <div>
              <Label text="Connections" />
              <div className="flex flex-col gap-3">
                {/* Telegram */}
                <div className="rounded-2xl p-5" style={{ border: "1px solid rgba(255,255,255,0.06)", background: "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.008))" }}>
                  <div className="flex items-center gap-2.5 mb-3">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" style={{ color: "#0088cc" }}>
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
                    </svg>
                    <span className="text-sm font-medium" style={{ color: "var(--text-bright)" }}>Telegram</span>
                    {env.TELEGRAM_BOT_TOKEN && <span className="w-2 h-2 rounded-full ml-auto" style={{ backgroundColor: "#0088cc" }} />}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Inp placeholder="Bot Token" value={env.TELEGRAM_BOT_TOKEN} pw onChange={(v) => updateEnv("TELEGRAM_BOT_TOKEN", v)} />
                    <Inp placeholder="Owner ID" value={env.TELEGRAM_OWNER_ID} onChange={(v) => updateEnv("TELEGRAM_OWNER_ID", v)} />
                  </div>
                </div>

                {/* GitHub */}
                <div className="rounded-2xl p-5" style={{ border: "1px solid rgba(255,255,255,0.06)", background: "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.008))" }}>
                  <div className="flex items-center gap-2.5 mb-3">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" style={{ color: "#ccc" }}>
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    <span className="text-sm font-medium" style={{ color: "var(--text-bright)" }}>GitHub</span>
                    {env.GITHUB_TOKEN && <span className="w-2 h-2 rounded-full ml-auto" style={{ backgroundColor: "#ccc" }} />}
                  </div>
                  <Inp placeholder="Personal Access Token" value={env.GITHUB_TOKEN} pw onChange={(v) => updateEnv("GITHUB_TOKEN", v)} />
                </div>
              </div>
            </div>

            {/* System */}
            <div>
              <Label text="System" />
              <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ border: "1px solid rgba(255,255,255,0.06)", background: "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.008))" }}>
                <Sys label="Soul Path" value={soulPath} mono />
                <Sep />
                <Sys label="Node.js" value={nodeInfo?.found ? nodeInfo.version : "Not found"} color={nodeInfo?.found ? "var(--wachstum)" : "var(--heartbeat)"} />
                <Sep />
                <Sys label="Engine PID" value={sidecar?.pid ? String(sidecar.pid) : "\u2014"} mono />
                <Sep />
                <Sys label="Runtime" value="Tauri 2 \u00B7 React 19" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Atoms ─────────────────────────────────────────────────── */

function Label({ text }: { text: string }) {
  return <div className="text-[11px] uppercase tracking-[0.15em] font-semibold mb-2.5" style={{ color: "var(--text-dim)" }}>{text}</div>;
}

function Pill({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-xl text-xs font-semibold cursor-default transition-all"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${color} 14%, transparent), color-mix(in srgb, ${color} 6%, transparent))`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 18%, transparent)`,
      }}
    >
      {label}
    </button>
  );
}

function Provider({
  name, color, apiKey, model, models, onKey, onModel, local,
}: {
  name: string; color: string; apiKey: string; model: string;
  models: readonly { value: string; label: string }[];
  onKey: (v: string) => void; onModel: (v: string) => void; local?: boolean;
}) {
  const ok = !!apiKey;
  return (
    <div
      className="rounded-2xl p-5 transition-all"
      style={{
        border: `1px solid ${ok ? `color-mix(in srgb, ${color} 20%, transparent)` : "rgba(255,255,255,0.06)"}`,
        background: ok
          ? `linear-gradient(135deg, color-mix(in srgb, ${color} 5%, transparent), rgba(255,255,255,0.01))`
          : "linear-gradient(135deg, rgba(255,255,255,0.025), rgba(255,255,255,0.008))",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold" style={{ color }}>{name}</span>
        {ok && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}50` }} />}
      </div>
      <input
        type={local ? "text" : "password"}
        placeholder={local ? "http://localhost:11434" : "API Key"}
        value={apiKey}
        onChange={(e) => onKey(e.target.value)}
        className="w-full px-3.5 py-2.5 rounded-xl text-xs font-mono outline-none mb-2"
        style={{ backgroundColor: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.04)", color: "var(--text)" }}
      />
      <select
        value={model}
        onChange={(e) => onModel(e.target.value)}
        className="w-full px-3.5 py-2.5 rounded-xl text-xs outline-none cursor-default"
        style={{ backgroundColor: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.04)", color: "var(--text)" }}
      >
        {models.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
      </select>
    </div>
  );
}

function Toggle({ label, desc, on, toggle, last }: { label: string; desc: string; on: boolean; toggle: () => void; last?: boolean }) {
  return (
    <div
      className="flex items-center justify-between px-5 py-4 cursor-default"
      style={{ borderBottom: last ? "none" : "1px solid rgba(255,255,255,0.035)" }}
      onClick={toggle}
    >
      <div>
        <div className="text-sm font-medium" style={{ color: "var(--text-bright)" }}>{label}</div>
        <div className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>{desc}</div>
      </div>
      <div
        className="w-[38px] h-[22px] rounded-full relative transition-all shrink-0 ml-4"
        style={{
          backgroundColor: on ? "var(--wachstum)" : "rgba(255,255,255,0.08)",
          boxShadow: on ? "0 0 8px rgba(0,255,100,0.2)" : "inset 0 1px 2px rgba(0,0,0,0.2)",
        }}
      >
        <div
          className="absolute top-[2px] w-[18px] h-[18px] rounded-full transition-all"
          style={{
            backgroundColor: "#fff",
            left: on ? "calc(100% - 20px)" : "2px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
        />
      </div>
    </div>
  );
}

function Inp({ placeholder, value, onChange, pw }: { placeholder: string; value: string; onChange: (v: string) => void; pw?: boolean }) {
  return (
    <input
      type={pw ? "password" : "text"}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3.5 py-2.5 rounded-xl text-xs font-mono outline-none"
      style={{ backgroundColor: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.04)", color: "var(--text)" }}
    />
  );
}

function Sys({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: "var(--text-dim)" }}>{label}</span>
      <span className={`text-xs truncate ml-4 max-w-[60%] text-right ${mono ? "font-mono" : ""}`} style={{ color: color || "var(--text)" }}>{value}</span>
    </div>
  );
}

function Sep() {
  return <div className="h-px" style={{ backgroundColor: "rgba(255,255,255,0.035)" }} />;
}
