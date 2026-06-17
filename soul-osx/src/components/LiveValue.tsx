// Kompakter Live-Kurzwert für eine Modul-Zeile. Pollt den Endpoint (langsam, 12s —
// es sind viele Zeilen) und zeigt EIN sprechendes Feld. Fällt auf das Status-Wort zurück.

import { usePoll } from "../lib/usePoll";
import { shortLiveValue } from "../lib/moduleMeta";

export default function LiveValue({ endpoint, fallback }: { endpoint: string; fallback: string }) {
  const { data, error, loading } = usePoll(endpoint, 12000);
  if (error) return <span className="text-[11px] text-label3">{fallback}</span>;
  if (loading && data == null)
    return <span className="inline-block h-3 w-12 animate-pulse rounded bg-white/8" />;
  const v = shortLiveValue(data);
  return (
    <span className="num text-[11px] text-label2" style={{ maxWidth: 110 }}>
      {v ?? fallback}
    </span>
  );
}
