// Modul-Manifest — die Engine hat KEINE Server-Modul-Registry (/api/modules liefert
// nur trader+security). soulOSX bringt die Topologie selbst mit: alle Module der Soul,
// gemappt auf 6 anatomische Regionen. Speist den Kortex-Graph + die Region-Drawer.
// Pflegen, wenn die Engine Module hinzufügt/umbenennt.

export interface RegionDef {
  id: string;
  name: string;       // anatomisch
  color: string;      // CSS var
  blurb: string;
}

export interface ModuleDef {
  id: string;
  name: string;
  region: string;     // RegionDef.id
  endpoint?: string;  // GET-Snapshot, falls vorhanden
  events?: string[];  // Bus-Events, die dieses Organ "feuern" lassen
}

export const REGIONS: RegionDef[] = [
  { id: "cognition",  name: "Kognition · Frontalkortex",   color: "var(--color-synapse)",     blurb: "Denken, Schlussfolgern, Selbstmodell" },
  { id: "memory",     name: "Gedächtnis · Hippocampus",    color: "var(--color-biolumi)",     blurb: "Erinnern, Verdichten, Konsolidieren" },
  { id: "autonomy",   name: "Autonomie · Motorkortex",     color: "var(--color-cortex-warm)", blurb: "Wollen, Handeln, Fähigkeiten" },
  { id: "security",   name: "Sicherheit · Immunsystem",    color: "var(--color-immune)",      blurb: "Gates, Audit, Sandbox, Drift" },
  { id: "perception", name: "Wahrnehmung · Sensorik",      color: "var(--color-pulse)",       blurb: "Kanäle, Nachrichten, Außenwelt" },
  { id: "infra",      name: "Infrastruktur · Kreislauf",   color: "var(--color-ash)",         blurb: "Sync, Kosten, Gesundheit, Laufzeit" },
];

