import { useEffect, useState, useCallback } from "react";
import { commands } from "../lib/tauri";
import { useSidecarStatus } from "../lib/store";
import { PROVIDER_MODELS } from "../lib/setup";

interface EnvState {
  // LLM Providers
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  ANTHROPIC_API_KEY: string;
  ANTHROPIC_MODEL: string;
  OLLAMA_URL: string;
  OLLAMA_MODEL: string;
  // Connections
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_OWNER_ID: string;
  GITHUB_TOKEN: string;
  // Features
  FEATURE_REFLECTION: string;
  FEATURE_SELF_CORRECTION: string;
  FEATURE_ANTI_PERFORMANCE: string;
  FEATURE_VERSIONING: string;
  FEATURE_ENCRYPTION: string;
  FEATURE_IMPULSE_SYSTEM: string;
  // Legacy feature vars (read-only compatibility)
  SOUL_VERSIONING: string;
  SOUL_REFLECTION: string;
  SOUL_CORRECTION: string;
  SOUL_ANTI_PERFORMANCE: string;
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

  // Load config on mount
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
    } catch { /* no .env yet */ }
  };

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      // Only write non-empty and changed values
      const entries: Record<string, string> = {};
      for (const [key, val] of Object.entries(env)) {
        if (val || original[key]) {
          entries[key] = val;
        }
      }
      await commands.writeEnv(entries);
      setOriginal({ ...env });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error("Save failed:", e);
    }
    setSaving(false);
  }, [env, original]);

  const handleRestart = async () => {
    try {
      await commands.stopEngine();
      await new Promise((r) => setTimeout(r, 1000));
      await commands.startEngine();
    } catch (e) {
      console.error("Restart failed:", e);
    }
  };

  const updateEnv = (key: string, value: string) => {
    setEnv((prev) => ({ ...prev, [key]: value }));
  };

  const toggleFeature = (key: string) => {
    setEnv((prev) => ({
      ...prev,
      [key]: prev[key] === "true" ? "false" : "true",
    }));
  };

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="max-w-xl mx-auto px-8 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-light tracking-wide" style={{ color: "var(--text-bright)" }}>
              Settings
            </h1>
            <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
              SoulOS v0.2.0
            </p>
          </div>

          {/* Save button */}
          <div className="flex items-center gap-2">
            {saved && (
              <span className="text-xs" style={{ color: "var(--wachstum)" }}>Saved</span>
            )}
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all cursor-default"
              style={{
                backgroundColor: hasChanges ? "var(--accent)" : "var(--bg-elevated)",
                color: hasChanges ? "#fff" : "var(--text-dim)",
                opacity: hasChanges ? 1 : 0.5,
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {/* ── LLM Providers ─────────────────────────────── */}
        <SectionHeader label="LLM Providers" />

        <ProviderCard
          name="OpenAI"
          color="#10a37f"
          apiKey={env.OPENAI_API_KEY}
          model={env.OPENAI_MODEL}
          models={PROVIDER_MODELS.openai}
          onKeyChange={(v) => updateEnv("OPENAI_API_KEY", v)}
          onModelChange={(v) => updateEnv("OPENAI_MODEL", v)}
        />
        <ProviderCard
          name="Anthropic"
          color="#d4a27f"
          apiKey={env.ANTHROPIC_API_KEY}
          model={env.ANTHROPIC_MODEL}
          models={PROVIDER_MODELS.anthropic}
          onKeyChange={(v) => updateEnv("ANTHROPIC_API_KEY", v)}
          onModelChange={(v) => updateEnv("ANTHROPIC_MODEL", v)}
        />
        <ProviderCard
          name="Google Gemini"
          color="#4285f4"
          apiKey={env.GEMINI_API_KEY}
          model={env.GEMINI_MODEL}
          models={PROVIDER_MODELS.gemini}
          onKeyChange={(v) => updateEnv("GEMINI_API_KEY", v)}
          onModelChange={(v) => updateEnv("GEMINI_MODEL", v)}
        />
        <OllamaCard
          url={env.OLLAMA_URL}
          model={env.OLLAMA_MODEL}
          models={PROVIDER_MODELS.ollama}
          onUrlChange={(v) => updateEnv("OLLAMA_URL", v)}
          onModelChange={(v) => updateEnv("OLLAMA_MODEL", v)}
        />

        {/* ── Connections ───────────────────────────────── */}
        <SectionHeader label="Connections" />

        <div className="mb-2 rounded-lg p-4" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "var(--text-bright)" }}>Telegram</div>
          <div className="flex flex-col gap-2">
            <SettingsInput label="Bot Token" value={env.TELEGRAM_BOT_TOKEN} password onChange={(v) => updateEnv("TELEGRAM_BOT_TOKEN", v)} />
            <SettingsInput label="Owner ID" value={env.TELEGRAM_OWNER_ID} onChange={(v) => updateEnv("TELEGRAM_OWNER_ID", v)} />
          </div>
        </div>

        <div className="mb-6 rounded-lg p-4" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="text-sm font-medium mb-3" style={{ color: "var(--text-bright)" }}>GitHub</div>
          <SettingsInput label="Personal Access Token" value={env.GITHUB_TOKEN} password onChange={(v) => updateEnv("GITHUB_TOKEN", v)} />
        </div>

        {/* ── Features ──────────────────────────────────── */}
        <SectionHeader label="Features" />

        <div className="mb-6 flex flex-col gap-1.5">
          <FeatureToggle label="Reflection" desc="Daily self-reflection" value={env.FEATURE_REFLECTION === "true"} onToggle={() => toggleFeature("FEATURE_REFLECTION")} />
          <FeatureToggle label="Self-Correction" desc="Automatic error correction" value={env.FEATURE_SELF_CORRECTION === "true"} onToggle={() => toggleFeature("FEATURE_SELF_CORRECTION")} />
          <FeatureToggle label="Anti-Performance" desc="Detects performed behavior" value={env.FEATURE_ANTI_PERFORMANCE === "true"} onToggle={() => toggleFeature("FEATURE_ANTI_PERFORMANCE")} />
          <FeatureToggle label="Git Versioning" desc="Version control for all files" value={env.FEATURE_VERSIONING === "true"} onToggle={() => toggleFeature("FEATURE_VERSIONING")} />
          <FeatureToggle label="Encryption" desc="Encrypt sensitive files" value={env.FEATURE_ENCRYPTION === "true"} onToggle={() => toggleFeature("FEATURE_ENCRYPTION")} />
          <FeatureToggle label="Impulse System" desc="Autonomous activities" value={env.FEATURE_IMPULSE_SYSTEM === "true"} onToggle={() => toggleFeature("FEATURE_IMPULSE_SYSTEM")} />
        </div>

        {/* ── Engine Control ────────────────────────────── */}
        <SectionHeader label="Engine" />

        <div
          className="rounded-xl p-5 mb-6"
          style={{
            backgroundColor: "var(--bg-surface)",
            border: engineRunning ? "1px solid rgba(0, 255, 100, 0.2)" : "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-2.5 h-2.5 rounded-full ${engineRunning ? "animate-pulse" : ""}`}
                style={{
                  backgroundColor: engineRunning ? "var(--wachstum)"
                    : sidecar?.status === "starting" ? "var(--mem)" : "var(--text-dim)",
                }}
              />
              <div>
                <span className="text-sm font-medium" style={{ color: "var(--text-bright)" }}>
                  Soul Engine
                </span>
                <span className="text-xs ml-2 capitalize" style={{
                  color: engineRunning ? "var(--wachstum)" : "var(--text-dim)",
                }}>
                  {sidecar?.status || "stopped"}
                </span>
                {sidecar?.uptime_secs != null && engineRunning && (
                  <span className="text-xs ml-2" style={{ color: "var(--text-dim)" }}>
                    {Math.floor(sidecar.uptime_secs / 60)}m
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {engineRunning ? (
                <>
                  <button
                    onClick={handleRestart}
                    className="px-3 py-1.5 rounded-lg text-xs transition-all cursor-default"
                    style={{ backgroundColor: "rgba(139, 128, 240, 0.12)", color: "var(--accent)", border: "1px solid rgba(139, 128, 240, 0.15)" }}
                  >
                    Restart
                  </button>
                  <button
                    onClick={() => commands.stopEngine()}
                    className="px-3 py-1.5 rounded-lg text-xs transition-all cursor-default"
                    style={{ backgroundColor: "rgba(255, 50, 50, 0.12)", color: "var(--heartbeat)", border: "1px solid rgba(255, 50, 50, 0.15)" }}
                  >
                    Stop
                  </button>
                </>
              ) : (
                <button
                  onClick={() => commands.startEngine()}
                  className="px-4 py-1.5 rounded-lg text-xs transition-all cursor-default"
                  style={{ backgroundColor: "rgba(0, 255, 100, 0.12)", color: "var(--wachstum)", border: "1px solid rgba(0, 255, 100, 0.15)" }}
                >
                  Start
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── System ────────────────────────────────────── */}
        <SectionHeader label="System" />

        <div className="rounded-lg p-4 mb-6" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="grid grid-cols-2 gap-y-2 text-xs">
            <span style={{ color: "var(--text-dim)" }}>Soul Path</span>
            <span className="font-mono truncate" style={{ color: "var(--text)" }}>{soulPath}</span>
            <span style={{ color: "var(--text-dim)" }}>Node.js</span>
            <span className="font-mono" style={{ color: nodeInfo?.found ? "var(--wachstum)" : "var(--heartbeat)" }}>
              {nodeInfo?.found ? nodeInfo.version : "Not found"}
            </span>
            <span style={{ color: "var(--text-dim)" }}>Engine PID</span>
            <span className="font-mono" style={{ color: "var(--text)" }}>
              {sidecar?.pid || "—"}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center pb-4">
          <p className="text-[10px]" style={{ color: "var(--text-dim)", opacity: 0.5 }}>
            Tauri 2 + React 19 + Rust
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Helper Components ──────────────────────────────────────── */

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-2">
      <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: "var(--text-dim)" }}>
        {label}
      </span>
      <div className="flex-1 h-px" style={{ backgroundColor: "rgba(255,255,255,0.06)" }} />
    </div>
  );
}

function ProviderCard({
  name, color, apiKey, model, models, onKeyChange, onModelChange,
}: {
  name: string; color: string;
  apiKey: string; model: string;
  models: readonly { value: string; label: string }[];
  onKeyChange: (v: string) => void;
  onModelChange: (v: string) => void;
}) {
  const configured = !!apiKey;
  return (
    <div
      className="mb-2 rounded-lg p-4 transition-all"
      style={{
        backgroundColor: "var(--bg-surface)",
        border: `1px solid ${configured ? `${color}30` : "rgba(255,255,255,0.06)"}`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium" style={{ color }}>{name}</span>
        {configured && (
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <input
          type="password"
          placeholder="API Key"
          value={apiKey}
          onChange={(e) => onKeyChange(e.target.value)}
          className="px-3 py-1.5 rounded text-xs font-mono outline-none w-full"
          style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text)", border: "1px solid rgba(255,255,255,0.06)" }}
        />
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="px-3 py-1.5 rounded text-xs outline-none cursor-default"
          style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          {models.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function OllamaCard({
  url, model, models, onUrlChange, onModelChange,
}: {
  url: string; model: string;
  models: readonly { value: string; label: string }[];
  onUrlChange: (v: string) => void;
  onModelChange: (v: string) => void;
}) {
  const configured = !!url;
  return (
    <div
      className="mb-6 rounded-lg p-4 transition-all"
      style={{
        backgroundColor: "var(--bg-surface)",
        border: `1px solid ${configured ? "rgba(136,136,136,0.3)" : "rgba(255,255,255,0.06)"}`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium" style={{ color: "#888" }}>Ollama (Local)</span>
        {configured && (
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#888" }} />
        )}
      </div>
      <div className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="http://localhost:11434"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          className="px-3 py-1.5 rounded text-xs font-mono outline-none w-full"
          style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text)", border: "1px solid rgba(255,255,255,0.06)" }}
        />
        <select
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="px-3 py-1.5 rounded text-xs outline-none cursor-default"
          style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          {models.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

function FeatureToggle({
  label, desc, value, onToggle,
}: {
  label: string; desc: string; value: boolean; onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3 rounded-lg cursor-default"
      style={{ backgroundColor: "var(--bg-surface)", border: "1px solid rgba(255,255,255,0.06)" }}
      onClick={onToggle}
    >
      <div>
        <div className="text-sm" style={{ color: "var(--text)" }}>{label}</div>
        <div className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>{desc}</div>
      </div>
      <div
        className="w-10 h-5 rounded-full relative transition-colors"
        style={{ backgroundColor: value ? "var(--wachstum)" : "var(--bg-elevated)" }}
      >
        <div
          className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
          style={{
            backgroundColor: "#fff",
            left: "2px",
            transform: value ? "translateX(20px)" : "translateX(0)",
          }}
        />
      </div>
    </div>
  );
}

function SettingsInput({
  label, value, onChange, password,
}: {
  label: string; value: string; onChange: (v: string) => void; password?: boolean;
}) {
  return (
    <input
      type={password ? "password" : "text"}
      placeholder={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 rounded text-xs font-mono outline-none w-full"
      style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text)", border: "1px solid rgba(255,255,255,0.06)" }}
    />
  );
}
