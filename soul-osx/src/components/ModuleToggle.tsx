// macOS-System-Switch — pixelgenau (Apple-Spec §3).
// Track 38×22 (Kapsel), Knob 18×18, Offset 2px → wandert auf x:16.
// An = System-Accent (macOS Dark Blue), aus = neutraler Fill. Knob mit micro-Feder.
// Gesperrt (locked) → Schloss statt Switch. Disabled → gedimmt, kein Hover.

import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { useSpring } from "../lib/motion";

export default function ModuleToggle({
  on,
  disabled = false,
  locked = false,
  busy = false,
  onToggle,
  title,
}: {
  on: boolean | null;
  disabled?: boolean;
  locked?: boolean;
  busy?: boolean;
  onToggle?: (next: boolean) => void;
  title?: string;
}) {
  const knob = useSpring("micro");

  if (locked) {
    return (
      <div
        title={title || "Sicherheitskritisch — kann nicht deaktiviert werden"}
        className="flex h-[22px] w-[38px] items-center justify-center rounded-full"
        style={{ background: "rgba(255,255,255,0.08)", border: "0.5px solid rgba(255,255,255,0.08)" }}
      >
        <Lock size={11} style={{ color: "var(--color-label3)" }} />
      </div>
    );
  }

  const isOn = on === true;
  const indeterminate = on === null;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      disabled={disabled || busy}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled && !busy) onToggle?.(!isOn);
      }}
      className="relative h-[22px] w-[38px] shrink-0 rounded-full outline-none transition-[background,opacity]"
      style={{
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        background: isOn
          ? "var(--color-accent)"
          : indeterminate
          ? "rgba(255,255,255,0.10)"
          : "rgba(255,255,255,0.16)",
        boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.18)",
      }}
    >
      <motion.span
        className="absolute top-1/2 h-[18px] w-[18px] rounded-full bg-white"
        style={{
          boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
          y: "-50%",
          opacity: busy ? 0.7 : 1,
        }}
        animate={{ x: isOn ? 18 : 2 }}
        transition={knob}
      >
        {indeterminate && !isOn && (
          <span
            className="absolute inset-0 m-auto h-[6px] w-[6px] rounded-full"
            style={{ background: "var(--color-label3)" }}
          />
        )}
      </motion.span>
    </button>
  );
}
