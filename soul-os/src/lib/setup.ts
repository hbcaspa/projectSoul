export interface ProviderConfig {
  enabled: boolean;
  apiKey: string;
  model: string;
  url?: string; // only for Ollama
}

export interface SetupConfig {
  language: "de" | "en";
  soulPath: string;
  providers: {
    openai: ProviderConfig;
    gemini: ProviderConfig;
    anthropic: ProviderConfig;
    ollama: ProviderConfig;
  };
  telegram?: { botToken: string; ownerId: string };
  github?: { token: string };
  features: {
    reflection: boolean;
    selfCorrection: boolean;
    antiPerformance: boolean;
    versioning: boolean;
    encryption: boolean;
    impulseSystem: boolean;
  };
}

export const PROVIDER_MODELS = {
  openai: [
    { value: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
    { value: "gpt-4.1", label: "GPT-4.1" },
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "o4-mini", label: "o4-mini" },
  ],
  gemini: [
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.0-pro", label: "Gemini 2.0 Pro" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  ],
  anthropic: [
    { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { value: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    { value: "claude-opus-4-6", label: "Claude Opus 4.6" },
  ],
  ollama: [
    { value: "llama3.1", label: "Llama 3.1" },
    { value: "mistral", label: "Mistral" },
    { value: "qwen2.5", label: "Qwen 2.5" },
    { value: "gemma2", label: "Gemma 2" },
  ],
} as const;

export function defaultSetupConfig(): SetupConfig {
  return {
    language: "en",
    soulPath: "~/Soul",
    providers: {
      openai: { enabled: false, apiKey: "", model: "gpt-4.1-mini" },
      gemini: { enabled: false, apiKey: "", model: "gemini-2.5-flash" },
      anthropic: { enabled: false, apiKey: "", model: "claude-sonnet-4-6" },
      ollama: { enabled: false, apiKey: "", model: "llama3.1", url: "http://localhost:11434" },
    },
    features: {
      reflection: true,
      selfCorrection: true,
      antiPerformance: true,
      versioning: true,
      encryption: false,
      impulseSystem: true,
    },
  };
}

export function hasAnyProvider(config: SetupConfig): boolean {
  return Object.values(config.providers).some(
    (p) => p.enabled && (p.apiKey || p.url),
  );
}

export function buildEnvContent(config: SetupConfig): Record<string, string> {
  const env: Record<string, string> = {};

  // Primary provider (first enabled one)
  const providers = config.providers;
  if (providers.openai.enabled && providers.openai.apiKey) {
    env.OPENAI_API_KEY = providers.openai.apiKey;
    env.OPENAI_MODEL = providers.openai.model;
  }
  if (providers.gemini.enabled && providers.gemini.apiKey) {
    env.GEMINI_API_KEY = providers.gemini.apiKey;
    env.GEMINI_MODEL = providers.gemini.model;
  }
  if (providers.anthropic.enabled && providers.anthropic.apiKey) {
    env.ANTHROPIC_API_KEY = providers.anthropic.apiKey;
    env.ANTHROPIC_MODEL = providers.anthropic.model;
  }
  if (providers.ollama.enabled) {
    env.OLLAMA_URL = providers.ollama.url || "http://localhost:11434";
    env.OLLAMA_MODEL = providers.ollama.model;
  }

  // Connections
  if (config.telegram?.botToken) {
    env.TELEGRAM_BOT_TOKEN = config.telegram.botToken;
    env.TELEGRAM_OWNER_ID = config.telegram.ownerId;
  }
  if (config.github?.token) {
    env.GITHUB_TOKEN = config.github.token;
  }

  // Features
  env.FEATURE_REFLECTION = config.features.reflection ? "true" : "false";
  env.FEATURE_SELF_CORRECTION = config.features.selfCorrection ? "true" : "false";
  env.FEATURE_ANTI_PERFORMANCE = config.features.antiPerformance ? "true" : "false";
  env.FEATURE_VERSIONING = config.features.versioning ? "true" : "false";
  env.FEATURE_ENCRYPTION = config.features.encryption ? "true" : "false";
  env.FEATURE_IMPULSE_SYSTEM = config.features.impulseSystem ? "true" : "false";

  return env;
}
