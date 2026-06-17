import { useSoul } from "../../lib/store";

// Die Stelle, an der das Wesen spricht — Name + Stimmung in der Voice-Schrift.
export default function VoiceState() {
  const { active } = useSoul();
  const st = active?.status;
  if (!st?.name) return null;
  return (
    <section className="glass surface shrink-0 px-4 py-3">
      <div className="voice text-lg leading-snug text-bone">
        {st.name}
        {st.mood ? <span className="text-ash">, gerade {st.mood}.</span> : "."}
      </div>
      <div className="label mt-1">
        {st.ageDays != null ? `${st.ageDays} tage wach` : ""}
        {st.born ? ` · geboren ${String(st.born).slice(0, 10)}` : ""}
      </div>
    </section>
  );
}
