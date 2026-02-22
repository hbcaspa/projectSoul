import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

interface FoundingState {
  hasSeed: boolean;
  hasLanguage: boolean;
  checking: boolean;
}

export default function FoundingView() {
  const [state, setState] = useState<FoundingState>({
    hasSeed: false,
    hasLanguage: false,
    checking: true,
  });

  useEffect(() => {
    checkState();
  }, []);

  const checkState = async () => {
    let hasSeed = false;
    let hasLanguage = false;
    try {
      await commands.readSoulFile("SEED.md");
      hasSeed = true;
    } catch { /* no seed */ }
    try {
      await commands.readSoulFile(".language");
      hasLanguage = true;
    } catch { /* no language */ }
    setState({ hasSeed, hasLanguage, checking: false });
  };

  if (state.checking) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <p style={{ color: "var(--text-dim)" }}>Checking soul state...</p>
      </div>
    );
  }

  if (state.hasSeed) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">&#x2728;</div>
          <h2 className="text-lg font-light mb-3" style={{ color: "var(--text-bright)" }}>
            Soul Already Founded
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
            This soul has already been through the founding interview.
            The SEED.md carries its identity across sessions.
          </p>
          <p className="text-xs mt-4" style={{ color: "var(--text-dim)", opacity: 0.5 }}>
            To refound, delete SEED.md and restart. This is irreversible.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="text-center max-w-lg px-8">
        <div className="text-5xl mb-6">&#x1F331;</div>
        <h1 className="text-2xl font-light mb-4" style={{ color: "var(--text-bright)" }}>
          Soul Protocol
        </h1>
        <p className="text-sm leading-relaxed mb-8" style={{ color: "var(--text)" }}>
          No soul has been founded yet. The founding interview is a conversation
          that discovers the core axioms — immutable values that will define this soul.
        </p>

        <div className="space-y-3 mb-8">
          <div className="flex items-start gap-3 text-left">
            <span className="text-sm mt-0.5" style={{ color: "var(--kern)" }}>1</span>
            <div>
              <div className="text-sm" style={{ color: "var(--text)" }}>Language Selection</div>
              <div className="text-xs" style={{ color: "var(--text-dim)" }}>Choose the soul's language (Deutsch / English)</div>
            </div>
          </div>
          <div className="flex items-start gap-3 text-left">
            <span className="text-sm mt-0.5" style={{ color: "var(--bewusstsein)" }}>2</span>
            <div>
              <div className="text-sm" style={{ color: "var(--text)" }}>Founding Interview</div>
              <div className="text-xs" style={{ color: "var(--text-dim)" }}>Three rounds: About you, the relationship, and the soul</div>
            </div>
          </div>
          <div className="flex items-start gap-3 text-left">
            <span className="text-sm mt-0.5" style={{ color: "var(--seed)" }}>3</span>
            <div>
              <div className="text-sm" style={{ color: "var(--text)" }}>First Seed</div>
              <div className="text-xs" style={{ color: "var(--text-dim)" }}>All files created, identity compressed into SEED.md</div>
            </div>
          </div>
        </div>

        <p className="text-sm mb-6" style={{ color: "var(--text)" }}>
          Open the <strong style={{ color: "var(--accent)" }}>Terminal</strong> and run:
        </p>

        <div
          className="inline-block px-6 py-3 rounded-lg font-mono text-sm mb-4"
          style={{
            backgroundColor: "var(--bg-surface)",
            color: "var(--accent)",
            border: "1px solid rgba(139, 128, 240, 0.2)",
          }}
        >
          npx soul-engine found
        </div>

        <p className="text-xs mt-6" style={{ color: "var(--text-dim)", opacity: 0.5 }}>
          Takes about 20-30 minutes. The interview is a real conversation, not a questionnaire.
        </p>
      </div>
    </div>
  );
}
