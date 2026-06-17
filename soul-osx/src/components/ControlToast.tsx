// Dezenter Control-Feedback-Toast (unten zentriert). Zeigt das ehrliche Engine-Ergebnis:
// Erfolg + note ("sofort wirksam" / "ab nächstem Neustart") oder Fehler (403/400).
// Verschwindet nach ein paar Sekunden — Apple-ruhig, keine Modalität.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, XCircle, Info } from "lucide-react";
import { useRegistry } from "../lib/useRegistry";

export default function ControlToast() {
  const { lastResult, modules } = useRegistry();
  const [shown, setShown] = useState<{ key: number; ok: boolean; title: string; text: string } | null>(null);

  useEffect(() => {
    if (!lastResult) return;
    const m = modules.find((x) => x.id === lastResult.id);
    const name = m?.name ?? lastResult.id;
    const r = lastResult.result;
    const ok = !!r.ok && !r.error;
    const text = r.error
      ? humanError(r.error)
      : r.note || (r.method ? `${r.method}()` : "ausgeführt");
    setShown({ key: Date.now(), ok, title: name, text });
    const t = setTimeout(() => setShown(null), ok ? 3200 : 5000);
    return () => clearTimeout(t);
  }, [lastResult]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key={shown.key}
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 460, damping: 34 }}
          className="fixed bottom-5 left-1/2 z-[60] flex max-w-[440px] -translate-x-1/2 items-start gap-2.5 rounded-xl px-3.5 py-2.5"
          style={{
            background: "rgba(30,30,36,0.9)",
            border: "0.5px solid rgba(255,255,255,0.14)",
            WebkitBackdropFilter: "blur(30px) saturate(180%)",
            backdropFilter: "blur(30px) saturate(180%)",
            boxShadow: "0 16px 50px -16px rgba(0,0,0,0.6)",
          }}
        >
          <span className="mt-0.5 shrink-0">
            {shown.ok ? (
              <CheckCircle2 size={15} style={{ color: "var(--color-green)" }} />
            ) : shown.text.includes("Neustart") ? (
              <Info size={15} style={{ color: "var(--color-orange)" }} />
            ) : (
              <XCircle size={15} style={{ color: "var(--color-red)" }} />
            )}
          </span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-label">{shown.title}</div>
            <div className="text-[11.5px] text-label2">{shown.text}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Engine-Fehlertexte in ruhiges Deutsch übersetzen.
function humanError(err: string): string {
  if (err.includes("security-critical")) return "Sicherheitskritisch — kann nicht deaktiviert werden.";
  if (err.includes("readonly")) return "Nur-Lese-Modul — nicht schaltbar.";
  if (err.includes("cannot be disabled")) return "Hat keinen An/Aus-Zustand — nur auslösbar.";
  if (err.includes("no runtime stop")) return "Kein sicherer Laufzeit-Stop verfügbar.";
  if (err.includes("not available")) return "Modul nicht aktiv — keine auslösbare Aktion.";
  if (err.includes("critical and not toggleable")) return "Sicherheitskritisch — nicht schaltbar.";
  return err.length > 120 ? err.slice(0, 120) + "…" : err;
}
