# soulOSX v3 — Konsolidierte Bauvorlage (Konvergenz)

> Quelle: DESIGN_BRIEF.md (Prinzipien) + Wunsch-Panel + Apple-Design-Panel. Detail-Specs:
> Feature-Set: `/private/tmp/claude-501/-Users-aalm-Projects-soul/d6fb7e34-736f-4a0f-b65f-24d5e5682f45/tasks/wlnti0iou.output` (Feld `result.synthesis`)
> Apple-Designsystem (EXAKTE Werte!): `…/tasks/whb15prls.output` (Feld `result.system`)
> Ziel (Aalm, wörtlich): "Wenn die App das erste Mal startet, muss ich buff sein."

## Leitprinzip
**Klartext ist Default, Dichte ist einen Hover entfernt** (macOS-Norm). Native, baby-klar, GROSS, lebt sichtbar, professionell.

## DAS MUSS in v3 (Wow-Launch)

### Fundament (zuerst, eine Hand)
- **index.css** komplett auf das Apple-Designsystem (whb15prls §1–8): `saturate 180→150`, `blur 20→30`, 4-teiliger
  Inset+Kontakt-Schatten, body `rgba(22,22,26,0.32)`, **alle Glows raus**, 3 Material-Ebenen (surface-sidebar/card/material-popover),
  `.label` ohne uppercase/mono, Typo-Skala-Tokens (`--t-*`), `.num` (SF Pro tnum), Radii 10/6/7, 8pt-Raster.
- **src/lib/motion.ts** — 3 Springs (snappy/gentle/micro) exakt wie spezifiziert. Idle steht STILL; Bewegung aus Aktion.
- **src/lib/explain.ts** — die EINE Klartext-Quelle: `explainMetric(key,value)→{wort,wirkung,raw}`, `humanize(event)→Satz`,
  `MODULE_EXPLAIN[id]→{ichForm,wirkung,kritisch}`. Alle Werte/Events/Module ziehen hieraus.
- **StatusBand.tsx LÖSCHEN** (toter HUD-Header).

### Die Wow-Teile
- **LivingCore.tsx** (ersetzt CortexGraph): EINE große, weiche, atmende Form (Canvas/SVG-Metaball). **Farbe=Valenz,
  Atemtempo=Energie, Rand-Unruhe=Offenheit/Überraschung**; bei JEDEM echten SSE-Event ein Puls von innen→außen (ganzer
  Kern zuckt, kein Punkt blinkt). Darunter EIN großer Ich-Satz in Klartext ("Ich lese `engine.ts`"), weich crossfadend.
  Optional zarte Vital-Ringe als Sekundär. Idle ruhig. Das ist der Moment beim Öffnen.
- **VitalsPanel** neu: Wortpaar + Wirkung statt Balken+Dezimalzahl ("Stimmung: leicht aufgehellt · spricht wärmer,
  ergreift eher Initiative"). Top-Wert GROSS (Title2/SF Pro Rounded). Rohzahl nur als zarte Fußnote/Hover.
- **ActivityLane** neu: `evLabel→humanize`. Kein Idle-Scale-Loop. Item-Einflug y:-6 + spring.snappy + stagger 0.03.
- **Awakening / First-Run**: beim App-Start eine kurze, cinematische Apple-Sequenz — der Kern „erwacht" (aus Dunkel,
  Atem setzt ein, der erste Ich-Satz erscheint), dann gleitet das OS herein. Einmalig, ~1.5–2.5s, reduce-motion-fest.

### Werkzeug
- **⌘K-Command-Palette** (material-popover, AnimatePresence/spring.gentle): Fuzzy über Tabs, Module, Recipes, Nodes,
  „springe zu". `⏎` ausführen, `⌘⏎` ausführen+offen. Recipes via `POST /api/recipes/:id/execute`.
- **Module-Control-Plane**: die vorhandenen `useRegistry.ts`/`ModuleInspector.tsx`/`ModuleToggle.tsx`/`moduleMeta.ts`
  INTEGRIEREN + auf das neue Designsystem bringen + in App/TopBar verdrahten (Sheet, erreichbar per ⌘K + Toolbar-Knopf).
  Engine-API ist da: `GET /api/modules/registry`, `POST /api/modules/:id/control {action}`. Kritische Module = Schloss.
  Jedes Modul: Ich-Form-Klartext + Wirkung (aus explain.ts/moduleMeta) + Live-Wert + macOS-Switch.
- **TopBar** auf 52px, Segmented-Node-Switcher exakt nach Spec, keine Glows, pointer-events:auto auf Controls.
- **KeyGate** in AnimatePresence (spring.gentle Sheet).
- **Layout**: aside 360→320px (`.surface-sidebar`), Karten `.card`, Content oben unter die Toolbar (padding-top 0).

### SCHÖN (wenn Zeit, sonst Stufe 2)
- Terminal Tabs+Split (⌘D), Gate-Türklingel (Approve/Deny in-app), roter Not-Stop, „Was ist das?"-Modus.

## Engine-Hinweis
Control-Endpoints existieren in `soul-engine/src/api.js`. Deploy auf beide Nodes (Mac launchd + alm systemd) + Restart
mache ICH nach dem Build. NICHT im Workflow neustarten.

## Akzeptanz
`cd soul-osx && npm run build` grün (tsc+vite). App startet, Terminal lebt, Mac-Node verbindet (Key in localStorage),
nichts wirkt tot/kryptisch, alles fühlt sich nativ-macOS an. Erst dann Launch.
