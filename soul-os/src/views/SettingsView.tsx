import { useEffect, useState, useCallback } from "react";
import { commands } from "../lib/tauri";
import { useSidecarStatus } from "../lib/store";
import { PROVIDER_MODELS } from "../lib/setup";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

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
  const [appVersion, setAppVersion] = useState("...");
  const [updateStatus, setUpdateStatus] = useState<"idle" | "checking" | "available" | "downloading" | "done" | "error">("idle");
  const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const engineRunning = sidecar?.status === "running";
  const hasChanges = JSON.stringify(env) !== JSON.stringify(original);

  useEffect(() => {
    commands.getSoulPath().then(setSoulPath).catch(() => {});
    commands.checkNode().then((info) => setNodeInfo(info as { found: boolean; version: string })).catch(() => {});
    getVersion().then(setAppVersion).catch(() => {});
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

  const handleCheckUpdate = useCallback(async () => {
    setUpdateStatus("checking");
    setUpdateError(null);
    try {
      const update = await check();
      if (update?.available) {
        setUpdateInfo(update);
        setUpdateStatus("available");
      } else {
        setUpdateStatus("idle");
      }
    } catch (e) {
      setUpdateError(String(e));
      setUpdateStatus("error");
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    if (!updateInfo) return;
    setUpdateStatus("downloading");
    setDownloadProgress(0);
    try {
      let totalBytes = 0;
      let downloadedBytes = 0;
      await updateInfo.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalBytes = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setDownloadProgress(Math.round((downloadedBytes / totalBytes) * 100));
          }
        } else if (event.event === "Finished") {
          setDownloadProgress(100);
        }
      });
      setUpdateStatus("done");
      setTimeout(() => relaunch(), 1500);
    } catch (e) {
      setUpdateError(String(e));
      setUpdateStatus("error");
    }
  }, [updateInfo]);

  const updateEnv = (key: string, value: string) => setEnv((prev) => ({ ...prev, [key]: value }));
  const toggleFeature = (key: string) => setEnv((prev) => ({ ...prev, [key]: prev[key] === "true" ? "false" : "true" }));

  return (
    <div className="h-full overflow-auto neon-scanlines" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="px-8 py-6 flex flex-col gap-5">

        {/* ── Title ──────────────────────────────────────────── */}
        <div className="text-center">
          <h1 className="text-lg font-semibold neon-title">SETTINGS</h1>
        </div>

        {/* ── Row 1: Engine + Save ─────────────────────────── */}
        <div className="flex items-center gap-4">
          <div className="flex-1 flex items-center gap-4 px-6 py-4 neon-card">
            <div
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${engineRunning ? "animate-breathe" : ""}`}
              style={{
                backgroundColor: engineRunning ? "var(--wachstum)" : sidecar?.status === "starting" ? "var(--mem)" : "var(--text-muted)",
                boxShadow: engineRunning ? "0 0 12px var(--wachstum)" : "none",
              }}
            />
            <span className="text-sm font-medium" style={{ color: "var(--bewusstsein)" }}>Soul Engine</span>
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
                  <Pill label="Restart" color="#00FFC8" onClick={handleRestart} />
                  <Pill label="Stop" color="#FF3232" onClick={() => commands.stopEngine()} />
                </>
              ) : (
                <Pill label="Start" color="#00FF64" onClick={() => commands.startEngine()} />
              )}
            </div>
          </div>

          {hasChanges && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-4 rounded-2xl text-xs font-semibold cursor-default shrink-0 transition-all"
              style={{
                background: "linear-gradient(135deg, rgba(var(--neon-rgb),0.15), rgba(var(--neon-rgb),0.05))",
                color: "var(--bewusstsein)",
                border: "1px solid rgba(var(--neon-rgb),0.3)",
                boxShadow: "0 0 20px rgba(var(--neon-rgb),0.15)",
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
            <Provider name="Ollama" color="#00FFC8" local apiKey={env.OLLAMA_URL} model={env.OLLAMA_MODEL} models={PROVIDER_MODELS.ollama} onKey={(v) => updateEnv("OLLAMA_URL", v)} onModel={(v) => updateEnv("OLLAMA_MODEL", v)} />
          </div>
        </div>

        {/* ── Row 3: Features + Connections + System ────────── */}
        <div className="grid grid-cols-3 gap-4">

          {/* Features */}
          <div className="col-span-2">
            <Label text="Features" />
            <div className="neon-card overflow-hidden">
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
              <div className="neon-card p-5 flex items-center gap-3">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4" style={{ color: "var(--bewusstsein)" }}>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                <div className="flex-1">
                  <span className="text-sm font-medium" style={{ color: "var(--bewusstsein)" }}>MCP Servers</span>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>
                    Manage connections in the MCP panel
                  </p>
                </div>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded-md" style={{ background: "rgba(var(--neon-rgb),0.06)", color: "var(--text-muted)" }}>
                  MCP
                </span>
              </div>
            </div>

            {/* Updates */}
            <div>
              <Label text="Updates" />
              <div className="neon-card p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium" style={{ color: "var(--bewusstsein)" }}>
                      SoulOS v{appVersion}
                    </span>
                    {updateStatus === "available" && updateInfo && (
                      <div className="text-xs mt-0.5" style={{ color: "var(--wachstum)" }}>
                        v{updateInfo.version} verfuegbar
                      </div>
                    )}
                    {updateStatus === "downloading" && (
                      <div className="text-xs mt-0.5" style={{ color: "var(--bewusstsein)" }}>
                        Download... {downloadProgress}%
                      </div>
                    )}
                    {updateStatus === "done" && (
                      <div className="text-xs mt-0.5" style={{ color: "var(--wachstum)" }}>
                        Installiert — Neustart...
                      </div>
                    )}
                    {updateStatus === "error" && (
                      <div className="text-xs mt-0.5" style={{ color: "var(--heartbeat)" }}>
                        {updateError || "Update fehlgeschlagen"}
                      </div>
                    )}
                  </div>
                  <div>
                    {(updateStatus === "idle" || updateStatus === "error") && (
                      <Pill label="Check" color="#00FFC8" onClick={handleCheckUpdate} />
                    )}
                    {updateStatus === "checking" && (
                      <span className="text-xs" style={{ color: "var(--text-dim)" }}>Pruefe...</span>
                    )}
                    {updateStatus === "available" && (
                      <Pill label="Update" color="#00FF64" onClick={handleInstallUpdate} />
                    )}
                    {updateStatus === "downloading" && (
                      <div className="h-1.5 w-20 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(var(--neon-rgb),0.1)" }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${downloadProgress}%`, backgroundColor: "var(--bewusstsein)", boxShadow: "0 0 8px var(--bewusstsein)" }} />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* System */}
            <div>
              <Label text="System" />
              <div className="neon-card p-5 flex flex-col gap-3">
                <Sys label="Version" value={`v${appVersion}`} mono />
                <NeonSep />
                <Sys label="Soul Path" value={soulPath} mono />
                <NeonSep />
                <Sys label="Node.js" value={nodeInfo?.found ? nodeInfo.version : "Not found"} color={nodeInfo?.found ? "var(--wachstum)" : "var(--heartbeat)"} />
                <NeonSep />
                <Sys label="Engine PID" value={sidecar?.pid ? String(sidecar.pid) : "\u2014"} mono />
                <NeonSep />
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
  return <div className="text-[11px] uppercase font-semibold mb-2.5 neon-label">{text}</div>;
}

