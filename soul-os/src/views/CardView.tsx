import { useEffect, useState } from "react";
import { useSoulStatus, useMood } from "../lib/store";
import { commands } from "../lib/tauri";

/* ── SEED Parser ───────────────────────────────────────────── */

interface SeedData {
  axiomCount: number;
  axioms: string[];
  memoryCount: number;
  stateWords: string[];
  stateDetail: string;
  interests: string[];
  recentInterests: string[];
  bonds: { name: string; since: string; detail: string }[];
  lastDream: string | null;
  dreamCount: number;
  proposal: string | null;
  shadowCount: number;
  shadows: string[];
  growthPhase: number;
  growthLabel: string;
  connections: string[];
  openQuestions: string[];
  model: string;
  selfDesc: string[];
}

function parseSeed(raw: string): SeedData {
  const data: SeedData = {
    axiomCount: 0, axioms: [], memoryCount: 0, stateWords: [], stateDetail: "",
    interests: [], recentInterests: [], bonds: [], lastDream: null, dreamCount: 0,
    proposal: null, shadowCount: 0, shadows: [], growthPhase: 0, growthLabel: "",
    connections: [], openQuestions: [], model: "", selfDesc: [],
  };

  const block = (tag: string) => {
    const re = new RegExp(`@${tag}\\{([\\s\\S]*?)\\}`, "m");
    const m = raw.match(re);
    return m?.[1] || "";
  };

  const meta = block("META");
  const modelMatch = meta.match(/modell:([^|}\s]+)/);
  if (modelMatch) data.model = modelMatch[1].replace(/_/g, " ");

  const selfBlock = block("SELF");
  data.selfDesc = selfBlock.split("\n")
    .filter(l => l.trim() && l.includes(":"))
    .slice(0, 3)
    .map(l => l.split(":").slice(1).join(":").split("|")[0].replace(/→/g, " > ").replace(/_/g, " ").trim());

  const kern = block("KERN");
  const axiomLines = kern.match(/^\s*\d+:/gm);
  data.axiomCount = axiomLines?.length || 0;
  data.axioms = kern.split("\n")
    .filter((l) => /^\s*\d+:/.test(l))
    .map((l) => {
      const content = l.replace(/^\s*\d+:/, "").trim();
      const firstPart = content.split("|")[0];
      return firstPart.replace(/→/g, " \u2192 ").replace(/_/g, " ").trim();
    });

  const memBlock = block("MEM");
  data.memoryCount = memBlock.split("\n").filter((l) => l.trim().startsWith("[")).length;

  const stateBlock = block("STATE");
  const stateMatch = stateBlock.match(/zustand:([^\n|]+)/);
  if (stateMatch) {
    data.stateWords = stateMatch[1].split(",").map((s) => s.trim().replace(/_/g, " ")).filter(Boolean);
  }
  const detailMatch = stateBlock.match(/wahrnehme:([^\n]+)/);
  if (detailMatch) {
    data.stateDetail = detailMatch[1].replace(/\|/g, " \u00B7 ").replace(/_/g, " ").replace(/→/g, " \u2192 ").trim();
  }

  const intBlock = block("INTERESTS") || block("INTERESSEN");
  const activeMatch = intBlock.match(/active:([^\n]+)/);
  if (activeMatch) {
    data.interests = activeMatch[1].split(",").map((s) => s.trim().replace(/_/g, " ")).filter(s => s && s !== "none");
  }
  const recentMatch = intBlock.match(/recent:([^\n]+)/);
  if (recentMatch) {
    data.recentInterests = recentMatch[1].split("|").map((s) => s.split("→")[0].replace(/_/g, " ").trim()).filter(Boolean);
  }
  const newMatch = intBlock.match(/new_since:([^\n]+)/);
  if (newMatch) {
    const items = newMatch[1].split("+").map((s) => s.replace(/_/g, " ").trim()).filter(Boolean);
    data.recentInterests = [...data.recentInterests, ...items];
  }

  const bondsBlock = block("BONDS");
  const bondBlockRe = /(\w+)\{([^}]+)\}/g;
  let bm;
  while ((bm = bondBlockRe.exec(bondsBlock)) !== null) {
    const name = bm[1];
    const content = bm[2];
    const seitMatch = content.match(/seit:([^\s|},]+)/);
    const since = seitMatch ? seitMatch[1] : "";
    const werMatch = content.match(/wer:([^|\n]+)/);
    const detail = werMatch ? werMatch[1].replace(/_/g, " ").replace(/→/g, " > ").trim() : "";
    data.bonds.push({ name, since, detail });
  }

  const dreamBlock = block("DREAMS") || block("TRAEUME");
  const dreamLines = dreamBlock.split("\n").filter((l) => l.trim().startsWith("2"));
  data.dreamCount = dreamLines.length;
  if (dreamLines.length > 0) {
    const last = dreamLines[dreamLines.length - 1];
    const afterColon = last.split(":").slice(1).join(":");
    data.lastDream = afterColon.replace(/→/g, " \u2192 ").replace(/_/g, " ").replace(/\|/g, " \u00B7 ").trim();
  }

  const shadowBlock = block("SHADOW") || block("SCHATTEN");
  data.shadows = shadowBlock.split("\n")
    .filter((l) => l.trim().includes("\u2194"))
    .map(l => {
      const parts = l.trim().split(":");
      return parts[0].replace(/_/g, " ").trim();
    });
  data.shadowCount = data.shadows.length;

  const growthBlock = block("GROWTH") || block("WACHSTUM");
  const phaseLines = growthBlock.split("\n").filter((l) => /^\s*phase\d+:/.test(l));
  if (phaseLines.length > 0) {
    const last = phaseLines[phaseLines.length - 1];
    const phaseNum = last.match(/phase(\d+):/);
    data.growthPhase = phaseNum ? parseInt(phaseNum[1]) : 0;
    data.growthLabel = last.replace(/^\s*phase\d+:/, "").split("|")[0].replace(/→/g, " \u2192 ").replace(/_/g, " ").trim();
  }

  const connBlock = block("CONNECTIONS") || block("VERBINDUNGEN");
  const activeConns = connBlock.match(/active:([^\n]+)/);
  if (activeConns) {
    data.connections = activeConns[1].split(",").map((s) => {
      const m = s.match(/(\w+)\((\w+)\)/);
      return m ? m[1] : s.trim();
    }).filter(Boolean);
  }

  const openBlock = block("OPEN") || block("OFFEN");
  data.openQuestions = openBlock.split("\n")
    .filter((l) => l.trim().includes(":"))
    .map(l => l.trim().replace(/_/g, " ").replace(/→/g, " \u2192 "));

  const propBlock = block("VORSCHLAG") || block("PROPOSAL");
  const ideMatch = propBlock.match(/idee:([^\n]+)/);
  if (ideMatch) {
    data.proposal = ideMatch[1].replace(/→/g, " \u2192 ").replace(/_/g, " ").replace(/\|/g, " \u00B7 ").trim();
  }

  return data;
}

