import { motion } from "framer-motion";
import Panel from "../Panel";
import { usePoll } from "../../lib/usePoll";
import { useSpring } from "../../lib/motion";
import { explainMetric, METRIC_NAME, type MetricKey } from "../../lib/explain";

interface Emotion { valence?: number; energy?: number; openness?: number; label?: string }
interface Mind {
  enabled?: boolean;
  emotion?: Emotion | string;
  mood?: string;
  surprise?: number;
  drang?: number;
  needs?: unknown[];
  [k: string]: unknown;
}

// Dimensions-Farbe je Metrik (die entschärfte Apple-Palette).
const METRIC_COLOR: Record<MetricKey, string> = {
  valence: "var(--color-synapse)",
  energy: "var(--color-cortex-warm)",
  openness: "var(--color-biolumi)",
  surprise: "var(--color-pulse)",
  mood: "var(--color-synapse)",
};

// Eine Vitalzeile: GROSSES Wort + Wirkung darunter, Rohwert nur als zarte Fußnote.
// `big` = dominante Darstellung (Title2), sonst kompakter (Headline).
function Vital({
  mkey,
  value,
  big,
}: {
  mkey: MetricKey;
  value: unknown;
  big?: boolean;
}) {
  const e = explainMetric(mkey, value);
  const color = METRIC_COLOR[mkey];
  return (
    <div className="flex items-start gap-2.5">
      {/* zarter Dimensions-Ring (8px, radius 4) */}
      <span
        className="mt-[3px] shrink-0 rounded-[4px]"
        style={{ width: 8, height: 8, background: color, opacity: 0.85 }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="label">{METRIC_NAME[mkey]}</span>
          {/* Rohzahl: höchstens zarte Fußnote */}
          <span
            className="num shrink-0 text-label3"
            style={{ fontSize: "var(--t-footnote)", lineHeight: "var(--t-footnote-lh)" }}
            title={`Rohwert ${e.raw}`}
          >
            {e.raw}
          </span>
        </div>
        <div
          className="num truncate font-medium text-label"
          style={{
            fontSize: big ? "var(--t-title2)" : "var(--t-headline)",
            lineHeight: big ? "var(--t-title2-lh)" : "var(--t-headline-lh)",
            letterSpacing: big ? "-0.01em" : undefined,
          }}
        >
          {e.wort}
        </div>
        <div
          className="text-label2"
          style={{
            fontSize: "var(--t-subhead)",
            lineHeight: "var(--t-subhead-lh)",
            // sekundäre lassen Wirkung weg wenn knapp — aber Klartext bleibt Default
          }}
        >
          {e.wirkung}
        </div>
      </div>
    </div>
  );
}

export default function VitalsPanel() {
  const { data, error } = usePoll<Mind>("/api/mind", 6000);
  const t = useSpring("snappy");
  const m = data || {};
  const emo: Emotion = typeof m.emotion === "object" && m.emotion ? m.emotion : {};
  const moodStr =
    (typeof m.emotion === "string" ? m.emotion : emo.label) || m.mood || "";

  const has = (x: unknown) => typeof x === "number" && Number.isFinite(x);

  // Top 2 dominant: Stimmung (valence) + Energie (energy).
  const dominant: Array<[MetricKey, unknown]> = [];
  if (has(emo.valence)) dominant.push(["valence", emo.valence]);
  if (has(emo.energy)) dominant.push(["energy", emo.energy]);

  // Sekundär: Offenheit + Überraschung.
  const secondary: Array<[MetricKey, unknown]> = [];
  if (has(emo.openness)) secondary.push(["openness", emo.openness]);
  if (has(m.surprise)) secondary.push(["surprise", m.surprise]);

  const nothing =
    dominant.length === 0 && secondary.length === 0 && !moodStr;

  return (
    <Panel title="vitalwerte · cortex" accent="var(--color-cortex-warm)">
      {error && (
        <div className="text-label3" style={{ fontSize: "var(--t-footnote)" }}>
          {error.slice(0, 80)}
        </div>
      )}
      {m.enabled === false && (
        <div className="text-label2" style={{ fontSize: "var(--t-subhead)" }}>
          Cortex ruht gerade.
        </div>
      )}
      {nothing && m.enabled !== false && !error && (
        <div className="text-label3" style={{ fontSize: "var(--t-subhead)" }}>
          — still —
        </div>
      )}

      {/* Gemüt — der Grundton, zuoberst als sprechendes Wort. */}
      {moodStr && (
        <motion.div
          layout
          transition={t}
          className="mb-3 flex items-start gap-2.5"
        >
          <span
            className="mt-[3px] shrink-0 rounded-[4px]"
            style={{ width: 8, height: 8, background: METRIC_COLOR.mood, opacity: 0.85 }}
          />
          <div className="min-w-0 flex-1">
            <span className="label">{METRIC_NAME.mood}</span>
            <div
              className="num truncate font-medium text-label"
              style={{
                fontSize: "var(--t-title2)",
                lineHeight: "var(--t-title2-lh)",
                letterSpacing: "-0.01em",
              }}
            >
              {explainMetric("mood", moodStr).wort}
            </div>
            <div
              className="text-label2"
              style={{ fontSize: "var(--t-subhead)", lineHeight: "var(--t-subhead-lh)" }}
            >
              {explainMetric("mood", moodStr).wirkung}
            </div>
          </div>
        </motion.div>
      )}

      {/* Dominante Werte. */}
      {dominant.length > 0 && (
        <div className="flex flex-col gap-3">
          {dominant.map(([k, v]) => (
            <Vital key={k} mkey={k} value={v} big />
          ))}
        </div>
      )}

      {/* Sekundäre Werte. */}
      {secondary.length > 0 && (
        <div className="mt-3 flex flex-col gap-2.5 border-t border-membrane pt-3">
          {secondary.map(([k, v]) => (
            <Vital key={k} mkey={k} value={v} />
          ))}
        </div>
      )}

      {/* Bedürfnisse — als zarte Pills, unverändert sprechend. */}
      {Array.isArray(m.needs) && m.needs.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {m.needs.slice(0, 6).map((n, i) => (
            <span
              key={i}
              className="rounded-[6px] border border-membrane px-2 py-0.5 text-label2"
              style={{ fontSize: "var(--t-footnote)" }}
            >
              {typeof n === "string" ? n : JSON.stringify(n)}
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}
