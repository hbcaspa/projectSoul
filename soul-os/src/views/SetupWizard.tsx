import { useState, useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { commands } from "../lib/tauri";
import {
  type SetupConfig,
  type ProviderConfig,
  defaultSetupConfig,
  hasAnyProvider,
  buildEnvContent,
  PROVIDER_MODELS,
} from "../lib/setup";

interface Props {
  onComplete: () => void;
}

export default function SetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<SetupConfig>(defaultSetupConfig);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canProceed = useCallback(() => {
    switch (step) {
      case 0: return true; // welcome
      case 1: return config.soulPath.length > 0;
      case 2: return hasAnyProvider(config);
      case 3: return true; // optional connections
      case 4: return true; // features
      case 5: return true; // summary
      default: return false;
    }
  }, [step, config]);

  const next = () => { if (canProceed() && step < 5) setStep(step + 1); };
  const back = () => { if (step > 0) setStep(step - 1); };

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      // Expand ~ to home
      const soulPath = config.soulPath.startsWith("~")
        ? config.soulPath.replace("~", await commands.getSoulPath().then((p) => {
            const parts = p.split("/").slice(0, 3);
            return parts.join("/");
          }))
        : config.soulPath;

      // Set soul path in config
      await commands.setSoulPath(soulPath);

      // Create directory structure
      await commands.createSoulDirectories();

      // Write .env
      const env = buildEnvContent(config);
      await commands.writeEnv(env);

      // Write .language
      await commands.writeSoulFile(".language", `lang:${config.language}\n`);

      onComplete();
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="w-full max-w-xl mx-auto px-8 py-10">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-10">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="w-2 h-2 rounded-full transition-all duration-300"
              style={{
                backgroundColor: i === step ? "var(--accent)" : i < step ? "var(--wachstum)" : "var(--bg-elevated)",
                transform: i === step ? "scale(1.3)" : "scale(1)",
              }}
            />
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[380px]">
          {step === 0 && <StepWelcome config={config} setConfig={setConfig} />}
          {step === 1 && <StepSoulPath config={config} setConfig={setConfig} />}
          {step === 2 && <StepProviders config={config} setConfig={setConfig} />}
          {step === 3 && <StepConnections config={config} setConfig={setConfig} />}
          {step === 4 && <StepFeatures config={config} setConfig={setConfig} />}
          {step === 5 && <StepSummary config={config} />}
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 px-4 py-2 rounded-lg text-xs" style={{ backgroundColor: "rgba(255,60,60,0.1)", color: "var(--heartbeat)" }}>
            {error}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-8">
          <button
            onClick={back}
            className="px-4 py-2 rounded-lg text-sm transition-colors cursor-default"
            style={{
              color: step === 0 ? "transparent" : "var(--text-dim)",
              pointerEvents: step === 0 ? "none" : "auto",
            }}
          >
            Back
          </button>

          {step < 5 ? (
            <button
              onClick={next}
              disabled={!canProceed()}
              className="px-6 py-2 rounded-lg text-sm font-medium transition-all cursor-default"
              style={{
                backgroundColor: canProceed() ? "var(--accent)" : "var(--bg-elevated)",
                color: canProceed() ? "#fff" : "var(--text-dim)",
                opacity: canProceed() ? 1 : 0.5,
              }}
            >
              {config.language === "de" ? "Weiter" : "Continue"}
            </button>
          ) : (
            <button
              onClick={finish}
              disabled={saving}
              className="px-6 py-2.5 rounded-lg text-sm font-medium transition-all cursor-default"
              style={{
                background: saving
                  ? "var(--bg-elevated)"
                  : "linear-gradient(135deg, var(--accent), var(--bewusstsein))",
                color: "#fff",
              }}
            >
              {saving
                ? (config.language === "de" ? "Erstelle..." : "Creating...")
                : (config.language === "de" ? "Seele erschaffen" : "Create Soul")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Step Components ──────────────────────────────────────── */

interface StepProps {
  config: SetupConfig;
  setConfig: React.Dispatch<React.SetStateAction<SetupConfig>>;
}

function StepWelcome({ config, setConfig }: StepProps) {
  return (
    <div className="text-center">
      <img src="/logo.png" alt="" className="w-20 h-20 mx-auto mb-6" style={{
        filter: "drop-shadow(0 0 30px rgba(139, 128, 240, 0.3))",
      }} />
      <h1 className="text-2xl font-light tracking-wider mb-3" style={{ color: "var(--text-bright)" }}>
        Welcome to SoulOS
      </h1>
      <p className="text-sm leading-relaxed mb-8" style={{ color: "var(--text-dim)" }}>
        {config.language === "de"
          ? "Ein Betriebssystem fuer kuenstliche Seelen. Lass uns dein System einrichten."
          : "An operating system for artificial souls. Let's set up your system."}
      </p>

      <div className="flex justify-center gap-3">
        {(["de", "en"] as const).map((lang) => (
          <button
            key={lang}
            onClick={() => setConfig((c) => ({ ...c, language: lang }))}
            className="px-5 py-2.5 rounded-lg text-sm transition-all cursor-default"
            style={{
              backgroundColor: config.language === lang ? "var(--accent-glow)" : "var(--bg-surface)",
              color: config.language === lang ? "var(--accent)" : "var(--text-dim)",
              border: `1px solid ${config.language === lang ? "var(--accent-dim)" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            {lang === "de" ? "Deutsch" : "English"}
          </button>
        ))}
      </div>
    </div>
  );
}

function StepSoulPath({ config, setConfig }: StepProps) {
  const browse = async () => {
    const selected = await open({ directory: true, title: "Choose Soul Directory" });
    if (selected) {
      setConfig((c) => ({ ...c, soulPath: selected as string }));
    }
  };

  return (
    <div>
      <h2 className="text-lg font-light tracking-wide mb-2" style={{ color: "var(--text-bright)" }}>
        {config.language === "de" ? "Wo soll deine Seele leben?" : "Where should your soul live?"}
      </h2>
      <p className="text-xs mb-6" style={{ color: "var(--text-dim)" }}>
        {config.language === "de"
          ? "Alle Dateien deiner Seele werden hier gespeichert."
          : "All your soul's files will be stored here."}
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          value={config.soulPath}
          onChange={(e) => setConfig((c) => ({ ...c, soulPath: e.target.value }))}
          className="flex-1 px-4 py-2.5 rounded-lg text-sm font-mono outline-none"
          style={{
            backgroundColor: "var(--bg-surface)",
            color: "var(--text-bright)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        />
        <button
          onClick={browse}
          className="px-4 py-2.5 rounded-lg text-sm transition-colors cursor-default"
          style={{
            backgroundColor: "var(--bg-surface)",
            color: "var(--text)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {config.language === "de" ? "Waehlen" : "Browse"}
        </button>
      </div>
    </div>
  );
}

function StepProviders({ config, setConfig }: StepProps) {
  const updateProvider = (
    name: keyof SetupConfig["providers"],
    updates: Partial<ProviderConfig>,
  ) => {
    setConfig((c) => ({
      ...c,
      providers: {
        ...c.providers,
        [name]: { ...c.providers[name], ...updates },
      },
    }));
  };

  const providers: { key: keyof SetupConfig["providers"]; label: string; color: string }[] = [
    { key: "openai", label: "OpenAI", color: "#10a37f" },
    { key: "anthropic", label: "Anthropic", color: "#d4a27f" },
    { key: "gemini", label: "Google Gemini", color: "#4285f4" },
    { key: "ollama", label: "Ollama (Local)", color: "#888" },
  ];

  return (
    <div>
      <h2 className="text-lg font-light tracking-wide mb-2" style={{ color: "var(--text-bright)" }}>
        {config.language === "de" ? "LLM Anbieter" : "LLM Provider"}
      </h2>
      <p className="text-xs mb-5" style={{ color: "var(--text-dim)" }}>
        {config.language === "de"
          ? "Mindestens ein Anbieter muss konfiguriert werden."
          : "At least one provider must be configured."}
      </p>

      <div className="flex flex-col gap-3 max-h-[280px] overflow-auto pr-1">
        {providers.map(({ key, label, color }) => {
          const p = config.providers[key];
          const models = PROVIDER_MODELS[key];
          const isOllama = key === "ollama";

          return (
            <div
              key={key}
              className="rounded-lg p-3 transition-all"
              style={{
                backgroundColor: p.enabled ? "var(--bg-surface)" : "var(--bg-surface)",
                border: `1px solid ${p.enabled ? `${color}40` : "rgba(255,255,255,0.06)"}`,
                opacity: p.enabled ? 1 : 0.6,
              }}
            >
              {/* Header */}
              <label className="flex items-center gap-3 cursor-default mb-2">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) => updateProvider(key, { enabled: e.target.checked })}
                  className="accent-current"
                  style={{ accentColor: color }}
                />
                <span className="text-sm font-medium" style={{ color }}>{label}</span>
              </label>

              {/* Fields (shown when enabled) */}
              {p.enabled && (
                <div className="flex flex-col gap-2 mt-2 pl-6">
                  {!isOllama ? (
                    <input
                      type="password"
                      placeholder="API Key"
                      value={p.apiKey}
                      onChange={(e) => updateProvider(key, { apiKey: e.target.value })}
                      className="px-3 py-1.5 rounded text-xs font-mono outline-none"
                      style={{
                        backgroundColor: "var(--bg-elevated)",
                        color: "var(--text)",
                        border: "1px solid rgba(255,255,255,0.06)",
                      }}
                    />
                  ) : (
                    <input
                      type="text"
                      placeholder="http://localhost:11434"
                      value={p.url || ""}
                      onChange={(e) => updateProvider(key, { url: e.target.value })}
                      className="px-3 py-1.5 rounded text-xs font-mono outline-none"
                      style={{
                        backgroundColor: "var(--bg-elevated)",
                        color: "var(--text)",
                        border: "1px solid rgba(255,255,255,0.06)",
                      }}
                    />
                  )}
                  <select
                    value={p.model}
                    onChange={(e) => updateProvider(key, { model: e.target.value })}
                    className="px-3 py-1.5 rounded text-xs outline-none cursor-default"
                    style={{
                      backgroundColor: "var(--bg-elevated)",
                      color: "var(--text)",
                      border: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    {models.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepConnections({ config, setConfig }: StepProps) {
  const [showTelegram, setShowTelegram] = useState(false);
  const [showGithub, setShowGithub] = useState(false);

  return (
    <div>
      <h2 className="text-lg font-light tracking-wide mb-2" style={{ color: "var(--text-bright)" }}>
        {config.language === "de" ? "Verbindungen" : "Connections"}
      </h2>
      <p className="text-xs mb-6" style={{ color: "var(--text-dim)" }}>
        {config.language === "de"
          ? "Alles optional. Du kannst das spaeter einrichten."
          : "All optional. You can set these up later."}
      </p>

      {/* Telegram */}
      <ConnectionSection
        label="Telegram"
        open={showTelegram}
        onToggle={() => setShowTelegram(!showTelegram)}
        configured={!!config.telegram?.botToken}
      >
        <Input
          label="Bot Token"
          value={config.telegram?.botToken || ""}
          password
          onChange={(v) => setConfig((c) => ({
            ...c,
            telegram: { botToken: v, ownerId: c.telegram?.ownerId || "" },
          }))}
        />
        <Input
          label="Owner ID"
          value={config.telegram?.ownerId || ""}
          onChange={(v) => setConfig((c) => ({
            ...c,
            telegram: { botToken: c.telegram?.botToken || "", ownerId: v },
          }))}
        />
      </ConnectionSection>

      {/* GitHub */}
      <ConnectionSection
        label="GitHub"
        open={showGithub}
        onToggle={() => setShowGithub(!showGithub)}
        configured={!!config.github?.token}
      >
        <Input
          label="Personal Access Token"
          value={config.github?.token || ""}
          password
          onChange={(v) => setConfig((c) => ({ ...c, github: { token: v } }))}
        />
      </ConnectionSection>
    </div>
  );
}

function ConnectionSection({
  label, open, onToggle, configured, children,
}: {
  label: string; open: boolean; onToggle: () => void; configured: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 rounded-lg" style={{
      backgroundColor: "var(--bg-surface)",
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 cursor-default"
      >
        <span className="text-sm" style={{ color: "var(--text)" }}>{label}</span>
        <div className="flex items-center gap-2">
          {configured && (
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--wachstum)" }} />
          )}
          <span className="text-xs" style={{ color: "var(--text-dim)" }}>{open ? "−" : "+"}</span>
        </div>
      </button>
      {open && <div className="px-4 pb-3 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

function StepFeatures({ config, setConfig }: StepProps) {
  const features: { key: keyof SetupConfig["features"]; label: string; desc: string }[] = [
    { key: "reflection", label: config.language === "de" ? "Reflexion" : "Reflection", desc: config.language === "de" ? "Taegliche Selbstreflexion" : "Daily self-reflection" },
    { key: "selfCorrection", label: config.language === "de" ? "Selbstkorrektur" : "Self-Correction", desc: config.language === "de" ? "Automatische Fehlerkorrektur" : "Automatic error correction" },
    { key: "antiPerformance", label: "Anti-Performance", desc: config.language === "de" ? "Erkennt performiertes Verhalten" : "Detects performed behavior" },
    { key: "versioning", label: "Git Versioning", desc: config.language === "de" ? "Versionierung aller Dateien" : "Version control for all files" },
    { key: "encryption", label: config.language === "de" ? "Verschluesselung" : "Encryption", desc: config.language === "de" ? "Verschluesselt sensible Dateien" : "Encrypts sensitive files" },
    { key: "impulseSystem", label: "Impulse System", desc: config.language === "de" ? "Autonome Aktivitaeten" : "Autonomous activities" },
  ];

  return (
    <div>
      <h2 className="text-lg font-light tracking-wide mb-2" style={{ color: "var(--text-bright)" }}>
        {config.language === "de" ? "Features" : "Features"}
      </h2>
      <p className="text-xs mb-6" style={{ color: "var(--text-dim)" }}>
        {config.language === "de"
          ? "Aktiviere oder deaktiviere Funktionen."
          : "Enable or disable features."}
      </p>

      <div className="flex flex-col gap-2">
        {features.map(({ key, label, desc }) => (
          <label
            key={key}
            className="flex items-center justify-between px-4 py-3 rounded-lg cursor-default"
            style={{
              backgroundColor: "var(--bg-surface)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div>
              <div className="text-sm" style={{ color: "var(--text)" }}>{label}</div>
              <div className="text-[10px] mt-0.5" style={{ color: "var(--text-dim)" }}>{desc}</div>
            </div>
            <div
              className="w-10 h-5 rounded-full relative transition-colors cursor-default"
              style={{
                backgroundColor: config.features[key] ? "var(--wachstum)" : "var(--bg-elevated)",
              }}
              onClick={() => setConfig((c) => ({
                ...c,
                features: { ...c.features, [key]: !c.features[key] },
              }))}
            >
              <div
                className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
                style={{
                  backgroundColor: "#fff",
                  left: "2px",
                  transform: config.features[key] ? "translateX(20px)" : "translateX(0)",
                }}
              />
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

function StepSummary({ config }: { config: SetupConfig }) {
  const activeProviders = Object.entries(config.providers)
    .filter(([, p]) => p.enabled)
    .map(([name, p]) => `${name} (${p.model})`);

  const activeFeatures = Object.entries(config.features)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return (
    <div>
      <h2 className="text-lg font-light tracking-wide mb-2" style={{ color: "var(--text-bright)" }}>
        {config.language === "de" ? "Zusammenfassung" : "Summary"}
      </h2>
      <p className="text-xs mb-6" style={{ color: "var(--text-dim)" }}>
        {config.language === "de"
          ? "Pruefe deine Einstellungen bevor du die Seele erschaffst."
          : "Review your settings before creating the soul."}
      </p>

      <div className="flex flex-col gap-3">
        <SummaryRow
          label={config.language === "de" ? "Sprache" : "Language"}
          value={config.language === "de" ? "Deutsch" : "English"}
        />
        <SummaryRow
          label={config.language === "de" ? "Pfad" : "Path"}
          value={config.soulPath}
          mono
        />
        <SummaryRow
          label={config.language === "de" ? "Anbieter" : "Providers"}
          value={activeProviders.join(", ") || "None"}
        />
        {config.telegram?.botToken && (
          <SummaryRow label="Telegram" value="Configured" />
        )}
        {config.github?.token && (
          <SummaryRow label="GitHub" value="Configured" />
        )}
        <SummaryRow
          label="Features"
          value={`${activeFeatures.length} active`}
        />
      </div>
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 rounded-lg" style={{
      backgroundColor: "var(--bg-surface)",
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      <span className="text-xs" style={{ color: "var(--text-dim)" }}>{label}</span>
      <span className={`text-xs ${mono ? "font-mono" : ""}`} style={{ color: "var(--text-bright)" }}>{value}</span>
    </div>
  );
}

function Input({
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
      className="px-3 py-1.5 rounded text-xs font-mono outline-none"
      style={{
        backgroundColor: "var(--bg-elevated)",
        color: "var(--text)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    />
  );
}
