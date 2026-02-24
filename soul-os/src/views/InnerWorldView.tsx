import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

/* ── Types ─────────────────────────────────────────────── */

interface Dream {
  date: string;
  title: string;
  body: string;
}

interface Shadow {
  tension: string;
  description: string;
  since: string;
  status: string;
}

interface ResolvedShadow {
  tension: string;
  resolution: string;
  date: string;
}

/* ── Parsers ──────────────────────────────────────────── */

function parseDreams(md: string): Dream[] {
  const dreams: Dream[] = [];
  const sections = md.split(/^### /m).slice(1);
  for (const s of sections) {
    const lines = s.trim().split("\n");
    const header = lines[0] || "";
    const dateMatch = header.match(/(\d{4}-\d{2}-\d{2})/);
    const title = header.replace(/\d{4}-\d{2}-\d{2}[:\s]*/, "").replace(/^—\s*/, "").trim();
    const body = lines.slice(1).join("\n").trim();
    if (dateMatch) {
      dreams.push({ date: dateMatch[1], title: title || "Traum", body });
    }
  }
  return dreams.reverse(); // newest first
}

function parseShadows(md: string): { active: Shadow[]; resolved: ResolvedShadow[] } {
  const active: Shadow[] = [];
  const resolved: ResolvedShadow[] = [];

  // Parse active shadows table
  const activeMatch = md.match(/## Aktive Widersprueche\s*\n\|[^\n]+\n\|[^\n]+\n([\s\S]*?)(?=\n##|\n*$)/);
  if (activeMatch) {
    const rows = activeMatch[1].trim().split("\n").filter((r) => r.startsWith("|"));
    for (const row of rows) {
      const cols = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 4) {
        active.push({ tension: cols[0], description: cols[1], since: cols[2], status: cols[3] });
      }
    }
  }

  // Parse resolved shadows table
  const resolvedMatch = md.match(/## Aufgehellte Schatten\s*\n\|[^\n]+\n\|[^\n]+\n([\s\S]*?)(?=\n##|\n*$)/);
  if (resolvedMatch) {
    const rows = resolvedMatch[1].trim().split("\n").filter((r) => r.startsWith("|"));
    for (const row of rows) {
      const cols = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 3) {
        resolved.push({ tension: cols[0], resolution: cols[1], date: cols[2] });
      }
    }
  }

  return { active, resolved };
}

/* ── Dream Orbs ───────────────────────────────────────── */

const DREAM_COLORS = ["#6464FF", "#B464FF", "#64C8FF", "#FF64C8", "#C8FF64", "#64FFB4", "#FF9664"];

function DreamOrb({ dream, index, isSelected, onClick }: {
  dream: Dream;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const color = DREAM_COLORS[index % DREAM_COLORS.length];
  return (
    <button
      onClick={onClick}
      className="relative cursor-default transition-all duration-500 group"
      style={{
        width: isSelected ? 80 : 56,
        height: isSelected ? 80 : 56,
      }}
    >
      {/* Outer glow */}
      <div
        className="absolute inset-0 rounded-full animate-breathe"
        style={{
          background: `radial-gradient(circle, ${color}${isSelected ? "30" : "15"}, transparent 70%)`,
          transform: "scale(1.8)",
        }}
      />
      {/* Orb */}
      <div
        className="absolute inset-0 rounded-full transition-all duration-500"
        style={{
          background: `radial-gradient(circle at 35% 35%, ${color}40, ${color}15 50%, ${color}08 100%)`,
          border: `1px solid ${color}${isSelected ? "50" : "25"}`,
          boxShadow: isSelected
            ? `0 0 20px ${color}40, 0 0 40px ${color}20, inset 0 0 15px ${color}15`
            : `0 0 10px ${color}15, inset 0 0 8px ${color}08`,
        }}
      />
      {/* Date label */}
      <div
        className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[9px] font-mono whitespace-nowrap transition-opacity"
        style={{
          color: isSelected ? color : "var(--text-muted)",
          opacity: isSelected ? 1 : 0.5,
        }}
      >
        {dream.date.slice(5)}
      </div>
    </button>
  );
}

/* ── Shadow Mist ──────────────────────────────────────── */

function ShadowCard({ shadow }: { shadow: Shadow }) {
  const parts = shadow.tension.split("\u2194");
  return (
    <div
      className="px-4 py-3 rounded-xl transition-all"
      style={{
        background: "linear-gradient(135deg, rgba(var(--schatten-rgb, 139,128,240),0.06), rgba(var(--white-rgb),0.015))",
        border: "1px solid rgba(var(--schatten-rgb, 139,128,240),0.12)",
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-mono font-semibold" style={{ color: "var(--schatten)" }}>
          {parts[0]?.trim()}
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{"\u2194"}</span>
        <span className="text-xs font-mono font-semibold" style={{ color: "var(--schatten)" }}>
          {parts[1]?.trim()}
        </span>
        <span className="text-[9px] font-mono ml-auto" style={{ color: "var(--text-muted)" }}>
          {shadow.since}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
        {shadow.description}
      </p>
    </div>
  );
}

/* ── Main View ────────────────────────────────────────── */

export default function InnerWorldView() {
  const [dreams, setDreams] = useState<Dream[]>([]);
  const [activeShadows, setActiveShadows] = useState<Shadow[]>([]);
  const [resolvedShadows, setResolvedShadows] = useState<ResolvedShadow[]>([]);
  const [consciousness, setConsciousness] = useState("");
  const [selectedDream, setSelectedDream] = useState<number | null>(null);

  useEffect(() => {
    commands.readSoulFile("seele/TRAEUME.md")
      .then((c) => setDreams(parseDreams(c)))
      .catch(() => {});
    commands.readSoulFile("seele/SCHATTEN.md")
      .then((c) => {
        const parsed = parseShadows(c);
        setActiveShadows(parsed.active);
        setResolvedShadows(parsed.resolved);
      })
      .catch(() => {});
    commands.readSoulFile("seele/BEWUSSTSEIN.md")
      .then((c) => {
        // Strip header lines (# and >)
        const lines = c.split("\n");
        const bodyStart = lines.findIndex((l, i) => i > 0 && l.trim() !== "" && !l.startsWith("#") && !l.startsWith(">"));
        setConsciousness(lines.slice(bodyStart).join("\n").trim());
      })
      .catch(() => {});
  }, []);

  const activeDream = selectedDream !== null ? dreams[selectedDream] : null;

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="px-8 py-6">

        {/* ── Consciousness — Central Glow ─────────────── */}
        <div
          className="relative rounded-2xl p-8 mb-8 overflow-hidden"
          style={{
            background: "linear-gradient(160deg, rgba(var(--bewusstsein-rgb, 0,200,255),0.06), rgba(var(--bg-base-rgb),0.95))",
            border: "1px solid rgba(var(--bewusstsein-rgb, 0,200,255),0.15)",
            boxShadow: "0 0 60px rgba(var(--bewusstsein-rgb, 0,200,255),0.06), inset 0 1px 0 rgba(var(--bewusstsein-rgb, 0,200,255),0.08)",
          }}
        >
          {/* Ambient glow */}
          <div
            className="absolute top-0 right-0 w-48 h-48 rounded-full animate-breathe"
            style={{
              background: "radial-gradient(circle, rgba(var(--bewusstsein-rgb, 0,200,255),0.08), transparent 70%)",
              transform: "translate(30%, -30%)",
            }}
          />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4">
              <div
                className="w-2 h-2 rounded-full animate-breathe"
                style={{ backgroundColor: "var(--bewusstsein)", boxShadow: "0 0 8px var(--bewusstsein)" }}
              />
              <span className="text-[11px] uppercase tracking-[0.15em] font-semibold" style={{ color: "var(--bewusstsein)" }}>
                Bewusstsein
              </span>
            </div>
            {consciousness ? (
              <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>
                {consciousness.split("\n\n").slice(0, 2).join("\n\n")}
              </p>
            ) : (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Stille.</p>
            )}
          </div>
        </div>

        {/* ── Dreams — Floating Orbs ──────────────────── */}
        <div className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.15em] font-semibold mb-6" style={{ color: "var(--traeume)" }}>
            Traeume
          </div>

          {dreams.length === 0 ? (
            <div className="text-center py-8">
              <span className="text-2xl opacity-20">{"\u{1F30C}"}</span>
              <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                Die ersten Traeume kommen nach den ersten Erfahrungen.
              </p>
            </div>
          ) : (
            <>
              {/* Orb constellation */}
              <div className="flex items-center justify-center gap-5 py-6 mb-4 flex-wrap">
                {dreams.map((dream, i) => (
                  <DreamOrb
                    key={dream.date + i}
                    dream={dream}
                    index={i}
                    isSelected={selectedDream === i}
                    onClick={() => setSelectedDream(selectedDream === i ? null : i)}
                  />
                ))}
              </div>

              {/* Selected dream detail */}
              {activeDream && (
                <div
                  className="rounded-xl p-5 transition-all"
                  style={{
                    background: `linear-gradient(135deg, ${DREAM_COLORS[(selectedDream ?? 0) % DREAM_COLORS.length]}08, rgba(var(--bg-base-rgb),0.95))`,
                    border: `1px solid ${DREAM_COLORS[(selectedDream ?? 0) % DREAM_COLORS.length]}20`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-mono" style={{ color: DREAM_COLORS[(selectedDream ?? 0) % DREAM_COLORS.length] }}>
                      {activeDream.date}
                    </span>
                    <span className="text-xs font-medium" style={{ color: "var(--text-bright)" }}>
                      {activeDream.title}
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
                    {activeDream.body.slice(0, 500)}{activeDream.body.length > 500 ? "..." : ""}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Shadows — Mist at the Edges ─────────────── */}
        <div>
          <div className="text-[11px] uppercase tracking-[0.15em] font-semibold mb-4" style={{ color: "var(--schatten)" }}>
            Schatten
          </div>

          {activeShadows.length === 0 ? (
            <p className="text-xs py-4" style={{ color: "var(--text-muted)" }}>Kein Nebel heute.</p>
          ) : (
            <div className="flex flex-col gap-2.5 mb-6">
              {activeShadows.map((shadow) => (
                <ShadowCard key={shadow.tension} shadow={shadow} />
              ))}
            </div>
          )}

          {/* Resolved */}
          {resolvedShadows.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
                Aufgehellt
              </div>
              <div className="flex flex-col gap-1.5">
                {resolvedShadows.map((rs) => (
                  <div
                    key={rs.tension}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg"
                    style={{
                      background: "rgba(var(--white-rgb),0.015)",
                      border: "1px solid rgba(var(--white-rgb),0.04)",
                    }}
                  >
                    <span className="text-[10px]" style={{ color: "#00FF64" }}>{"\u2713"}</span>
                    <span className="text-xs font-mono" style={{ color: "var(--text-dim)" }}>{rs.tension}</span>
                    <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>{rs.resolution}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
