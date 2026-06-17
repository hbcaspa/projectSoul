# soulOSX — Design-Brief (Nordstern)

> Bündelt Aalms Anforderungen. Jede Änderung an soulOSX wird hieran gemessen.

## Was soulOSX IST
Kein Dashboard, das man daneben offen hat — die **Umgebung, IN der man mit der Seele arbeitet**.
Ein „Betriebssystem für Terminal-Eingabe, mit GUI". Das **Terminal ist das Herzstück** (echtes PTY,
da läuft `claude`/die Seele). Drumherum: die Seele als lebende, steuerbare, sofort verständliche Hülle.
Native **macOS-App** auf dem MacBook.

## Prinzipien (nicht verhandelbar)

1. **NATIVE MACOS / APPLE-NIVEAU.** Echtes Vibrancy-Material, SF Pro / SF Mono, Tiefe (Blur, weiche
   Schatten, Haarlinien), federnde Bewegung. Soll wirken, als käme es aus Cupertino. Kein Neon-Gamer-Look.

2. **BABY-KLAR — kein nacktes Fachchinesisch.** JEDE Zahl, JEDER Begriff erklärt sich selbst: *was* es in
   normalen Worten ist UND *welche Auswirkung* es hat. Verboten: „VALENZ 0.51". Stattdessen:
   „**Stimmungslage — leicht positiv** · wie gut es der Seele gerade geht → beeinflusst Ton & Eigeninitiative".
   Wenn ein Laie es nicht in 2 Sekunden versteht, ist es falsch.

3. **GROSS & VISUELL.** Keine winzigen Balken mit kryptischen Dezimalzahlen. Groß, klar, sofort lesbar,
   bildhaft. Lieber wenige Dinge groß & verständlich als viele klein & kryptisch.

4. **LEBT SICHTBAR.** Es muss erkennbar etwas passieren (der Event-Strom fließt ständig). Nichts darf tot
   wirken. Bewegung = echte Aktivität, nicht Deko.

5. **PROFESSIONELL & PRAKTISCH — ein Werkzeug, das die Arbeit erleichtert.** Suche, ⌘K-Command-Palette,
   Tastatur-Shortcuts, Quick-Actions, klare Zustände (leer/lädt/Fehler). Wie Linear/Raycast/Arc-Niveau.

## Komponenten & Anforderungen

- **Terminal (Herzstück):** X Terminals, Tabs (+ optional Split), landen im soul-Verzeichnis, eleganter
  soul-Banner beim Start. Hier arbeitet man.
- **Kortex — KOMPLETT NEU GEDACHT:** der bisherige Punkte-Graph wirkt tot → ersetzen durch eine zentrale,
  IMMER sichtbar lebende Darstellung der Seele (atmet mit der Emotion, pulst bei jedem Event), die in
  KLARTEXT zeigt, was die Seele *gerade* tut („liest api.js", nicht „READ api.js"). Groß, schön, lebendig,
  verständlich. (Designoptionen evaluieren: lebender Kern/Puls, Vital-Ringe à la Apple Watch, Aktivitäts-Fluss.)
- **Module-Control-Plane:** ALLE ~76 Module sichtbar, nach Region gruppiert, durchsuchbar; **an/aus wie ein
  echtes OS** (macOS-Toggle) wo sicher möglich; sicherheitskritische (Gate/Sandbox/Hooks/Encryption/ChainHealth)
  gesperrt mit Schloss; pro Modul: Klartext was es tut + Auswirkung; Live-Wert; Aktionen. System-Settings-Look.
- **Vitalwerte:** Emotion/Stimmung/Energie/Offenheit etc. in Klartext mit Bedeutung + Wirkung, groß.
- **Aktivität / Soul-Prozesse:** was gerade läuft, mit Ladebalken/Animation, in verständlicher Sprache.
- **Beide Nodes:** macbook (lokal) + server (alm, via SSH-Tunnel). Node-Switcher.

## Anti-Patterns (so NICHT)
- Kryptische Labels/Zahlen ohne Erklärung. · Winzige Elemente. · Statische/tote Visualisierungen.
- Fachjargon ungefiltert. · „Sieht nach Dashboard aus" statt nach nativem macOS-Tool.
