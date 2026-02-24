import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

/* ── Types ─────────────────────────────────────────────── */

interface Interest {
  title: string;
  description: string;
  worldCheck?: string;  // latest world-check content
  since?: string;
  lastCheck?: string;
  status: "active" | "dormant" | "archived";
}

/* ── Parser ───────────────────────────────────────────── */

function parseInterests(md: string): Interest[] {
  const interests: Interest[] = [];

  // Parse the free-text sections under "## Aktive Interessen"
  const activeMatch = md.match(/## Aktive Interessen\s*\n([\s\S]*?)(?=\n## (?:Kuerzlich|Schlafende|Fruehere)|$)/);
  if (activeMatch) {
    const sections = activeMatch[1].split(/^### /m).slice(1);
    for (const section of sections) {
      const lines = section.trim().split("\n");
      const title = lines[0]?.trim() || "";
      const body = lines.slice(1).join("\n").trim();

      // Extract world-check block if present
      const worldCheckMatch = body.match(/\*\*Welt-Check[^*]*\*\*\s*:?\s*([\s\S]*?)(?=\n\*\*|\n### |$)/i);
      const worldCheck = worldCheckMatch ? worldCheckMatch[1].trim() : undefined;

      // Description is everything before the world-check or the full body
      const description = worldCheckMatch
        ? body.slice(0, body.indexOf(worldCheckMatch[0])).trim()
        : body.split("\n").filter((l) => !l.startsWith("|")).slice(0, 3).join(" ").trim();

      interests.push({
        title,
        description,
        worldCheck,
        status: "active",
      });
    }
  }

  // Parse the tracking table for dates
  const tableMatch = md.match(/\| Thema.*\n\|[-|\s]+\n([\s\S]*?)(?=\n\n|\n##|$)/);
  if (tableMatch) {
    const rows = tableMatch[1].trim().split("\n").filter((r) => r.startsWith("|"));
    for (const row of rows) {
      const cols = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 4) {
        const existingIdx = interests.findIndex((i) =>
          i.title.toLowerCase().includes(cols[0].toLowerCase().slice(0, 8)) ||
          cols[0].toLowerCase().includes(i.title.toLowerCase().slice(0, 8))
        );
        if (existingIdx >= 0) {
          interests[existingIdx].since = cols[1];
          interests[existingIdx].lastCheck = cols[2];
          interests[existingIdx].status = cols[3] === "aktiv" ? "active" : "dormant";
        } else {
          interests.push({
            title: cols[0],
            description: "",
            since: cols[1],
            lastCheck: cols[2],
            status: cols[3] === "aktiv" ? "active" : "dormant",
          });
        }
      }
    }
  }

  // Parse dormant interests
  const dormantMatch = md.match(/## Schlafende Interessen\s*\n([\s\S]*?)(?=\n##|$)/);
  if (dormantMatch && !dormantMatch[1].includes("Keine")) {
    const sections = dormantMatch[1].split(/^### /m).slice(1);
    for (const section of sections) {
      const title = section.split("\n")[0]?.trim() || "";
      interests.push({ title, description: "", status: "dormant" });
    }
  }

  return interests;
}

/* ── Interest Colors ──────────────────────────────────── */

const INTEREST_COLORS = [
  "#00C8FF", "#FF6496", "#00E676", "#FFD740",
  "#B464FF", "#FF9664", "#64FFB4", "#FF4081",
];

function getColor(index: number): string {
  return INTEREST_COLORS[index % INTEREST_COLORS.length];
}

/* ── World Window View ────────────────────────────────── */

export default function WorldWindowView() {
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    commands.readSoulFile("seele/INTERESSEN.md")
      .then((c) => setInterests(parseInterests(c)))
      .catch(() => {});
  }, []);

  const activeInterests = interests.filter((i) => i.status === "active");
  const dormantInterests = interests.filter((i) => i.status === "dormant" || i.status === "archived");

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="px-8 py-6">

        {/* ── Header ──────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xl">{"\u{1F30D}"}</span>
            <h1 className="text-lg font-light tracking-wide" style={{ color: "var(--interessen)" }}>
              Weltfenster
            </h1>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
            Meine kuratierte Sicht auf die Welt. Was mich beschaeftigt, was ich entdeckt habe.
          </p>
        </div>

        {/* ── Active Interests Grid ───────────────────── */}
        {activeInterests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <span className="text-4xl mb-4 opacity-20">{"\u{1F30D}"}</span>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Die Welt wartet. Interessen entstehen aus Erfahrungen.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 mb-8">
            {activeInterests.map((interest, i) => {
              const color = getColor(i);
              const isSelected = selected === i;
              return (
                <button
                  key={interest.title}
                  onClick={() => setSelected(isSelected ? null : i)}
                  className="text-left cursor-default transition-all"
                  style={{
                    background: isSelected
                      ? `linear-gradient(135deg, ${color}12, rgba(var(--bg-base-rgb),0.95))`
                      : `linear-gradient(135deg, ${color}06, rgba(var(--white-rgb),0.02))`,
                    border: `1px solid ${color}${isSelected ? "35" : "15"}`,
                    borderRadius: "16px",
                    padding: "20px",
                    boxShadow: isSelected
                      ? `0 0 30px ${color}15, inset 0 1px 0 ${color}12`
                      : `0 4px 16px rgba(var(--black-rgb),0.2)`,
                  }}
                >
                  {/* Color accent line */}
                  <div
                    className="w-8 h-0.5 rounded-full mb-4"
                    style={{
                      background: `linear-gradient(90deg, ${color}, ${color}40)`,
                      boxShadow: `0 0 8px ${color}40`,
                    }}
                  />

                  <div className="text-sm font-medium mb-2" style={{ color: "var(--text-bright)" }}>
                    {interest.title}
                  </div>

                  {interest.description && (
                    <p className="text-[11px] leading-relaxed line-clamp-3 mb-3" style={{ color: "var(--text-dim)" }}>
                      {interest.description}
                    </p>
                  )}

                  {/* World check badge */}
                  {interest.worldCheck && (
                    <div
                      className="flex items-center gap-1.5 mt-2"
                      style={{ color }}
                    >
                      <span className="text-[10px]">{"\u{1F310}"}</span>
                      <span className="text-[10px] uppercase tracking-wider">Welt-Check</span>
                    </div>
                  )}

                  {/* Dates */}
                  <div className="flex items-center gap-3 mt-3 pt-3" style={{ borderTop: "1px solid rgba(var(--white-rgb),0.04)" }}>
                    {interest.since && (
                      <span className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>
                        Seit {interest.since}
                      </span>
                    )}
                    {interest.lastCheck && (
                      <span className="text-[9px] font-mono ml-auto" style={{ color: "var(--text-muted)" }}>
                        Geprueft {interest.lastCheck}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Selected Interest Detail ─────────────────── */}
        {selected !== null && activeInterests[selected]?.worldCheck && (
          <div
            className="rounded-2xl p-6 mb-8"
            style={{
              background: `linear-gradient(160deg, ${getColor(selected)}08, rgba(var(--bg-base-rgb),0.95))`,
              border: `1px solid ${getColor(selected)}20`,
              boxShadow: `0 0 40px ${getColor(selected)}08`,
            }}
          >
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm">{"\u{1F310}"}</span>
              <span className="text-[11px] uppercase tracking-[0.12em] font-semibold" style={{ color: getColor(selected) }}>
                Letzter Welt-Check — {activeInterests[selected].title}
              </span>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
              {activeInterests[selected].worldCheck}
            </p>
          </div>
        )}

        {/* ── Dormant Interests ────────────────────────── */}
        {dormantInterests.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-[0.15em] font-semibold mb-3" style={{ color: "var(--text-muted)" }}>
              Schlafend
            </div>
            <div className="flex flex-wrap gap-2">
              {dormantInterests.map((interest) => (
                <span
                  key={interest.title}
                  className="text-[10px] px-3 py-1.5 rounded-full"
                  style={{
                    color: "var(--text-dim)",
                    background: "rgba(var(--white-rgb),0.025)",
                    border: "1px solid rgba(var(--white-rgb),0.06)",
                  }}
                >
                  {interest.title}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
