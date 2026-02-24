import { useEffect, useState, useCallback } from "react";
import { commands } from "../lib/tauri";
import { useSidecarStatus } from "../lib/store";
import { MCP_PROFILES, type MCPProfile, type MCPCredential } from "../lib/mcp-profiles";

// ── Types ──────────────────────────────────────────────────

interface MCPConfig {
  mcpServers: Record<string, {
    command: string;
    args: string[];
    env: Record<string, string>;
  }>;
}

type WizardStep = "intro" | "credentials" | "custom" | "confirm" | "done";

interface WizardState {
  profile: MCPProfile;
  step: WizardStep;
  credentialIndex: number;
  values: Record<string, string>;
  // Custom server fields
  customName: string;
  customCommand: string;
  customArgs: string;
  customEnvKeys: string;
}

// ── Main View ──────────────────────────────────────────────

export default function MCPView() {
  const [mcpConfig, setMcpConfig] = useState<MCPConfig>({ mcpServers: {} });
  const [wizard, setWizard] = useState<WizardState | null>(null);
  const [filter, setFilter] = useState<"all" | "messaging" | "development" | "utility">("all");
  const [restarting, setRestarting] = useState(false);
  const sidecar = useSidecarStatus();
  const engineRunning = sidecar?.status === "running";

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const raw = await commands.readSoulFile(".mcp.json");
      setMcpConfig(JSON.parse(raw));
    } catch {
      setMcpConfig({ mcpServers: {} });
    }
  };

  const configuredServers = Object.keys(mcpConfig.mcpServers || {});

  const isInstalled = (profile: MCPProfile): boolean => {
    if (profile.id === "custom") return false;
    return configuredServers.includes(profile.mcpConfig.serverName);
  };

  const catalogProfiles = filter === "all"
    ? MCP_PROFILES
    : MCP_PROFILES.filter((p) => p.category === filter);

  // ── Wizard Actions ─────────────────────────────────────

  const openWizard = (profile: MCPProfile) => {
    setWizard({
      profile,
      step: profile.id === "custom" ? "custom" : "intro",
      credentialIndex: 0,
      values: {},
      customName: "",
      customCommand: "npx",
      customArgs: "",
      customEnvKeys: "",
    });
  };

  const closeWizard = () => setWizard(null);

  const nextStep = () => {
    if (!wizard) return;
    const { profile, step, credentialIndex } = wizard;

    if (step === "intro") {
      if (profile.credentials.length > 0) {
        setWizard({ ...wizard, step: "credentials", credentialIndex: 0 });
      } else {
        setWizard({ ...wizard, step: "confirm" });
      }
    } else if (step === "credentials") {
      if (credentialIndex < profile.credentials.length - 1) {
        setWizard({ ...wizard, credentialIndex: credentialIndex + 1 });
      } else {
        setWizard({ ...wizard, step: "confirm" });
      }
    } else if (step === "custom") {
      setWizard({ ...wizard, step: "confirm" });
    } else if (step === "confirm") {
      handleInstall();
    }
  };

  const handleInstall = useCallback(async () => {
    if (!wizard) return;
    const { profile, values, customName, customCommand, customArgs, customEnvKeys } = wizard;

    try {
      // Build new server entry
      let serverName: string;
      let serverConfig: { command: string; args: string[]; env: Record<string, string> };

      if (profile.id === "custom") {
        serverName = customName || "custom-server";
        const args = customArgs.split(/\s+/).filter(Boolean);
        const envPairs: Record<string, string> = {};
        for (const key of customEnvKeys.split(/\s*,\s*/).filter(Boolean)) {
          envPairs[key] = `\${${key}}`;
        }
        serverConfig = { command: customCommand, args, env: envPairs };
      } else {
        serverName = profile.mcpConfig.serverName;
        serverConfig = {
          command: profile.mcpConfig.command,
          args: [...profile.mcpConfig.args],
          env: { ...profile.mcpConfig.env },
        };
      }

      // Write credentials to .env
      const envEntries: Record<string, string> = {};
      for (const [key, val] of Object.entries(values)) {
        if (val) envEntries[key] = val;
      }
      if (Object.keys(envEntries).length > 0) {
        // Merge with existing env
        const existing = await commands.readEnv().catch(() => ({}));
        await commands.writeEnv({ ...existing, ...envEntries });
      }

      // Update .mcp.json
      const newConfig = { ...mcpConfig };
      if (!newConfig.mcpServers) newConfig.mcpServers = {};
      newConfig.mcpServers[serverName] = serverConfig;
      await commands.writeSoulFile(".mcp.json", JSON.stringify(newConfig, null, 2));

      setMcpConfig(newConfig);
      setWizard({ ...wizard, step: "done" });

      // Auto-restart engine
      if (engineRunning) {
        setRestarting(true);
        try {
          await commands.stopEngine();
          await new Promise((r) => setTimeout(r, 1500));
          await commands.startEngine();
        } catch { /* ignore */ }
        setRestarting(false);
      }
    } catch (e) {
      console.error("MCP install failed:", e);
    }
  }, [wizard, mcpConfig, engineRunning]);

  const handleDisconnect = useCallback(async (serverName: string) => {
    const newConfig = { ...mcpConfig };
    delete newConfig.mcpServers[serverName];
    try {
      await commands.writeSoulFile(".mcp.json", JSON.stringify(newConfig, null, 2));
      setMcpConfig(newConfig);

      // Restart engine if running
      if (engineRunning) {
        setRestarting(true);
        await commands.stopEngine();
        await new Promise((r) => setTimeout(r, 1000));
        await commands.startEngine();
        setRestarting(false);
      }
    } catch (e) {
      console.error("Disconnect failed:", e);
    }
  }, [mcpConfig, engineRunning]);

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="h-full overflow-auto neon-scanlines" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="px-8 py-6 flex flex-col gap-5">

        {/* Title */}
        <div className="text-center">
          <h1 className="text-lg font-semibold neon-title">CONNECTIONS</h1>
          <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
            MCP Server Management
          </p>
        </div>

        {/* Engine Status Bar */}
        <div className="flex items-center gap-3 px-5 py-3 neon-card">
          <div
            className={`w-2 h-2 rounded-full shrink-0 ${engineRunning ? "animate-breathe" : ""}`}
            style={{
              backgroundColor: engineRunning ? "var(--wachstum)" : "var(--text-muted)",
              boxShadow: engineRunning ? "0 0 10px var(--wachstum)" : "none",
            }}
          />
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>
            Engine {engineRunning ? "running" : "stopped"}
          </span>
          <span className="text-xs font-mono ml-auto" style={{ color: "var(--bewusstsein)" }}>
            {configuredServers.length} server{configuredServers.length !== 1 ? "s" : ""}
          </span>
          {restarting && (
            <span className="text-xs animate-pulse" style={{ color: "var(--bewusstsein)" }}>
              restarting...
            </span>
          )}
        </div>

        {/* ── Active Servers ──────────────────────────────── */}
        {configuredServers.length > 0 && (
          <div>
            <Label text="Active Servers" />
            <div className="grid grid-cols-3 gap-3">
              {configuredServers.map((name) => {
                const config = mcpConfig.mcpServers[name];
                const matchedProfile = MCP_PROFILES.find((p) => p.mcpConfig.serverName === name);
                const color = matchedProfile?.color || "var(--bewusstsein)";
                const displayName = matchedProfile?.name || name;
                const icon = matchedProfile?.icon;

                return (
                  <div
                    key={name}
                    className="rounded-2xl p-5 transition-all group"
                    style={{
                      border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
                      background: `linear-gradient(160deg, color-mix(in srgb, ${color} 8%, transparent), rgba(var(--dark-rgb),0.6))`,
                      boxShadow: `0 0 15px color-mix(in srgb, ${color} 12%, transparent)`,
                    }}
                  >
                    <div className="flex items-center gap-2.5 mb-2">
                      {icon && (
                        <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" style={{ color }}>
                          <path d={icon} />
                        </svg>
                      )}
                      <span className="text-sm font-semibold" style={{ color, textShadow: `0 0 10px ${color}40` }}>
                        {displayName}
                      </span>
                      <div
                        className={`w-2 h-2 rounded-full ml-auto ${engineRunning ? "animate-breathe" : ""}`}
                        style={{
                          backgroundColor: engineRunning ? color : "var(--text-muted)",
                          boxShadow: engineRunning ? `0 0 8px ${color}` : "none",
                        }}
                      />
                    </div>
                    <div className="text-xs font-mono truncate mb-3" style={{ color: "var(--text-dim)" }}>
                      {config.command} {config.args.slice(0, 3).join(" ")}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDisconnect(name)}
                        className="px-3 py-1.5 rounded-lg text-[10px] font-semibold cursor-default transition-all opacity-60 hover:opacity-100"
                        style={{
                          background: "rgba(var(--neon-rgb),0.05)",
                          color: "var(--heartbeat)",
                          border: "1px solid rgba(var(--neon-rgb),0.1)",
                        }}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Catalog ─────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-2.5">
            <Label text="Catalog" />
            <div className="flex gap-1.5">
              {(["all", "messaging", "development", "utility"] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilter(cat)}
                  className="px-3 py-1 rounded-lg text-[10px] font-semibold cursor-default transition-all"
                  style={{
                    background: filter === cat
                      ? "rgba(var(--neon-rgb),0.12)"
                      : "rgba(var(--neon-rgb),0.03)",
                    color: filter === cat ? "var(--bewusstsein)" : "var(--text-dim)",
                    border: `1px solid ${filter === cat ? "rgba(var(--neon-rgb),0.2)" : "rgba(var(--neon-rgb),0.06)"}`,
                  }}
                >
                  {cat === "all" ? "All" : cat.charAt(0).toUpperCase() + cat.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {catalogProfiles.map((profile) => {
              const installed = isInstalled(profile);
              return (
                <div
                  key={profile.id}
                  className="rounded-2xl p-5 transition-all"
                  style={{
                    border: `1px solid ${installed
                      ? `color-mix(in srgb, ${profile.color} 20%, transparent)`
                      : "rgba(var(--neon-rgb),0.08)"}`,
                    background: installed
                      ? `linear-gradient(160deg, color-mix(in srgb, ${profile.color} 5%, transparent), rgba(var(--dark-rgb),0.6))`
                      : "linear-gradient(160deg, rgba(var(--neon-rgb),0.03), rgba(var(--dark-rgb),0.6))",
                    opacity: installed ? 0.6 : 1,
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" style={{ color: profile.color }}>
                      <path d={profile.icon} />
                    </svg>
                    <span className="text-sm font-semibold" style={{ color: profile.color }}>
                      {profile.name}
                    </span>
                    {installed && (
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 ml-auto" style={{ color: "var(--wachstum)" }}>
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </div>
                  <p className="text-[11px] leading-relaxed mb-2" style={{ color: "var(--text-dim)" }}>
                    {profile.description}
                  </p>
                  <div className="flex items-center justify-between">
                    <span
                      className="text-[9px] uppercase font-semibold px-2 py-0.5 rounded-md"
                      style={{
                        background: "rgba(var(--neon-rgb),0.06)",
                        color: "var(--text-muted)",
                        border: "1px solid rgba(var(--neon-rgb),0.08)",
                      }}
                    >
                      {profile.category}
                    </span>
                    {!installed && (
                      <Pill label="Add" color={profile.color} onClick={() => openWizard(profile)} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Wizard Modal ──────────────────────────────────── */}
      {wizard && <WizardModal wizard={wizard} setWizard={setWizard} nextStep={nextStep} closeWizard={closeWizard} engineRunning={engineRunning} />}
    </div>
  );
}

// ── Wizard Modal ─────────────────────────────────────────

function WizardModal({
  wizard, setWizard, nextStep, closeWizard, engineRunning,
}: {
  wizard: WizardState;
  setWizard: (w: WizardState) => void;
  nextStep: () => void;
  closeWizard: () => void;
  engineRunning: boolean;
}) {
  const { profile, step, credentialIndex, values } = wizard;
  const cred = profile.credentials[credentialIndex] as MCPCredential | undefined;
  const color = profile.color;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) closeWizard(); }}
    >
      <div
        className="w-[480px] max-h-[80vh] overflow-auto rounded-3xl p-8"
        style={{
          background: "linear-gradient(160deg, rgba(var(--dark-rgb),0.95), rgba(var(--dark-rgb),0.85))",
          border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
          boxShadow: `0 0 40px color-mix(in srgb, ${color} 15%, transparent), 0 0 80px rgba(0,0,0,0.5)`,
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6" style={{ color }}>
            <path d={profile.icon} />
          </svg>
          <div>
            <h2 className="text-base font-semibold" style={{ color }}>{profile.name}</h2>
            <p className="text-[10px]" style={{ color: "var(--text-dim)" }}>
              {step === "intro" && "Setup"}
              {step === "credentials" && cred && `Step ${credentialIndex + 1} of ${profile.credentials.length}`}
              {step === "custom" && "Custom Server"}
              {step === "confirm" && "Confirm"}
              {step === "done" && "Done"}
            </p>
          </div>
          <button
            onClick={closeWizard}
            className="ml-auto text-xs cursor-default px-2 py-1 rounded-lg transition-all"
            style={{ color: "var(--text-muted)" }}
          >
            ESC
          </button>
        </div>

        {/* ── Step: Intro ─────────────────────────────── */}
        {step === "intro" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-bright)" }}>
              {profile.description}
            </p>
            {profile.prerequisites.length > 0 && (
              <div>
                <span className="text-[10px] uppercase font-semibold" style={{ color: "var(--text-muted)" }}>
                  Prerequisites
                </span>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {profile.prerequisites.map((p, i) => (
                    <li key={i} className="text-xs flex items-start gap-2" style={{ color: "var(--text-dim)" }}>
                      <span style={{ color }}>-</span> {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                ~{profile.estimatedTime}
              </span>
              {profile.credentials.length > 0 && (
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  - {profile.credentials.length} credential{profile.credentials.length > 1 ? "s" : ""} needed
                </span>
              )}
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <Pill label="Cancel" color="var(--text-muted)" onClick={closeWizard} />
              <Pill label="Continue" color={color} onClick={nextStep} />
            </div>
          </div>
        )}

        {/* ── Step: Credentials ───────────────────────── */}
        {step === "credentials" && cred && (
          <div className="flex flex-col gap-4">
            <div>
              <span className="text-sm font-semibold" style={{ color: "var(--text-bright)" }}>
                {cred.displayName}
              </span>
              <p className="text-xs mt-1" style={{ color: "var(--text-dim)" }}>
                Format: {cred.format}
              </p>
            </div>
            <div
              className="rounded-xl p-4"
              style={{ background: "rgba(var(--neon-rgb),0.03)", border: "1px solid rgba(var(--neon-rgb),0.08)" }}
            >
              <span className="text-[10px] uppercase font-semibold block mb-2" style={{ color: "var(--text-muted)" }}>
                How to get it
              </span>
              <ol className="flex flex-col gap-1.5">
                {cred.howToGet.map((step, i) => (
                  <li key={i} className="text-xs flex items-start gap-2" style={{ color: "var(--text-dim)" }}>
                    <span className="font-mono shrink-0" style={{ color }}>{i + 1}.</span> {step}
                  </li>
                ))}
              </ol>
            </div>
            <input
              type={cred.isPassword ? "password" : "text"}
              placeholder={cred.displayName}
              value={values[cred.envVar] || ""}
              onChange={(e) => setWizard({ ...wizard, values: { ...values, [cred.envVar]: e.target.value } })}
              className="w-full px-4 py-3 rounded-xl text-sm font-mono outline-none neon-input"
              autoFocus
            />
            <div className="flex justify-end gap-3 mt-2">
              <Pill label="Cancel" color="var(--text-muted)" onClick={closeWizard} />
              <Pill
                label={credentialIndex < profile.credentials.length - 1 ? "Next" : "Continue"}
                color={color}
                onClick={nextStep}
              />
            </div>
          </div>
        )}

        {/* ── Step: Custom Server ─────────────────────── */}
        {step === "custom" && (
          <div className="flex flex-col gap-4">
            <p className="text-xs" style={{ color: "var(--text-dim)" }}>
              Configure any MCP-compatible server. Check npmjs.com or github.com/modelcontextprotocol for packages.
            </p>
            <div className="flex flex-col gap-3">
              <div>
                <span className="text-[10px] uppercase font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>
                  Server Name
                </span>
                <input
                  placeholder="e.g. my-database"
                  value={wizard.customName}
                  onChange={(e) => setWizard({ ...wizard, customName: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl text-xs font-mono outline-none neon-input"
                  autoFocus
                />
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>
                  Command
                </span>
                <input
                  placeholder="npx"
                  value={wizard.customCommand}
                  onChange={(e) => setWizard({ ...wizard, customCommand: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl text-xs font-mono outline-none neon-input"
                />
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>
                  Arguments (space-separated)
                </span>
                <input
                  placeholder="-y @example/mcp-server"
                  value={wizard.customArgs}
                  onChange={(e) => setWizard({ ...wizard, customArgs: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl text-xs font-mono outline-none neon-input"
                />
              </div>
              <div>
                <span className="text-[10px] uppercase font-semibold block mb-1" style={{ color: "var(--text-muted)" }}>
                  Environment Variables (comma-separated keys)
                </span>
                <input
                  placeholder="API_KEY, SECRET"
                  value={wizard.customEnvKeys}
                  onChange={(e) => setWizard({ ...wizard, customEnvKeys: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl text-xs font-mono outline-none neon-input"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-2">
              <Pill label="Cancel" color="var(--text-muted)" onClick={closeWizard} />
              <Pill label="Continue" color={color} onClick={nextStep} />
            </div>
          </div>
        )}

        {/* ── Step: Confirm ───────────────────────────── */}
        {step === "confirm" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm" style={{ color: "var(--text-bright)" }}>
              Ready to install. This will:
            </p>
            <div className="flex flex-col gap-2">
              <ConfirmItem label=".mcp.json" detail={`Add "${profile.id === "custom" ? wizard.customName : profile.mcpConfig.serverName}" server entry`} />
              {Object.keys(values).length > 0 && (
                <ConfirmItem
                  label=".env"
                  detail={Object.keys(values).map((k) => `${k}=****`).join(", ")}
                />
              )}
              {engineRunning && (
                <ConfirmItem label="Engine" detail="Automatic restart after configuration" />
              )}
            </div>
            {profile.postSetup && (
              <div
                className="rounded-xl p-3 mt-2"
                style={{ background: `color-mix(in srgb, ${color} 5%, transparent)`, border: `1px solid color-mix(in srgb, ${color} 15%, transparent)` }}
              >
                <span className="text-[10px] uppercase font-semibold block mb-1" style={{ color }}>
                  After install
                </span>
                <p className="text-xs" style={{ color: "var(--text-dim)" }}>{profile.postSetup}</p>
              </div>
            )}
            <div className="flex justify-end gap-3 mt-4">
              <Pill label="Back" color="var(--text-muted)" onClick={() => {
                if (profile.id === "custom") {
                  setWizard({ ...wizard, step: "custom" });
                } else if (profile.credentials.length > 0) {
                  setWizard({ ...wizard, step: "credentials", credentialIndex: profile.credentials.length - 1 });
                } else {
                  setWizard({ ...wizard, step: "intro" });
                }
              }} />
              <Pill label="Install" color={color} onClick={nextStep} />
            </div>
          </div>
        )}

        {/* ── Step: Done ──────────────────────────────── */}
        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: `color-mix(in srgb, ${color} 15%, transparent)` }}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6" style={{ color }}>
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-sm font-semibold" style={{ color }}>
              {profile.name} connected
            </p>
            {engineRunning && (
              <p className="text-xs" style={{ color: "var(--text-dim)" }}>
                Engine is restarting to activate the connection.
              </p>
            )}
            <Pill label="Close" color={color} onClick={closeWizard} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Atoms ────────────────────────────────────────────────

function Label({ text }: { text: string }) {
  return <div className="text-[11px] uppercase font-semibold mb-2.5 neon-label">{text}</div>;
}

function Pill({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-xl text-xs font-semibold cursor-default transition-all"
      style={{
        background: `linear-gradient(135deg, color-mix(in srgb, ${color} 18%, transparent), color-mix(in srgb, ${color} 6%, transparent))`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
        textShadow: `0 0 8px color-mix(in srgb, ${color} 30%, transparent)`,
        boxShadow: `0 0 12px color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      {label}
    </button>
  );
}

function ConfirmItem({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5 rounded-xl" style={{ background: "rgba(var(--neon-rgb),0.03)" }}>
      <span className="text-xs font-mono font-semibold shrink-0" style={{ color: "var(--bewusstsein)" }}>{label}</span>
      <span className="text-xs" style={{ color: "var(--text-dim)" }}>{detail}</span>
    </div>
  );
}
