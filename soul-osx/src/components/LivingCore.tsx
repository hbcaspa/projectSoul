import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSoul } from "../lib/store";
import { usePoll } from "../lib/usePoll";
import { useSpring, useReducedMotion } from "../lib/motion";
import { humanize } from "../lib/explain";

// LivingCore — der lebende Kern (FEAT-Spec, Option A).
//
// EINE große, weiche, atmende Form. Sie ist kein Diagramm, sie ist ein Gefühl:
//   • Farbe   = Valenz   (kühl/Indigo bei negativ → warm/Korall bei positiv)
//   • Atem    = Energie  (höhere Energie → schnellerer Atem)
//   • Rand    = Offenheit + Überraschung (mehr → unruhigerer, lebendigerer Rand)
//   • Puls    = JEDES neue Bus-Event lässt eine Welle von innen nach außen laufen
//
// Darunter EIN großer Ich-Satz (humanize(lastEvent) / pulse.label), weich
// crossfadend. Idle: nur ruhiger Atem, keine Dauer-Animation.
//
// prefers-reduced-motion: kein Geometrie-Loop, nur Farbe + Opacity.

// ── /api/mind Shape (wie VitalsPanel ihn liest) ────────────────────────────
interface Emotion { valence?: number; energy?: number; openness?: number; label?: string }
interface Mind {
  emotion?: Emotion | string;
  mood?: string;
  surprise?: number;
  [k: string]: unknown;
}

// RGB-Stützstellen für die Valenz-Rampe (Apple-Palette, leicht entschärft).
const COOL: [number, number, number] = [0x5e, 0x5c, 0xe6]; // Indigo  (negativ)
const MID: [number, number, number] = [0x66, 0xd4, 0xcf]; // Mint    (neutral)
const WARM: [number, number, number] = [0xff, 0x6b, 0x5c]; // Korall  (positiv)

// valence -1..1 → Farbe. -1→Indigo, 0→Mint, +1→Korall.
function valenceColor(v: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, v));
  const [a, b] = t < 0 ? [COOL, MID] : [MID, WARM];
  const f = t < 0 ? t + 1 : t; // 0..1 innerhalb des Halbintervalls
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

