# soulOSX — „DER KORTEX"

Native macOS-Cockpit für die Soul-Engine. Zeigt ALLE ~76 Module live (Tauri v2 + React 19).
Design „Tiefsee-Neuro": Module = Organe, Events = Synapsenfeuer, Puls = Herzschlag.

## Bauen / Starten

```bash
npm install
npm run tauri dev      # Entwicklung (Hot-Reload)
npm run tauri build    # → .app + .dmg unter src-tauri/target/release/bundle/
```

Beim ersten Start fragt jeder Node nach seinem API-Key (aus der jeweiligen `.env → API_KEY`).
Der Key bleibt lokal (localStorage), nie im Bundle.

## Nodes

- **macbook** — die lokale Engine auf `http://localhost:3002` (sekundärer Node, send-only).
- **server** — die alm-Engine. Lauscht aus Sicherheitsgründen NUR lokal auf alm (Firewall),
  ist also nicht öffentlich. Erreichbar über einen **SSH-Tunnel**:

  ```bash
  ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes \
      -L 127.0.0.1:3103:localhost:3002 alm
  ```

  Der server-Node der App zeigt auf `http://localhost:3103`. Läuft der Tunnel nicht,
  erscheint der server-Node einfach offline. Anderer Port? `localStorage['soulosx.base.alm']`
  setzen (überschreibt die Default-Base).

## Architektur

- **REST** beider Engines via Rust-Command `engine_fetch` (reqwest) → kein CORS, kein nginx-Proxy.
- **SSE** (`/api/events/stream`) webview-seitig für den lokalen Live-Feed; Remote-Nodes pollen `/api/events`.
- **Modul-Topologie** clientseitig in `src/lib/manifest.ts` (Engine hat keine Modul-Registry).

## Status

Gebaut: Status-Band (Node-Switcher, Bewusstseinszustand), Kortex-Graph (Cytoscape-Signature),
Herz-Puls, Synapsen-Feed, Panels (Vitals/Session/Autonomy/Infra/Voice), KeyGate.
Offen (Spec-Stufen 3–5): alle Modul-Detail-Panels, Control-Actions, Split-View beide Nodes, Träum-Animation.