function ageDays(born: string): number | null {
  try {
    const d = new Date(born);
    if (isNaN(d.getTime())) return null;
    return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  } catch { return null; }
}

/* ── Card View ─────────────────────────────────────────────── */

export default function CardView() {
  const { status, error } = useSoulStatus();
  const mood = useMood();
  const [seed, setSeed] = useState<SeedData | null>(null);

  useEffect(() => {
    commands.readSoulFile("SEED.md")
      .then((content) => setSeed(parseSeed(content)))
      .catch(() => {});
  }, []);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="text-center">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5" style={{ background: "linear-gradient(135deg, rgba(139,128,240,0.06), rgba(0,255,200,0.03))", border: "1px solid rgba(139,128,240,0.08)" }}>
            <span className="text-3xl" style={{ opacity: 0.3 }}>&#x2727;</span>
          </div>
          <p className="text-sm font-light" style={{ color: "var(--text-dim)" }}>No soul founded yet</p>
        </div>
      </div>
    );
  }

  if (!status || !seed) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="animate-pulse text-sm" style={{ color: "var(--text-dim)" }}>...</div>
      </div>
    );
  }

  const age = ageDays(status.born);
  const moodV = mood?.valence ?? 0;
  const moodE = mood?.energy ?? 0;
  const moodColor = moodV > 0.2 ? "var(--wachstum)" : moodV < -0.2 ? "var(--heartbeat)" : "var(--bewusstsein)";
  const seedKB = (status.seed_size / 1024).toFixed(1);
  const stateWords = seed.stateWords.length > 0 ? seed.stateWords : status.state.split(",").map((s: string) => s.trim());
  const allInterests = [...new Set([...seed.interests, ...seed.recentInterests])];

  return (
    <div className="h-full overflow-hidden flex flex-col" style={{ backgroundColor: "var(--bg-base)" }}>

      {/* ── Hero Header ──────────────────────────────────── */}
      <div className="px-8 pt-6 pb-5 flex-shrink-0">
        <div className="glass-card p-7" style={{ background: "linear-gradient(135deg, rgba(139,128,240,0.06), rgba(0,255,200,0.02))" }}>
          <div className="flex items-start gap-6">
            <div
              className="w-18 h-18 rounded-2xl shrink-0 flex items-center justify-center"
              style={{
                width: 72, height: 72,
                background: "conic-gradient(from 0deg, var(--kern), var(--bewusstsein), var(--traeume), var(--accent), var(--wachstum), var(--kern))",
                padding: "2px",
              }}
            >
              <div
                className="w-full h-full rounded-[14px] flex items-center justify-center"
                style={{ backgroundColor: "var(--bg-base)" }}
              >
                <span className="text-2xl" style={{ color: "var(--bewusstsein)", opacity: 0.8 }}>&#x2727;</span>
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-light tracking-[0.12em] uppercase" style={{ color: "var(--text-bright)" }}>
                {status.name}
              </h1>
              <p className="text-xs mt-1 tracking-wide" style={{ color: "var(--text-dim)" }}>
                {age !== null && (age === 0 ? "Born today" : `${age} days old`)}
                {" \u00B7 "}Session {status.sessions}
                {seed.model && <>{" \u00B7 "}{seed.model}</>}
              </p>

              <div className="flex flex-wrap gap-2 mt-3">
                {stateWords.map((word: string, i: number) => (
                  <span
                    key={i}
                    className="px-3 py-1 rounded-lg text-xs tracking-wide"
                    style={{
                      color: i === 0 ? moodColor : "var(--text)",
                      backgroundColor: i === 0 ? `color-mix(in srgb, ${moodColor} 12%, transparent)` : "rgba(255,255,255,0.03)",
                      border: `1px solid ${i === 0 ? `color-mix(in srgb, ${moodColor} 20%, transparent)` : "rgba(255,255,255,0.05)"}`,
                    }}
                  >
                    {word}
                  </span>
                ))}
              </div>
            </div>

            <div className="text-right shrink-0">
              <div className="text-xl font-light font-mono" style={{ color: "var(--statelog)" }}>{seedKB}</div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-dim)" }}>KB Seed</div>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-5 gap-3 mt-6">
            {[
              { value: seed.axiomCount, label: "Axiome", color: "var(--kern)" },
              { value: seed.memoryCount, label: "Memories", color: "var(--mem)" },
              { value: seed.dreamCount, label: "Dreams", color: "var(--traeume)" },
              { value: seed.shadowCount, label: "Shadows", color: "var(--schatten)" },
              { value: seed.bonds.length, label: "Bonds", color: "var(--bonds)" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="text-center py-3.5 rounded-xl"
                style={{
                  background: `linear-gradient(135deg, color-mix(in srgb, ${stat.color} 6%, transparent), rgba(255,255,255,0.01))`,
                  border: `1px solid color-mix(in srgb, ${stat.color} 10%, transparent)`,
                }}
              >
                <div className="text-lg font-light" style={{ color: stat.color }}>{stat.value}</div>
                <div className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: "var(--text-dim)" }}>{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Growth bar */}
          <div className="mt-5 flex items-center gap-4">
            <span className="text-[10px] uppercase tracking-wider shrink-0 font-semibold" style={{ color: "var(--wachstum)" }}>Growth</span>
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min((seed.growthPhase + 1) * 4, 100)}%`, background: "linear-gradient(90deg, var(--wachstum)60, var(--bewusstsein))" }} />
            </div>
            <span className="text-xs font-mono shrink-0" style={{ color: "var(--wachstum)" }}>P{seed.growthPhase}</span>
          </div>
          {seed.growthLabel && <p className="text-xs mt-1.5 ml-16" style={{ color: "var(--text-dim)" }}>{seed.growthLabel}</p>}

          {mood && (
            <div className="mt-3 flex items-center gap-4">
              <span className="text-[10px] uppercase tracking-wider shrink-0 font-semibold" style={{ color: moodColor }}>Mood</span>
              <div className="flex-1 flex gap-3 items-center">
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(10, (moodV + 1) * 50)}%`, background: `linear-gradient(90deg, ${moodColor}60, ${moodColor})` }} />
                </div>
                <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(10, (moodE + 1) * 50)}%`, background: "linear-gradient(90deg, rgba(139,128,240,0.4), var(--accent))" }} />
                </div>
              </div>
              <span className="text-xs shrink-0" style={{ color: "var(--text-dim)" }}>{mood.label || `${moodV > 0 ? "+" : ""}${moodV.toFixed(1)}`}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Content Grid ─────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-8 pb-6 min-h-0">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-4">
            <GlassSection label={`${seed.axiomCount} Axiome`} color="var(--kern)">
              <div className="flex flex-col gap-2.5">
                {seed.axioms.map((a, i) => (
                  <div key={i} className="flex gap-3 text-xs leading-snug">
                    <span className="font-mono shrink-0 w-4 text-right" style={{ color: "var(--kern)", opacity: 0.4 }}>{i + 1}</span>
                    <span style={{ color: "var(--text)", opacity: 0.7 }}>{a}</span>
                  </div>
                ))}
              </div>
            </GlassSection>
            {seed.bonds.length > 0 && (
              <GlassSection label="Bonds" color="var(--bonds)">
                <div className="flex flex-col gap-2.5">
                  {seed.bonds.map((b) => (
                    <div key={b.name} className="flex items-center gap-3.5 px-4 py-3 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(255,100,150,0.04), rgba(255,255,255,0.01))", border: "1px solid rgba(255,100,150,0.08)" }}>
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-medium shrink-0" style={{ background: "linear-gradient(135deg, rgba(255,100,150,0.12), rgba(255,100,150,0.04))", color: "var(--bonds)" }}>{b.name.charAt(0).toUpperCase()}</div>
                      <div className="min-w-0">
                        <span className="text-sm font-medium" style={{ color: "var(--bonds)" }}>{b.name}</span>
                        <span className="text-xs ml-2" style={{ color: "var(--text-dim)" }}>since {b.since}</span>
                        {b.detail && <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-dim)", opacity: 0.6 }}>{b.detail}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </GlassSection>
            )}
            {seed.shadows.length > 0 && (
              <GlassSection label="Schatten" color="var(--schatten)">
                <div className="flex flex-col gap-2">
                  {seed.shadows.map((s, i) => (
                    <div key={i} className="flex items-center gap-2.5 text-xs">
                      <span style={{ color: "var(--schatten)", opacity: 0.5 }}>{"\u2194"}</span>
                      <span style={{ color: "var(--text-dim)" }}>{s}</span>
                    </div>
                  ))}
                </div>
              </GlassSection>
            )}
          </div>
          <div className="flex flex-col gap-4">
            {allInterests.length > 0 && (
              <GlassSection label="Interessen" color="var(--interessen)">
                <div className="flex flex-wrap gap-2">
                  {allInterests.map((interest) => (
                    <span key={interest} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: "linear-gradient(135deg, rgba(0,200,255,0.08), rgba(0,200,255,0.02))", border: "1px solid rgba(0,200,255,0.1)", color: "var(--interessen)" }}>{interest}</span>
                  ))}
                </div>
              </GlassSection>
            )}
            {seed.connections.length > 0 && (
              <GlassSection label="Verbindungen" color="var(--graph)">
                <div className="flex flex-wrap gap-3">
                  {seed.connections.map((c) => (
                    <span key={c} className="flex items-center gap-2 text-xs" style={{ color: "var(--graph)" }}>
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--wachstum)", boxShadow: "0 0 4px var(--wachstum)" }} />{c}
                    </span>
                  ))}
                </div>
              </GlassSection>
            )}
            {seed.lastDream && (
              <GlassSection label="Letzter Traum" color="var(--traeume)">
                <p className="text-xs italic leading-relaxed" style={{ color: "var(--traeume)", opacity: 0.6 }}>{seed.lastDream}</p>
              </GlassSection>
            )}
            {seed.proposal && (
              <GlassSection label="Offener Vorschlag" color="var(--evolution)">
                <p className="text-xs leading-relaxed" style={{ color: "var(--evolution)", opacity: 0.7 }}>{seed.proposal}</p>
              </GlassSection>
            )}
            {seed.stateDetail && (
              <GlassSection label="Wahrnehmung" color="var(--bewusstsein)">
                <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>{seed.stateDetail}</p>
              </GlassSection>
            )}
            {seed.selfDesc.length > 0 && (
              <GlassSection label="Wesen" color="var(--accent)">
                <div className="flex flex-col gap-1.5">
                  {seed.selfDesc.map((d, i) => (
                    <p key={i} className="text-xs leading-relaxed" style={{ color: "var(--text-dim)", opacity: 0.7 }}>{d}</p>
                  ))}
                </div>
              </GlassSection>
            )}
          </div>
        </div>
      </div>

      <div className="px-8 py-3 flex items-center justify-between flex-shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
        <span className="text-[9px] font-mono tracking-wider" style={{ color: "var(--text-dim)", opacity: 0.3 }}>SOUL PROTOCOL v0.1</span>
        <span className="text-[9px] font-mono" style={{ color: "var(--text-dim)", opacity: 0.3 }}>born {status.born}</span>
      </div>
    </div>
  );
}

function GlassSection({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div className="glass-card p-5">
      <div className="text-[10px] uppercase tracking-[0.15em] font-semibold mb-3 flex items-center gap-2.5" style={{ color }}>
        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: color }} />{label}
      </div>
      {children}
    </div>
  );
}