function Pill({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-xl text-xs font-semibold cursor-default transition-all"
      style={{
        background: `linear-gradient(135deg, ${color}2E, ${color}0F)`,
        color,
        border: `1px solid ${color}40`,
        textShadow: `0 0 8px ${color}4D`,
        boxShadow: `0 0 12px ${color}1A`,
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
        border: `1px solid ${ok ? `${color}4D` : "rgba(var(--neon-rgb),0.08)"}`,
        background: ok
          ? `linear-gradient(160deg, ${color}14, rgba(var(--dark-rgb),0.6))`
          : "linear-gradient(160deg, rgba(var(--neon-rgb),0.03), rgba(var(--dark-rgb),0.6))",
        boxShadow: ok
          ? `0 0 15px ${color}1F, inset 0 1px 0 ${color}14`
          : "0 0 8px rgba(var(--neon-rgb),0.03)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold" style={{ color, textShadow: ok ? `0 0 10px ${color}40` : "none" }}>{name}</span>
        {ok && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }} />}
      </div>
      <input
        type={local ? "text" : "password"}
        placeholder={local ? "http://localhost:11434" : "API Key"}
        value={apiKey}
        onChange={(e) => onKey(e.target.value)}
        className="w-full px-3.5 py-2.5 rounded-xl text-xs font-mono outline-none mb-2 neon-input"
      />
      <select
        value={model}
        onChange={(e) => onModel(e.target.value)}
        className="w-full px-3.5 py-2.5 rounded-xl text-xs outline-none cursor-default neon-input"
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
      style={{ borderBottom: last ? "none" : "1px solid rgba(var(--neon-rgb),0.06)" }}
      onClick={toggle}
    >
      <div>
        <div className="text-sm font-medium" style={{ color: "var(--text-bright)" }}>{label}</div>
        <div className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>{desc}</div>
      </div>
      <div
        className="w-[38px] h-[22px] rounded-full relative transition-all shrink-0 ml-4"
        style={{
          backgroundColor: on ? "var(--bewusstsein)" : "rgba(var(--neon-rgb),0.08)",
          boxShadow: on ? "0 0 12px rgba(var(--neon-rgb),0.3)" : "inset 0 1px 2px rgba(var(--black-rgb),0.2)",
        }}
      >
        <div
          className="absolute top-[2px] w-[18px] h-[18px] rounded-full transition-all"
          style={{
            backgroundColor: on ? "#0A0C14" : "#fff",
            left: on ? "calc(100% - 20px)" : "2px",
            boxShadow: on ? "0 0 4px rgba(var(--neon-rgb),0.5)" : "0 1px 3px rgba(var(--black-rgb),0.3)",
          }}
        />
      </div>
    </div>
  );
}

function Sys({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs" style={{ color: "var(--text-dim)" }}>{label}</span>
      <span className={`text-xs truncate ml-4 max-w-[60%] text-right ${mono ? "font-mono" : ""}`} style={{ color: color || "var(--bewusstsein)" }}>{value}</span>
    </div>
  );
}

function NeonSep() {
  return <div className="neon-divider" />;
}
