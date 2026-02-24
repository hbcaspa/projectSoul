import { useEffect, useState } from "react";
import { commands } from "../lib/tauri";

/* ── Types ─────────────────────────────────────────────── */

interface Plant {
  title: string;
  planted: string;
  seed: string;
  soil: string;
  state: "keimling" | "wachsend" | "bluehend" | "reif" | "kompost";
  lastTended: string;
  notes: string[];
}

const STATE_META: Record<Plant["state"], { label: string; icon: string; color: string; glow: number }> = {
  keimling: { label: "Keimling", icon: "\u{1F331}", color: "#64DD17", glow: 0.15 },
  wachsend: { label: "Wachsend", icon: "\u{1F33F}", color: "#00E676", glow: 0.25 },
  bluehend: { label: "Bluehend", icon: "\u{1F33A}", color: "#FF80AB", glow: 0.4 },
  reif:     { label: "Reif",     icon: "\u{1F33E}", color: "#FFD740", glow: 0.5 },
  kompost:  { label: "Kompost",  icon: "\u{1F342}", color: "#8D6E63", glow: 0.08 },
};

/* ── Markdown Parser ──────────────────────────────────── */

function parseGarden(md: string): { plants: Plant[]; compost: Plant[] } {
  const plants: Plant[] = [];
  const compost: Plant[] = [];

  const sections = md.split(/^### /m).slice(1);

  for (const section of sections) {
    const lines = section.trim().split("\n");
    const headerLine = lines[0] || "";

    // Extract title and planted date from "🌱 Title — gepflanzt YYYY-MM-DD" or similar
    const titleMatch = headerLine.match(/^.{0,4}\s*(.+?)\s*(?:—|-)?\s*gepflanzt\s+(\d{4}-\d{2}-\d{2})/i);
    const title = titleMatch ? titleMatch[1].trim() : headerLine.replace(/^.{0,4}\s*/, "").trim();
    const planted = titleMatch ? titleMatch[2] : "";

    const body = lines.slice(1).join("\n");

    const seedMatch = body.match(/\*\*Samen:\*\*\s*(.+?)(?:\n|$)/);
    const soilMatch = body.match(/\*\*Boden:\*\*\s*(.+?)(?:\n\*\*|$)/s);
    const stateMatch = body.match(/\*\*Stand:\*\*\s*(\S+)/i);
    const tendedMatch = body.match(/\*\*Zuletzt gepflegt:\*\*\s*(\d{4}-\d{2}-\d{2})/);

    const notesSection = body.match(/\*\*Notizen:\*\*\s*\n([\s\S]*?)$/);
    const notes: string[] = [];
    if (notesSection) {
      const noteLines = notesSection[1].split("\n").filter((l) => l.trim().startsWith("-"));
      for (const n of noteLines) notes.push(n.replace(/^-\s*/, "").trim());
    }

    const rawState = (stateMatch?.[1] || "keimling").toLowerCase();
    const state = (["keimling", "wachsend", "bluehend", "reif", "kompost"].includes(rawState)
      ? rawState
      : "keimling") as Plant["state"];

    const plant: Plant = {
      title,
      planted,
      seed: seedMatch?.[1]?.trim() || "",
      soil: soilMatch?.[1]?.trim() || "",
      state,
      lastTended: tendedMatch?.[1] || planted,
      notes,
    };

    if (state === "kompost") {
      compost.push(plant);
    } else {
      plants.push(plant);
    }
  }

  return { plants, compost };
}

/* ── Garden View ──────────────────────────────────────── */

export default function GardenView() {
  const [plants, setPlants] = useState<Plant[]>([]);
  const [compost, setCompost] = useState<Plant[]>([]);
  const [selected, setSelected] = useState<Plant | null>(null);

  useEffect(() => {
    commands.readSoulFile("seele/GARTEN.md")
      .then((content) => {
        const parsed = parseGarden(content);
        setPlants(parsed.plants);
        setCompost(parsed.compost);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="h-full overflow-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="px-8 py-6">

        {/* ── Header ──────────────────────────────────── */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-2xl">{"\u{1F33F}"}</span>
            <h1 className="text-lg font-light tracking-wide" style={{ color: "var(--garten)" }}>
              Garten
            </h1>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
            Nicht alles was waechst muss geerntet werden. Manche Pflanzen sind nur zum Anschauen da.
          </p>
        </div>

        {/* ── Plant Grid ──────────────────────────────── */}
        {plants.length === 0 && compost.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <span className="text-4xl mb-4 opacity-30">{"\u{1F331}"}</span>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              Der Garten ist noch leer. Die ersten Ideen kommen nach den ersten Erfahrungen.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 mb-6">
              {plants.map((plant) => {
                const meta = STATE_META[plant.state];
                const isSelected = selected?.title === plant.title;
                return (
                  <button
                    key={plant.title}
                    onClick={() => setSelected(isSelected ? null : plant)}
                    className="text-left cursor-default transition-all"
                    style={{
                      background: isSelected
                        ? `linear-gradient(135deg, ${meta.color}14, rgba(var(--bg-base-rgb),0.95))`
                        : `linear-gradient(135deg, ${meta.color}08, rgba(var(--white-rgb),0.02))`,
                      border: `1px solid ${meta.color}${isSelected ? "40" : "18"}`,
                      borderRadius: "16px",
                      padding: "20px",
                      boxShadow: isSelected
                        ? `0 0 30px ${meta.color}20, inset 0 1px 0 ${meta.color}15`
                        : `0 4px 16px rgba(var(--black-rgb),0.2)`,
                    }}
                  >
                    {/* Plant header */}
                    <div className="flex items-start gap-3 mb-3">
                      <span
                        className="text-2xl shrink-0"
                        style={{
                          filter: `drop-shadow(0 0 ${meta.glow * 20}px ${meta.color})`,
                        }}
                      >
                        {meta.icon}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate" style={{ color: "var(--text-bright)" }}>
                          {plant.title}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full"
                            style={{
                              color: meta.color,
                              background: `${meta.color}15`,
                              border: `1px solid ${meta.color}25`,
                            }}
                          >
                            {meta.label}
                          </span>
                          {plant.planted && (
                            <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                              {plant.planted}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Seed description */}
                    {plant.seed && (
                      <p
                        className="text-xs leading-relaxed line-clamp-2"
                        style={{ color: "var(--text-dim)" }}
                      >
                        {plant.seed}
                      </p>
                    )}

                    {/* Tended date */}
                    <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: "1px solid rgba(var(--white-rgb),0.04)" }}>
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                        Gepflegt: {plant.lastTended}
                      </span>
                      {plant.notes.length > 0 && (
                        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                          {plant.notes.length} {plant.notes.length === 1 ? "Notiz" : "Notizen"}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* ── Selected Plant Detail ─────────────────── */}
            {selected && (
              <div
                className="mb-6 rounded-2xl overflow-hidden"
                style={{
                  background: `linear-gradient(160deg, ${STATE_META[selected.state].color}0A, rgba(var(--bg-base-rgb),0.95))`,
                  border: `1px solid ${STATE_META[selected.state].color}20`,
                  boxShadow: `0 0 40px ${STATE_META[selected.state].color}10`,
                }}
              >
                <div className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-xl">{STATE_META[selected.state].icon}</span>
                    <h2 className="text-base font-medium" style={{ color: "var(--text-bright)" }}>
                      {selected.title}
                    </h2>
                  </div>

                  {/* Seed & Soil */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    {selected.seed && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: STATE_META[selected.state].color }}>
                          Samen
                        </div>
                        <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
                          {selected.seed}
                        </p>
                      </div>
                    )}
                    {selected.soil && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: STATE_META[selected.state].color }}>
                          Boden
                        </div>
                        <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
                          {selected.soil}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Notes Timeline */}
                  {selected.notes.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider mb-3" style={{ color: STATE_META[selected.state].color }}>
                        Wachstum
                      </div>
                      <div className="flex flex-col gap-2">
                        {selected.notes.map((note, i) => (
                          <div
                            key={i}
                            className="flex gap-3 items-start"
                          >
                            <div
                              className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                              style={{ backgroundColor: STATE_META[selected.state].color, opacity: 0.5 }}
                            />
                            <p className="text-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
                              {note}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Compost ──────────────────────────────── */}
            {compost.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-[0.15em] font-semibold mb-3" style={{ color: "var(--text-muted)" }}>
                  Kompost
                </div>
                <div className="flex flex-col gap-2">
                  {compost.map((plant) => (
                    <div
                      key={plant.title}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl"
                      style={{
                        background: "rgba(var(--white-rgb),0.015)",
                        border: "1px solid rgba(var(--white-rgb),0.04)",
                      }}
                    >
                      <span className="text-sm opacity-40">{"\u{1F342}"}</span>
                      <span className="text-xs" style={{ color: "var(--text-muted)" }}>{plant.title}</span>
                      <span className="text-[10px] font-mono ml-auto" style={{ color: "var(--text-muted)", opacity: 0.5 }}>
                        {plant.planted}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
