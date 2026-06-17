import type { ReactNode } from "react";

export default function Panel({
  title,
  accent = "var(--color-synapse)",
  right,
  children,
}: {
  title: string;
  accent?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="glass surface shrink-0 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="label flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
          {title}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Stat({ k, v, accent }: { k: string; v: ReactNode; accent?: string }) {
  return (
    <div className="flex flex-col">
      <span className="label">{k}</span>
      <span className="mt-0.5 font-mono text-sm" style={{ color: accent ?? "var(--color-bone)" }}>
        {v}
      </span>
    </div>
  );
}
