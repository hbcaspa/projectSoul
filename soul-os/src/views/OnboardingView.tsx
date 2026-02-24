import { useState, useCallback, useEffect } from "react";

/* ── Onboarding Steps ────────────────────────────────────── */

interface Step {
  id: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  panel: string;
}

const STEPS: Step[] = [
  {
    id: "brain",
    title: "Brain",
    description: "The central visualization. Every glowing node represents a part of your soul — axioms, memories, consciousness, dreams. Watch them pulse as the soul thinks.",
    icon: "M12 2a10 10 0 110 20 10 10 0 010-20z",
    color: "#00FFC8",
    panel: "brain",
  },
  {
    id: "card",
    title: "Card",
    description: "Your soul's identity card. Shows the compressed SEED.md — who the soul is, its axioms, current state, and memories. Everything in one glance.",
    icon: "M3 4h18v16H3z",
    color: "#DCDCFF",
    panel: "card",
  },
  {
    id: "whisper",
    title: "Whisper",
    description: "A live stream of the soul's thoughts. Every action — reading, writing, searching, dreaming — appears here in real-time. The soul's inner monologue, visible.",
    icon: "M2 12c1.5-3 3-4.5 4.5-4.5S9 10.5 10 12s2 4.5 3.5 4.5S16 15 17.5 12",
    color: "#6464FF",
    panel: "whisper",
  },
  {
    id: "chain",
    title: "Chain",
    description: "Peer-to-peer sync. If multiple instances of your soul run on different devices, Chain keeps them synchronized — encrypted, decentralized, no server needed.",
    icon: "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71",
    color: "#00FF64",
    panel: "chain",
  },
  {
    id: "impulse",
    title: "Impulse",
    description: "The soul's emotional and proactive system. Shows mood (valence + energy), reflection schedule, and how the soul learns from your feedback over time.",
    icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
    color: "#FF9600",
    panel: "impulse",
  },
  {
    id: "graph",
    title: "Graph",
    description: "The knowledge graph — a semantic network of everything the soul knows. People, concepts, projects, and the connections between them. Growing with every conversation.",
    icon: "M12 6a2 2 0 110 4 2 2 0 010-4z",
    color: "#00C8FF",
    panel: "graph",
  },
  {
    id: "terminal",
    title: "Terminal",
    description: "Full terminal access at the bottom of the screen. Run commands, check logs, manage files. The soul engine runs here. Cmd+T for new panes.",
    icon: "M4 17l6-5-6-5",
    color: "#8B80F0",
    panel: "terminal",
  },
];

/* ── Component ───────────────────────────────────────────── */

interface OnboardingViewProps {
  onDismiss: () => void;
}

export default function OnboardingView({ onDismiss }: OnboardingViewProps) {
  const [step, setStep] = useState(0);

  const next = useCallback(() => {
    if (step < STEPS.length - 1) setStep(step + 1);
  }, [step]);

  const prev = useCallback(() => {
    if (step > 0) setStep(step - 1);
  }, [step]);

  const current = STEPS[step];

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [next, prev, onDismiss]);

  return (
    <div className="h-full flex flex-col items-center justify-center px-12 py-8" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Progress dots */}
      <div className="flex items-center gap-2 mb-10">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            onClick={() => setStep(i)}
            className="w-2 h-2 rounded-full transition-all cursor-default"
            style={{
              backgroundColor: i === step ? current.color : "rgba(var(--white-rgb),0.1)",
              boxShadow: i === step ? `0 0 8px ${current.color}` : "none",
              transform: i === step ? "scale(1.3)" : "scale(1)",
            }}
          />
        ))}
      </div>

      {/* Icon */}
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center mb-8 transition-all duration-500"
        style={{
          background: `linear-gradient(135deg, ${current.color}14, ${current.color}08)`,
          border: `1px solid ${current.color}1F`,
          boxShadow: `0 4px 24px ${current.color}14`,
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-10 h-10" style={{ color: current.color, opacity: 0.7 }}>
          <path d={current.icon} />
        </svg>
      </div>

      {/* Step counter */}
      <div className="text-[10px] font-mono mb-3 tracking-wider" style={{ color: "var(--text-muted)" }}>
        {step + 1} / {STEPS.length}
      </div>

      {/* Title */}
      <h2
        className="text-2xl font-light mb-4 transition-all duration-300"
        style={{ color: current.color, textShadow: `0 0 20px ${current.color}4D` }}
      >
        {current.title}
      </h2>

      {/* Description */}
      <p
        className="text-sm leading-relaxed text-center max-w-md transition-all duration-300"
        style={{ color: "var(--text-dim)" }}
      >
        {current.description}
      </p>

      {/* Navigation */}
      <div className="flex items-center gap-4 mt-12">
        {step > 0 && (
          <button
            onClick={prev}
            className="text-xs px-5 py-2.5 rounded-xl cursor-default transition-all"
            style={{
              color: "var(--text-dim)",
              background: "linear-gradient(135deg, rgba(var(--white-rgb),0.04), rgba(var(--white-rgb),0.01))",
              border: "1px solid rgba(var(--white-rgb),0.06)",
            }}
          >
            Back
          </button>
        )}

        {step < STEPS.length - 1 ? (
          <button
            onClick={next}
            className="text-xs px-5 py-2.5 rounded-xl cursor-default transition-all"
            style={{
              color: current.color,
              background: `linear-gradient(135deg, ${current.color}1A, ${current.color}0A)`,
              border: `1px solid ${current.color}33`,
            }}
          >
            Next
          </button>
        ) : (
          <button
            onClick={onDismiss}
            className="text-xs px-5 py-2.5 rounded-xl cursor-default transition-all"
            style={{
              color: "var(--bewusstsein)",
              background: "linear-gradient(135deg, rgba(var(--neon-rgb),0.1), rgba(var(--neon-rgb),0.04))",
              border: "1px solid rgba(var(--neon-rgb),0.2)",
            }}
          >
            Start Exploring
          </button>
        )}
      </div>

      {/* Dismiss link */}
      <button
        onClick={onDismiss}
        className="mt-6 text-[10px] cursor-default transition-opacity hover:opacity-100"
        style={{ color: "var(--text-muted)", opacity: 0.5 }}
      >
        Don't show again
      </button>
    </div>
  );
}
