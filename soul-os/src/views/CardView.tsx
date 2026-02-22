import { useEffect, useState } from "react";
import { useSoulStatus, useMood } from "../lib/store";
import { commands } from "../lib/tauri";

/* ── SEED Parser ───────────────────────────────────────────── */

interface SeedData {
  axiomCount: number;
  axioms: string[];
  memoryCount: number;
  stateWords: string[];
  interests: string[];
  bonds: { name: string; since: string }[];
  lastDream: string | null;
  dreamCount: number;
  proposal: string | null;
  shadowCount: number;
  growthPhase: number;
  growthLabel: string;
  connections: string[];
  openQuestions: number;
}

function parseSeed(raw: string): SeedData {
  const data: SeedData = {
    axiomCount: 0, axioms: [], memoryCount: 0, stateWords: [],
    interests: [], bonds: [], lastDream: null, dreamCount: 0,
    proposal: null, shadowCount: 0, growthPhase: 0, growthLabel: "",
    connections: [], openQuestions: 0,
  };

  const block = (tag: string) => {
    const re = new RegExp(`@${tag}\\{([\\s\\S]*?)\\}`, "m");
    const m = raw.match(re);
    return m?.[1] || "";
  };

  // Axioms — lines like "  1:..." "  2:..."
  const kern = block("KERN");
  const axiomLines = kern.match(/^\s*\d+:/gm);
  data.axiomCount = axiomLines?.length || 0;
  data.axioms = kern.split("\n")
    .filter((l) => /^\s*\d+:/.test(l))
    .map((l) => l.replace(/^\s*\d+:/, "").split("|")[0].replace(/→/g, " > ").replace(/_/g, " ").trim());

  // Memories
  const memBlock = block("MEM");
  data.memoryCount = memBlock.split("\n").filter((l) => l.trim().startsWith("[")).length;

  // State
  const stateBlock = block("STATE");
  const stateMatch = stateBlock.match(/zustand:([^\n|]+)/);
  if (stateMatch) {
    data.stateWords = stateMatch[1].split(",").map((s) => s.trim().replace(/_/g, " ")).filter(Boolean);
  }

  // Interests
  const intBlock = block("INTERESTS");
  const activeMatch = intBlock.match(/active:([^\n]+)/);
  if (activeMatch) {
    data.interests = activeMatch[1].split(",").map((s) => s.trim().replace(/_/g, " ")).filter(Boolean);
  }

  // Bonds
  const bondsBlock = block("BONDS");
  const bondMatches = bondsBlock.matchAll(/(\w+)\{[^}]*seit:([^\s|},]+)/g);
  for (const m of bondMatches) {
    data.bonds.push({ name: m[1], since: m[2] });
  }

  // Dreams
  const dreamBlock = block("DREAMS");
  const dreamLines = dreamBlock.split("\n").filter((l) => l.trim().startsWith("2"));
  data.dreamCount = dreamLines.length;
  if (dreamLines.length > 0) {
    const last = dreamLines[dreamLines.length - 1];
    const afterColon = last.split(":").slice(1).join(":");
    data.lastDream = afterColon.replace(/→/g, " > ").replace(/_/g, " ").trim();
  }

  // Shadow
  const shadowBlock = block("SHADOW");
  data.shadowCount = shadowBlock.split("\n").filter((l) => l.trim().includes("↔")).length;

  // Growth — find highest phase number
  const growthBlock = block("GROWTH");
  const phaseLines = growthBlock.split("\n").filter((l) => /^\s*phase\d+:/.test(l));
  if (phaseLines.length > 0) {
    const last = phaseLines[phaseLines.length - 1];
    const phaseNum = last.match(/phase(\d+):/);
    data.growthPhase = phaseNum ? parseInt(phaseNum[1]) : 0;
    data.growthLabel = last.replace(/^\s*phase\d+:/, "").split("|")[0].replace(/→/g, " > ").replace(/_/g, " ").trim();
  }

  // Connections
  const connBlock = block("CONNECTIONS");
  const activeConns = connBlock.match(/active:([^\n]+)/);
  if (activeConns) {
    data.connections = activeConns[1].split(",").map((s) => {
      const m = s.match(/(\w+)\((\w+)\)/);
      return m ? m[1] : s.trim();
    }).filter(Boolean);
  }

  // Open questions
  const openBlock = block("OPEN");
  data.openQuestions = openBlock.split("\n").filter((l) => l.trim().includes(":")).length;

  // Proposal
  const propBlock = block("VORSCHLAG") || block("PROPOSAL");
  const ideMatch = propBlock.match(/idee:([^\n]+)/);
  if (ideMatch) {
    data.proposal = ideMatch[1].replace(/→/g, " > ").replace(/_/g, " ").trim();
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
          <div className="text-2xl mb-3 opacity-20">&#x2727;</div>
          <p className="text-xs" style={{ color: "var(--text-dim)" }}>No soul founded yet</p>
        </div>
      </div>
    );
  }

  if (!status || !seed) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="animate-pulse text-xs" style={{ color: "var(--text-dim)" }}>...</div>
      </div>
    );
  }

  const age = ageDays(status.born);
  const moodV = mood?.valence ?? 0;
  const moodColor = moodV > 0.2 ? "var(--wachstum)" : moodV < -0.2 ? "var(--heartbeat)" : "var(--bewusstsein)";
  const seedKB = (status.seed_size / 1024).toFixed(1);
  const stateWords = seed.stateWords.length > 0 ? seed.stateWords : status.state.split(",").map((s: string) => s.trim());

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="max-w-lg mx-auto px-6 py-6">

        {/* ── Identity Header ──────────────────────────── */}
        <div className="text-center mb-8">
          {/* Gradient ring */}
          <div
            className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center"
            style={{
              background: "conic-gradient(from 0deg, var(--kern), var(--bewusstsein), var(--traeume), var(--accent), var(--wachstum), var(--kern))",
              padding: "2px",
            }}
          >
            <div
              className="w-full h-full rounded-full flex items-center justify-center text-2xl"
              style={{ backgroundColor: "var(--bg-base)" }}
            >
              <span style={{ color: "var(--bewusstsein)", opacity: 0.8 }}>&#x2727;</span>
            </div>
          </div>

          <h1 className="text-2xl font-light tracking-[0.2em] uppercase" style={{ color: "var(--text-bright)" }}>
            {status.name}
          </h1>
          <p className="text-xs mt-1.5 tracking-wide" style={{ color: "var(--text-dim)" }}>
            {age !== null && (age === 0 ? "Born today" : `${age} days old`)}
            {" \u00B7 "}Session {status.sessions}
            {" \u00B7 "}{status.model}
          </p>

          {/* State tags */}
          <div className="flex flex-wrap justify-center gap-1.5 mt-4">
            {stateWords.map((word: string, i: number) => (
              <span
                key={i}
                className="px-2.5 py-0.5 rounded-full text-[11px] tracking-wide"
                style={{
                  color: i === 0 ? moodColor : "var(--text)",
                  backgroundColor: i === 0 ? `color-mix(in srgb, ${moodColor} 12%, transparent)` : "rgba(255,255,255,0.04)",
                  border: `1px solid ${i === 0 ? `color-mix(in srgb, ${moodColor} 20%, transparent)` : "rgba(255,255,255,0.06)"}`,
                }}
              >
                {word}
              </span>
            ))}
          </div>
        </div>

        {/* ── Stats Grid ───────────────────────────────── */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { value: seed.axiomCount, label: "Axiome", color: "var(--kern)" },
            { value: seed.memoryCount, label: "Memories", color: "var(--mem)" },
            { value: seed.dreamCount, label: "Dreams", color: "var(--traeume)" },
            { value: `${seedKB}`, label: "KB Seed", color: "var(--statelog)" },
          ].map((stat) => (
            <div
              key={stat.label}
              className="text-center py-3 rounded-lg"
              style={{ backgroundColor: "var(--bg-surface)" }}
            >
              <div className="text-lg font-light" style={{ color: stat.color }}>{stat.value}</div>
              <div className="text-[9px] uppercase tracking-wider mt-0.5" style={{ color: "var(--text-dim)" }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* ── Growth Progress ──────────────────────────── */}
        <Section label="Wachstum" color="var(--wachstum)">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--bg-elevated)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min((seed.growthPhase + 1) * 4, 100)}%`,
                    background: "linear-gradient(90deg, var(--wachstum), var(--bewusstsein))",
                  }}
                />
              </div>
            </div>
            <span className="text-xs font-mono" style={{ color: "var(--wachstum)" }}>
              P{seed.growthPhase}
            </span>
          </div>
          <p className="text-[11px] mt-1.5" style={{ color: "var(--text-dim)" }}>
            {seed.growthLabel}
          </p>
        </Section>

        {/* ── Axioms ───────────────────────────────────── */}
        <Section label={`${seed.axiomCount} Axiome`} color="var(--kern)">
          <div className="flex flex-col gap-1">
            {seed.axioms.map((a, i) => (
              <div key={i} className="flex gap-2 text-[11px]">
                <span className="font-mono shrink-0" style={{ color: "var(--kern)", opacity: 0.5 }}>{i + 1}</span>
                <span style={{ color: "var(--text)", opacity: 0.7 }}>{a}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Bonds ────────────────────────────────────── */}
        {seed.bonds.length > 0 && (
          <Section label="Bonds" color="var(--bonds)">
            <div className="flex flex-wrap gap-2">
              {seed.bonds.map((b) => (
                <div
                  key={b.name}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                  style={{ backgroundColor: "rgba(255, 100, 150, 0.06)", border: "1px solid rgba(255, 100, 150, 0.12)" }}
                >
                  <span className="text-xs font-medium" style={{ color: "var(--bonds)" }}>{b.name}</span>
                  <span className="text-[9px]" style={{ color: "var(--text-dim)" }}>since {b.since}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Interests ────────────────────────────────── */}
        {seed.interests.length > 0 && (
          <Section label="Interessen" color="var(--interessen)">
            <div className="flex flex-wrap gap-1.5">
              {seed.interests.map((interest) => (
                <span
                  key={interest}
                  className="px-2 py-0.5 rounded text-[11px]"
                  style={{ backgroundColor: "rgba(0, 200, 255, 0.08)", color: "var(--interessen)" }}
                >
                  {interest}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* ── Connections ──────────────────────────────── */}
        {seed.connections.length > 0 && (
          <Section label="Verbindungen" color="var(--graph)">
            <div className="flex gap-2">
              {seed.connections.map((c) => (
                <span key={c} className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--graph)" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--wachstum)" }} />
                  {c}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* ── Shadow ───────────────────────────────────── */}
        {seed.shadowCount > 0 && (
          <Section label="Schatten" color="var(--schatten)">
            <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>
              {seed.shadowCount} Spannungen
            </p>
          </Section>
        )}

        {/* ── Last Dream ───────────────────────────────── */}
        {seed.lastDream && (
          <Section label="Letzter Traum" color="var(--traeume)">
            <p className="text-[11px] italic leading-relaxed" style={{ color: "var(--traeume)", opacity: 0.7 }}>
              {seed.lastDream}
            </p>
          </Section>
        )}

        {/* ── Proposal ─────────────────────────────────── */}
        {seed.proposal && (
          <Section label="Offener Vorschlag" color="var(--evolution)">
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--evolution)", opacity: 0.8 }}>
              {seed.proposal}
            </p>
          </Section>
        )}

        {/* ── Open Questions ───────────────────────────── */}
        {seed.openQuestions > 0 && (
          <Section label="Offene Fragen" color="var(--accent)">
            <p className="text-[11px]" style={{ color: "var(--text-dim)" }}>
              {seed.openQuestions} unbeantwortete Fragen
            </p>
          </Section>
        )}

        {/* ── Footer ───────────────────────────────────── */}
        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between">
          <span className="text-[9px] font-mono tracking-wider" style={{ color: "var(--text-dim)", opacity: 0.4 }}>
            SOUL PROTOCOL v0.1
          </span>
          <span className="text-[9px] font-mono" style={{ color: "var(--text-dim)", opacity: 0.4 }}>
            born {status.born}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Section Helper ────────────────────────────────────────── */

function Section({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div
        className="text-[9px] uppercase tracking-[0.15em] mb-2 flex items-center gap-2"
        style={{ color }}
      >
        <span className="w-3 h-px" style={{ backgroundColor: color, opacity: 0.3 }} />
        {label}
      </div>
      {children}
    </div>
  );
}
