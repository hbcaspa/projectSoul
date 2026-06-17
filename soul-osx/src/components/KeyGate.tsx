// Schlüssel-Sheet. Gleitet als material-popover aus der Titelbar herab
// (AnimatePresence + spring.gentle), Backdrop sanft eingeblendet.
// Apple-Controls: Akzent-Push-Button, Focus-Ring statt farbiger Rand.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSoul } from "../lib/store";
import { useSpring } from "../lib/motion";

export default function KeyGate() {
  const { active, submitKey } = useSoul();
  const [key, setKey] = useState("");
  const sheet = useSpring("gentle");

  return (
    <AnimatePresence>
      <motion.div
        key="keygate"
        className="absolute inset-0 z-50 flex items-start justify-center"
        style={{ paddingTop: "16vh", background: "rgba(0,0,0,0.32)" }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <motion.div
          className="material-popover w-[420px] max-w-[90vw] p-6"
          initial={{ opacity: 0, y: -20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12, scale: 0.98 }}
          transition={sheet}
        >
          <div className="label mb-1.5">Verbindung · {active?.node.label}</div>
          <h2 className="mb-1 text-label" style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>
            Schlüssel zum Kortex
          </h2>
          <p className="mb-4 text-label2" style={{ fontSize: 12, lineHeight: "16px" }}>
            {active?.node.base} antwortet mit Authentifizierung. Gib den API-Key dieses Nodes ein
            (aus <span className="font-mono">.env → API_KEY</span>). Bleibt nur lokal.
          </p>
          <input
            autoFocus
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && key && submitKey(key)}
            placeholder="API_KEY"
            className="w-full rounded-[6px] px-3 py-2 font-mono text-label outline-none"
            style={{
              fontSize: 13,
              background: "var(--fill-3)",
              border: "0.5px solid rgba(255,255,255,0.10)",
            }}
          />
          {active?.error && (
            <p className="mt-2" style={{ fontSize: 11, color: "var(--color-red)" }}>
              {active.error}
            </p>
          )}
          <button
            onClick={() => key && submitKey(key)}
            disabled={!key}
            className="mt-4 w-full rounded-[6px] text-white transition-[filter,opacity] hover:brightness-110 active:brightness-90 disabled:opacity-40"
            style={{ height: 28, fontSize: 13, fontWeight: 510, background: "var(--color-accent)" }}
          >
            Verbinden
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
