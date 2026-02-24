import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

interface FoundingState { hasSeed: boolean; hasLanguage: boolean; checking: boolean; }

export default function FoundingView() {
  const [state, setState] = useState<FoundingState>({ hasSeed: false, hasLanguage: false, checking: true });

  useEffect(() => { checkState(); }, []);

  const checkState = async () => {
    let hasSeed = false, hasLanguage = false;
    try { await commands.readSoulFile("SEED.md"); hasSeed = true; } catch {}
    try { await commands.readSoulFile(".language"); hasLanguage = true; } catch {}
    setState({ hasSeed, hasLanguage, checking: false });
  };

  if (state.checking) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="animate-pulse text-sm" style={{ color: "var(--text-dim)" }}>...</div>
      </div>
    );
  }

  if (state.hasSeed) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="text-center max-w-md">
          <div className="w-20 h-20 mx-auto mb-6 rounded-3xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--accent-rgb),0.08), rgba(var(--neon-rgb),0.04))", border: "1px solid rgba(var(--accent-rgb),0.1)", boxShadow: "0 4px 24px rgba(var(--accent-rgb),0.08)" }}>
            <span className="text-3xl" style={{ opacity: 0.5 }}>&#x2728;</span>
          </div>
          <h2 className="text-xl font-light mb-3" style={{ color: "var(--text-bright)" }}>Soul Already Founded</h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>This soul has already been through the founding interview. The SEED.md carries its identity across sessions.</p>
          <p className="text-xs mt-5" style={{ color: "var(--text-muted)" }}>To refound, delete SEED.md and restart. This is irreversible.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="text-center max-w-lg px-8">
        <div className="w-24 h-24 mx-auto mb-8 rounded-3xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(var(--accent-rgb),0.08), rgba(var(--neon-rgb),0.05))", border: "1px solid rgba(var(--accent-rgb),0.1)", boxShadow: "0 8px 32px rgba(var(--accent-rgb),0.1)" }}>
          <span className="text-4xl">&#x1F331;</span>
        </div>
        <h1 className="text-2xl font-light tracking-wide mb-3" style={{ color: "var(--text-bright)" }}>Soul Protocol</h1>
        <p className="text-sm leading-relaxed mb-8" style={{ color: "var(--text-dim)" }}>No soul has been founded yet. The founding interview discovers the core axioms that will define this soul.</p>

        <div className="flex flex-col gap-3 mb-8 max-w-sm mx-auto">
          {[
            { num: "1", label: "Language", desc: "Deutsch or English", color: "#FF3C3C" },
            { num: "2", label: "Interview", desc: "Three rounds of conversation", color: "#00FFC8" },
            { num: "3", label: "First Seed", desc: "Identity compressed into SEED.md", color: "#DCDCFF" },
          ].map((step) => (
            <div key={step.num} className="glass-card glass-card-hover flex items-center gap-5 text-left px-6 py-5">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-medium shrink-0" style={{ background: `linear-gradient(135deg, ${step.color}26, ${step.color}0D)`, color: step.color, border: `1px solid ${step.color}26` }}>
                {step.num}
              </span>
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text-bright)" }}>{step.label}</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--text-dim)" }}>{step.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-sm mb-4" style={{ color: "var(--text)" }}>Open the <span style={{ color: "var(--accent)" }}>Terminal</span> and run:</p>
        <div className="glass-card inline-block px-8 py-4 font-mono text-sm" style={{ background: "linear-gradient(135deg, rgba(var(--accent-rgb),0.08), rgba(var(--accent-rgb),0.02))", color: "var(--accent)" }}>
          npx soul-engine found
        </div>
        <p className="text-xs mt-8" style={{ color: "var(--text-muted)" }}>Takes about 20-30 minutes</p>
      </div>
    </div>
  );
}