const rgba = (c: [number, number, number], a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${a})`;

function num(x: unknown, fallback = 0): number {
  return typeof x === "number" && Number.isFinite(x) ? x : fallback;
}

export default function LivingCore() {
  const { lastEvent, active } = useSoul();
  const { data } = usePoll<Mind>("/api/mind", 6000);
  const reduce = useReducedMotion();

  // ── Vitalwerte herausziehen (mit denselben Konventionen wie VitalsPanel) ──
  const emo: Emotion =
    data && typeof data.emotion === "object" && data.emotion ? data.emotion : {};
  const valence = num(emo.valence, 0); // -1..1
  const energy = num(emo.energy, 0.5); // 0..1
  const openness = num(emo.openness, 0.5); // 0..1
  const surprise = num(data?.surprise, 0); // 0..1

  // Aktuelle Werte in einer Ref spiegeln, damit die rAF-Schleife nur einmal
  // startet und trotzdem immer die frischen Zahlen liest.
  const vitals = useRef({ valence, energy, openness, surprise });
  vitals.current = { valence, energy, openness, surprise };

  // ── Der Ich-Satz: Event > Puls-Label > stiller Grundton ──────────────────
  const pulse = active?.status?.pulse;
  const satz = useMemo(() => {
    if (lastEvent) return humanize(lastEvent);
    if (pulse?.label) return pulse.label;
    if (pulse?.activity) return pulse.activity;
    return active?.status?.mood ? `Ich bin ${active.status.mood}` : "Ich bin still";
  }, [lastEvent, pulse?.label, pulse?.activity, active?.status?.mood]);

  // ── Puls bei jedem neuen Event: Impuls in die rAF-Schleife einspeisen ─────
  const pulses = useRef<number[]>([]); // Startzeiten laufender Wellen
  useEffect(() => {
    if (!lastEvent) return;
    pulses.current.push(performance.now());
    if (pulses.current.length > 6) pulses.current = pulses.current.slice(-6);
  }, [lastEvent]);

  // ── Canvas-Render: weiche Metaball-Form, nur transform-/opacity-äquivalent ─
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let alive = true;
    const start = performance.now();

    // Hi-DPI: Canvas an Containergröße koppeln.
    let w = 0;
    let h = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const PI2 = Math.PI * 2;

    const draw = (now: number) => {
      const { valence, energy, openness, surprise } = vitals.current;
      const t = (now - start) / 1000;
      const cx = w / 2;
      const cy = h / 2;
      const color = valenceColor(valence);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      // Atem: Energie steuert Frequenz (0.10–0.42 Hz) und Hub.
      const breathHz = 0.1 + energy * 0.32;
      const breath = reduce ? 0 : Math.sin(t * PI2 * breathHz) * (0.04 + energy * 0.05);

      // Puls-Beitrag: jede Welle expandiert ~1.4s lang und klingt aus.
      let pulseSwell = 0;
      let pulseRim = 0;
      if (!reduce) {
        const keep: number[] = [];
        for (const p0 of pulses.current) {
          const age = (now - p0) / 1000;
          if (age < 1.4) {
            keep.push(p0);
            const k = 1 - age / 1.4; // 1 → 0
            // weiche Glocke, innen→außen
            const env = Math.sin(Math.min(1, age / 1.4) * Math.PI);
            pulseSwell += env * 0.12 * k;
            pulseRim += env * 0.5 * k;
          }
        }
        pulses.current = keep;
      }

      const baseR = Math.min(w, h) * (0.3 + breath + pulseSwell);

      // Rand-Unruhe: Offenheit + Überraschung + Puls. Reduce → glatt.
      const unrest = reduce ? 0 : openness * 0.16 + surprise * 0.22 + pulseRim * 0.12;

      // Konturpfad aus überlagerten Sinus-Lappen (lebendiger, weicher Rand).
      const STEPS = 96;
      ctx.beginPath();
      for (let i = 0; i <= STEPS; i++) {
        const a = (i / STEPS) * PI2;
        const wob = reduce
          ? 0
          : (Math.sin(a * 3 + t * 0.9) * 0.6 +
              Math.sin(a * 5 - t * 1.3) * 0.3 +
              Math.sin(a * 2 + t * 0.5) * 0.4) *
            unrest;
        const r = baseR * (1 + wob);
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // Weicher Radialverlauf: heller Kern → transparenter Rand.
      const grad = ctx.createRadialGradient(cx, cy, baseR * 0.05, cx, cy, baseR * 1.05);
      const coreAlpha = 0.9 + pulseSwell * 0.8;
      grad.addColorStop(0, rgba(color, Math.min(1, coreAlpha)));
      grad.addColorStop(0.45, rgba(color, 0.55));
      grad.addColorStop(0.8, rgba(color, 0.16));
      grad.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = grad;
      ctx.shadowColor = rgba(color, 0.5);
      ctx.shadowBlur = baseR * 0.6;
      ctx.fill();

      // Zarter Rand-Akzent, der mit Offenheit/Puls heller wird.
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(color, 0.12 + openness * 0.18 + pulseRim * 0.4);
      ctx.stroke();

      ctx.restore();

      if (alive && !reduce) raf = requestAnimationFrame(draw);
    };

    if (reduce) {
      // Statisches Bild — kein Loop. Bei Wertänderung rendert der Effekt neu.
      draw(performance.now());
    } else {
      raf = requestAnimationFrame(draw);
    }

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // reduce als Dep: Wechsel der Systemeinstellung baut den Loop neu auf.
    // Vitals lesen wir über die Ref, daher keine Vitals-Deps (kein Neu-Mount).
  }, [reduce]);

  // Bei reduzierter Bewegung trotzdem neu zeichnen, wenn sich Farbe/Werte ändern.
  useEffect(() => {
    if (!reduce) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const color = valenceColor(valence);
    const baseR = Math.min(rect.width, rect.height) * 0.3;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    const grad = ctx.createRadialGradient(cx, cy, baseR * 0.05, cx, cy, baseR * 1.05);
    grad.addColorStop(0, rgba(color, 0.9));
    grad.addColorStop(0.45, rgba(color, 0.55));
    grad.addColorStop(0.8, rgba(color, 0.16));
    grad.addColorStop(1, rgba(color, 0));
    ctx.beginPath();
    ctx.arc(cx, cy, baseR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }, [reduce, valence, energy, openness, surprise]);

  const satzTransition = useSpring("gentle");

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Der EINE Ich-Satz — weich crossfadend, SF Pro, groß. */}
      <div className="relative z-10 flex max-w-[78%] flex-col items-center px-4 text-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={satz}
            initial={{ opacity: 0, y: reduce ? 0 : 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : -6 }}
            transition={satzTransition}
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "var(--t-largetitle)",
              lineHeight: "var(--t-largetitle-lh)",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--color-label)",
              textShadow: "0 1px 24px rgba(0,0,0,0.55)",
            }}
          >
            {satz}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
