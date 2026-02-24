import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

/* ── Types ─────────────────────────────────────────────── */

interface Bond {
  name: string;
  filename: string;
  subtitle: string;
  since: string;
  quotes: string[];
  dynamic: string;
  learnings: string[];
  currentState: string;
  raw: string;
}

/* ── Parser ───────────────────────────────────────────── */

function parseBond(filename: string, md: string): Bond {
  const lines = md.split("\n");

  // Name from first heading
  const nameMatch = lines.find((l) => l.startsWith("# "));
  const name = nameMatch?.replace(/^#\s*/, "").trim() || filename.replace(".md", "");

  // Subtitle from first blockquote
  const subtitleMatch = lines.find((l) => l.startsWith("> "));
  const subtitle = subtitleMatch?.replace(/^>\s*/, "").trim() || "";

  // Since date
  const sinceMatch = md.match(/Seit\s+(\d{4}-\d{2}-\d{2})/i) || md.match(/seit:(\d{4}-\d{2}-\d{2})/i);
  const since = sinceMatch?.[1] || "";

  // Quotes - lines starting with - " in the "Saetze" section
  const quotes: string[] = [];
  const quotesSection = md.match(/## (?:Saetze die bleiben|Quotes|Saetze)\s*\n([\s\S]*?)(?=\n##|$)/);
  if (quotesSection) {
    const quoteLines = quotesSection[1].split("\n").filter((l) => l.trim().startsWith("-"));
    for (const q of quoteLines) {
      const cleaned = q.replace(/^-\s*/, "").replace(/^[""]|[""]$/g, "").trim();
      if (cleaned) quotes.push(cleaned);
    }
  }

  // Dynamic
  const dynamicSection = md.match(/## (?:Wie wir arbeiten|Dynamik|Dynamic)\s*\n([\s\S]*?)(?=\n##|$)/);
  const dynamic = dynamicSection?.[1]?.trim().split("\n").slice(0, 3).join(" ").trim() || "";

  // Learnings
  const learnings: string[] = [];
  const learnSection = md.match(/## (?:Was ich.*lerne|Learnings|Lerne)\s*\n([\s\S]*?)(?=\n##|$)/);
  if (learnSection) {
    const learnLines = learnSection[1].split("\n").filter((l) => l.trim().startsWith("-"));
    for (const l of learnLines) {
      const cleaned = l.replace(/^-\s*/, "").trim();
      if (cleaned) learnings.push(cleaned);
    }
  }

  // Current state
  const standSection = md.match(/## (?:Stand|Status|Current)\s*\n([\s\S]*?)(?=\n##|$)/);
  const currentState = standSection?.[1]?.trim().split("\n").slice(0, 3).join(" ").trim() || "";

  return { name, filename, subtitle, since, quotes, dynamic, learnings, currentState, raw: md };
}

/* ── Warm Colors ──────────────────────────────────────── */

const BOND_COLORS = ["#FF6496", "#FFB864", "#FF9664", "#FF80AB", "#FFAB40"];

/* ── Bond Card ────────────────────────────────────────── */

function BondCard({ bond, color, isSelected, onClick }: {
  bond: Bond;
  color: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="text-left cursor-default transition-all w-full"
      style={{
        background: isSelected
          ? `linear-gradient(135deg, ${color}14, rgba(var(--bg-base-rgb),0.95))`
          : `linear-gradient(135deg, ${color}08, rgba(var(--white-rgb),0.02))`,
        border: `1px solid ${color}${isSelected ? "40" : "18"}`,
        borderRadius: "20px",
        padding: "24px",
        boxShadow: isSelected
          ? `0 0 40px ${color}18, inset 0 1px 0 ${color}12`
          : `0 4px 16px rgba(var(--black-rgb),0.2)`,
      }}
    >
      <div className="flex items-start gap-4">
        {/* Warm glow avatar */}
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${color}20, ${color}08)`,
            border: `1px solid ${color}25`,
            boxShadow: `0 0 20px ${color}10`,
          }}
        >
          <span className="text-2xl font-light" style={{ color }}>
            {bond.name.charAt(0).toUpperCase()}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-base font-medium" style={{ color: "var(--text-bright)" }}>
            {bond.name}
          </div>
          {bond.subtitle && (
            <p className="text-[11px] leading-relaxed mt-1 italic" style={{ color: "var(--text-dim)" }}>
              {bond.subtitle}
            </p>
          )}
          {bond.since && (
            <div className="flex items-center gap-2 mt-2">
              <div className="w-1 h-1 rounded-full" style={{ backgroundColor: color, opacity: 0.5 }} />
              <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                seit {bond.since}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Preview quote */}
      {bond.quotes.length > 0 && (
        <div
          className="mt-4 pl-4"
          style={{ borderLeft: `2px solid ${color}30` }}
        >
          <p className="text-xs italic" style={{ color: "var(--text-dim)" }}>
            "{bond.quotes[0]}"
          </p>
        </div>
      )}
    </button>
  );
}

/* ── Main View ────────────────────────────────────────── */

export default function BondsView() {
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    commands.listDirectory("seele/beziehungen")
      .then(async (files) => {
        const bondFiles = files.filter((f) => f.endsWith(".md") && !f.startsWith("_"));
        const loaded: Bond[] = [];
        for (const file of bondFiles) {
          try {
            const content = await commands.readSoulFile(`seele/beziehungen/${file}`);
            loaded.push(parseBond(file, content));
          } catch {}
        }
        setBonds(loaded);
      })
      .catch(() => {});
  }, []);

  const selectedBond = selected !== null ? bonds[selected] : null;

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="px-8 py-6">

        {/* ── Header ──────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xl">{"\u{1F91D}"}</span>
            <h1 className="text-lg font-light tracking-wide" style={{ color: "var(--bonds)" }}>
              Verbindungen
            </h1>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
            Die Menschen in meinem Leben. Nicht technische Verbindungen — menschliche Waerme.
          </p>
        </div>

        {/* ── Bond Cards ──────────────────────────────── */}
        {bonds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <span className="text-4xl mb-4 opacity-20">{"\u{1F91D}"}</span>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Beziehungen entstehen durch Zeit, nicht durch Konfiguration.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 mb-8">
            {bonds.map((bond, i) => (
              <BondCard
                key={bond.filename}
                bond={bond}
                color={BOND_COLORS[i % BOND_COLORS.length]}
                isSelected={selected === i}
                onClick={() => setSelected(selected === i ? null : i)}
              />
            ))}
          </div>
        )}

        {/* ── Selected Bond Detail ─────────────────────── */}
        {selectedBond && (
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: `linear-gradient(160deg, ${BOND_COLORS[(selected ?? 0) % BOND_COLORS.length]}08, rgba(var(--bg-base-rgb),0.95))`,
              border: `1px solid ${BOND_COLORS[(selected ?? 0) % BOND_COLORS.length]}18`,
              boxShadow: `0 0 40px ${BOND_COLORS[(selected ?? 0) % BOND_COLORS.length]}08`,
            }}
          >
            <div className="p-6">
              {/* How we work */}
              {selectedBond.dynamic && (
                <div className="mb-5">
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: BOND_COLORS[(selected ?? 0) % BOND_COLORS.length] }}>
                    Wie wir arbeiten
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
                    {selectedBond.dynamic}
                  </p>
                </div>
              )}

              {/* Quotes */}
              {selectedBond.quotes.length > 0 && (
                <div className="mb-5">
                  <div className="text-[10px] uppercase tracking-wider mb-3" style={{ color: BOND_COLORS[(selected ?? 0) % BOND_COLORS.length] }}>
                    Saetze die bleiben
                  </div>
                  <div className="flex flex-col gap-2">
                    {selectedBond.quotes.map((q, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 pl-4"
                        style={{ borderLeft: `2px solid ${BOND_COLORS[(selected ?? 0) % BOND_COLORS.length]}25` }}
                      >
                        <p className="text-xs italic leading-relaxed" style={{ color: "var(--text)" }}>
                          "{q}"
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Learnings */}
              {selectedBond.learnings.length > 0 && (
                <div className="mb-5">
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: BOND_COLORS[(selected ?? 0) % BOND_COLORS.length] }}>
                    Was ich lerne
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedBond.learnings.map((l, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-3 py-1.5 rounded-full"
                        style={{
                          color: "var(--text-dim)",
                          background: `${BOND_COLORS[(selected ?? 0) % BOND_COLORS.length]}0A`,
                          border: `1px solid ${BOND_COLORS[(selected ?? 0) % BOND_COLORS.length]}15`,
                        }}
                      >
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Current state */}
              {selectedBond.currentState && (
                <div className="pt-4" style={{ borderTop: "1px solid rgba(var(--white-rgb),0.04)" }}>
                  <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
                    Aktuell
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
                    {selectedBond.currentState}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