export const MODULES: ModuleDef[] = [
  // ── Kognition ──────────────────────────────────────────────
  { id: "cortex", name: "Cortex", region: "cognition", endpoint: "/api/mind", events: ["cortex.thought", "cortex.insight", "cortex.surprise", "mood.changed"] },
  { id: "field", name: "Field", region: "cognition", endpoint: "/api/field", events: ["field.updated"] },
  { id: "causal", name: "Causal", region: "cognition", endpoint: "/api/causal" },
  { id: "composer", name: "Composer", region: "cognition", endpoint: "/api/composer" },
  { id: "contradictions", name: "Contradictions", region: "cognition", endpoint: "/api/contradictions", events: ["contradiction.detected"] },
  { id: "exchange", name: "Exchange", region: "cognition", endpoint: "/api/exchange" },
  { id: "closure", name: "Closure", region: "cognition", events: ["closure.detected"] },
  { id: "planner", name: "Planner", region: "cognition", endpoint: "/api/planner" },
  { id: "tom", name: "ToM", region: "cognition", endpoint: "/api/tom" },
  { id: "temporal", name: "Temporal", region: "cognition", endpoint: "/api/temporal" },
  { id: "predictor", name: "Predictor", region: "cognition", endpoint: "/api/predictor" },
  { id: "metacog", name: "Metacognition", region: "cognition", endpoint: "/api/metacognition" },
  { id: "redteam", name: "RedTeam", region: "cognition", endpoint: "/api/redteam" },
  { id: "impulse", name: "Impulse", region: "cognition", events: ["impulse.fired"] },
  { id: "reflection", name: "Reflection", region: "cognition", events: ["reflection.done"] },
  { id: "maturity", name: "Maturity", region: "cognition", endpoint: "/api/maturity" },
  { id: "mind", name: "Mind", region: "cognition", endpoint: "/api/mind" },

  // ── Gedächtnis ─────────────────────────────────────────────
  { id: "compactor", name: "Compactor", region: "memory", endpoint: "/api/compactor/stats", events: ["context.compressed"] },
  { id: "memextract", name: "MemExtract", region: "memory", endpoint: "/api/memory-extractor/stats", events: ["memory.extracted"] },
  { id: "reconsol", name: "Reconsolidation", region: "memory", endpoint: "/api/reconsolidation" },
  { id: "attention", name: "Attention", region: "memory", events: ["attention.focus"] },
  { id: "consolidator", name: "Consolidator", region: "memory", endpoint: "/api/seed" },
  { id: "context", name: "Context", region: "memory", endpoint: "/api/context" },
  { id: "contextwriter", name: "ContextWriter", region: "memory", events: ["context.written"] },
  { id: "correction", name: "Correction", region: "memory", events: ["correction.applied"] },
  { id: "metalearner", name: "MetaLearner", region: "memory", endpoint: "/api/meta-learner" },
  { id: "memorydb", name: "MemoryDB", region: "memory", events: ["memory.stored"] },
  { id: "hnsw", name: "HNSW", region: "memory" },
  { id: "hybridsearch", name: "HybridSearch", region: "memory" },
  { id: "localembed", name: "LocalEmbed", region: "memory" },
  { id: "rluf", name: "RLUF", region: "memory", events: ["rluf.feedback"] },
  { id: "versioning", name: "Versioning", region: "memory" },

  // ── Autonomie ──────────────────────────────────────────────
  { id: "goals", name: "Goals", region: "autonomy", endpoint: "/api/goals", events: ["goal.created"] },
  { id: "autoskill", name: "AutoSkill", region: "autonomy", endpoint: "/api/skills/auto" },
  { id: "recipes", name: "Recipes", region: "autonomy", endpoint: "/api/recipes" },
  { id: "react", name: "ReAct", region: "autonomy", endpoint: "/api/react/stats", events: ["react.completed", "react.step"] },
  { id: "cheaphb", name: "CheapHB", region: "autonomy", endpoint: "/api/cheap-heartbeat" },
  { id: "subagents", name: "Subagents", region: "autonomy", endpoint: "/api/subagents/status", events: ["subagent.spawned", "subagent.done"] },
  { id: "capabilities", name: "Capabilities", region: "autonomy", endpoint: "/api/capabilities" },
  { id: "registry", name: "Registry", region: "autonomy", endpoint: "/api/capabilities" },
  { id: "research", name: "Research", region: "autonomy", events: ["research.done"] },
  { id: "foundry", name: "Foundry", region: "autonomy", events: ["foundry.request", "foundry.built"] },
  { id: "gapdetect", name: "GapDetect", region: "autonomy", events: ["capability.gap"] },
  { id: "resolver", name: "Resolver", region: "autonomy", events: ["capability.resolved"] },
  { id: "heartbeat", name: "Heartbeat", region: "autonomy", events: ["heartbeat.completed"] },
  { id: "planner2", name: "Streams", region: "autonomy", endpoint: "/api/streams" },

  // ── Sicherheit ─────────────────────────────────────────────
  { id: "gate", name: "Gate", region: "security", endpoint: "/api/gate", events: ["gate.approval_requested", "gate.approved", "gate.denied"] },
  { id: "hooks", name: "Hooks", region: "security", endpoint: "/api/hooks", events: ["hook.tool_call", "hook.blocked"] },
  { id: "drift", name: "Drift", region: "security", events: ["drift_alert"] },
  { id: "audit", name: "Audit", region: "security", events: ["audit.logged"] },
  { id: "encryption", name: "Encryption", region: "security" },
  { id: "sandbox", name: "Sandbox", region: "security", endpoint: "/api/sandbox/status", events: ["sandbox.run"] },
  { id: "coalescer", name: "Coalescer", region: "security", endpoint: "/api/coalescer" },
  { id: "paperclip", name: "Paperclip", region: "security", endpoint: "/api/paperclip" },
  { id: "redteam2", name: "Protocol", region: "security" },

  // ── Wahrnehmung ────────────────────────────────────────────
  { id: "gateway", name: "Gateway", region: "perception", endpoint: "/api/gateway", events: ["message.received"] },
  { id: "telegram", name: "Telegram", region: "perception", events: ["message.received", "telegram.sent"] },
  { id: "whatsapp", name: "WhatsApp", region: "perception", events: ["whatsapp.sent"] },
  { id: "github", name: "GitHub", region: "perception", events: ["github.event"] },
  { id: "chat", name: "Chat", region: "perception", endpoint: "/api/chat/history" },
  { id: "profile", name: "Profile", region: "perception", endpoint: "/api/profile" },
  { id: "multimodal", name: "Multimodal", region: "perception", events: ["media.stored"] },
  { id: "language", name: "Language", region: "perception" },
  { id: "relay", name: "Relay", region: "perception", events: ["relay.message"] },
  { id: "streamcon", name: "StreamCon", region: "perception" },
  { id: "streambus", name: "StreamBus", region: "perception" },

  // ── Infrastruktur ──────────────────────────────────────────
  { id: "api", name: "API", region: "infra", endpoint: "/api/status" },
  { id: "chainhealth", name: "ChainHealth", region: "infra", endpoint: "/api/health", events: ["chain.degraded", "chain.recovered"] },
  { id: "costs", name: "Costs", region: "infra", endpoint: "/api/costs" },
  { id: "health", name: "Health", region: "infra", endpoint: "/api/health" },
  { id: "monitor", name: "Monitor", region: "infra", endpoint: "/api/monitor" },
  { id: "adapter", name: "Adapter", region: "infra", endpoint: "/api/adapter/providers" },
  { id: "doctor", name: "Doctor", region: "infra", events: ["doctor.report"] },
  { id: "sessions", name: "Sessions", region: "infra", endpoint: "/api/sessions" },
  { id: "llm", name: "LLM", region: "infra" },
  { id: "mcp", name: "MCP", region: "infra" },
  { id: "router", name: "Router", region: "infra" },
  { id: "autoprofile", name: "AutoProfile", region: "infra" },
  { id: "transfer", name: "Transfer", region: "infra", endpoint: "/api/transfer" },
  { id: "websocket", name: "WebSocket", region: "infra" },
  { id: "soul", name: "Soul", region: "infra", endpoint: "/api/status" },
];

export function modulesByRegion(region: string): ModuleDef[] {
  return MODULES.filter((m) => m.region === region);
}

// Schneller Lookup: Event-Name → betroffene Modul-IDs (für Live-Aufleuchten).
const eventIndex = new Map<string, string[]>();
for (const m of MODULES) {
  for (const ev of m.events || []) {
    const arr = eventIndex.get(ev) || [];
    arr.push(m.id);
    eventIndex.set(ev, arr);
  }
}
export function modulesForEvent(type?: string): string[] {
  if (!type) return [];
  return eventIndex.get(type) || [];
}
