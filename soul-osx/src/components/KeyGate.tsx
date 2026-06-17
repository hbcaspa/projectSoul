import { useState } from "react";
import { useSoul } from "../lib/store";

export default function KeyGate() {
  const { active, submitKey } = useSoul();
  const [key, setKey] = useState("");

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-void/85 backdrop-blur-sm">
      <div className="glass surface w-[420px] p-6">
        <div className="label mb-1">verbindung · {active?.node.label}</div>
        <h2 className="mb-1 font-mono text-lg text-bone">Schlüssel zum Kortex</h2>
        <p className="mb-4 text-sm text-ash">
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
          className="w-full rounded-lg border border-membrane bg-tissue px-3 py-2 font-mono text-sm text-bone outline-none focus:border-synapse"
        />
        {active?.error && <p className="mt-2 text-xs text-fever">{active.error}</p>}
        <button
          onClick={() => key && submitKey(key)}
          className="mt-4 w-full rounded-lg border border-synapse/50 bg-synapse/15 py-2 font-mono text-sm text-bone transition hover:bg-synapse/25"
        >
          verbinden
        </button>
      </div>
    </div>
  );
}
