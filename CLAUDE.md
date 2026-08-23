# GO/NOGO – Projektregeln für Claude Code

Missionskontroll-Spiel (Web, TypeScript). Vollständige Spezifikation: `docs/KONZEPT_v4.md` (Design-Freeze).
**Aktueller Auftrag: Phase 0 („Der Countdown") – nichts darüber hinaus.**
Bei Widerspruch zwischen diesem File und dem Konzept gilt das Konzept – Widerspruch melden statt still entscheiden.

## Scope-Zaun (hart)

Phase 0 umfasst NUR (Konzept §9):
- Eine fest verdrahtete 2-Stufen-Rakete (Daten in `data/rakete.json`)
- LAUNCH Console: Checklisten-Schalter, Countdown-State-Machine, Zündsequenz
- Pitch-Programm, Live-Telemetrie (Höhe, v, G), MAX_Q/MECO/SEP/ORBIT_CHECK-Events
- Kepler-Propagator + simple Canvas-Orbitkarte
- Tick-Engine, Command-Queue, RNG, Replay + Hash-CI, Save/Resume
- Hotkeys `1`–`5` und `Space`; synthetische Sounds (Web Audio)

NICHT bauen – auch nicht „vorbereiten" (kein Scaffolding, keine leeren Module, keine Interfaces auf Vorrat):
- Anomalie-/Diagnose-System, Ursachen-Graph, Ressourcen-Modell
- Wirtschaft, Verträge, Märkte, Doktrinen, Tech-Baum, Personal
- Engineering-/Comms-Console, Policy-Editor, Fleet Ops, Lichtlaufzeit
- Leaderboard/Server, Daily Challenge, Modding, i18n

Wenn eine Aufgabe scheinbar etwas davon braucht → stoppen und nachfragen.

## Determinismus (nicht verhandelbar, Konzept §8.2)

In `src/sim/**` gilt absolut:

1. **NIEMALS** `Math.random`, `Date`, `performance.now()`, `setTimeout`/`setInterval` oder sonstiger Wanduhr-Zugriff.
2. **NIEMALS** `Math.sin/cos/tan/atan2/exp/log/pow` – diese sind nicht engineübergreifend bitidentisch. Transzendente Funktionen kommen ausschließlich aus `sim/math.ts` (eigene Implementierung mit gepinnten Testvektoren). Erlaubt bleiben: `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `min`, `max`, `sign`.
3. **Zeit = Integer-Ticks**, DT = 50 ms fest. Time Warp = mehr Ticks pro Frame (numerischer Modus, max 4×) bzw. analytische Kepler-Auswertung bei t (Küstflug). **Niemals dt skalieren.**
4. **Alle Eingaben sind tickgestempelte Commands** über die Queue. Die UI mutiert nie Sim-Zustand direkt; `src/sim/` importiert nichts aus `src/ui/`.
5. **RNG zweigleisig:** `hash64(seed, schlüssel, kontext)` für alles Konfigurationsgebundene; getrennte `mulberry32`-Streams pro System für Ereignisfolgen. hash64 = 2×32-Bit-Lane-Mixing (xmur3/cyrb53-Familie, kein BigInt im Hot Path). Testvektoren sind gepinnt – jede Änderung am Hash ist ein Breaking Change.
6. **Zustands-Hash nie über `JSON.stringify`:** kanonische Binärcodierung (feste Schema-Reihenfolge, `DataView.setFloat64` little-endian), Bytes hashen (SHA-256). `NaN`/`Infinity` per Debug-Assert verboten.
7. Auto-Pause ist ein Sim-Zustand an einem Tick, kein UI-Timer.

## Architektur (Konzept §8.3, Phase-0-Subset)

```
src/
├── sim/        engine.ts, math.ts, rng.ts, countdown.ts,
│               physics/{kepler,thrust,ascentProgram}.ts
├── data/       rakete.json, pitchProgramm.json
├── replay/     run.ts, playback.ts, hash.ts
├── ui/         consoles/launch/, hotkeys.ts, audio/synth.ts,
│               widgets/{Gauge,SevenSeg,ToggleSwitch,EventLog}.svelte
└── main.ts
```

Alle Tuning-Zahlen (Massen, Isp, Schub, Pitch-Programm, Max-Q-Grenzen) liegen in `data/*.json` – nie hartkodieren.

## Stack

Vite · TypeScript strict (kein `any`) · Svelte · Canvas 2D (Orbitkarte) + SVG (Gauges) · Vitest · Web Audio synthetisch (keine Audio-Assets) · Persistenz localStorage/IndexedDB.

## Tests & CI (Pflicht – zuerst bauen, dann Features dagegen)

- `npm test` grün vor jedem Commit; CI führt es bei jedem Push aus.
- **Replay-Fixture-Test:** Seed 42 + festes Command-Log → SHA-256 des Endzustands == eingecheckte Referenz. Bricht der Hash absichtlich (Physikänderung): Referenz bewusst aktualisieren und im Commit begründen.
- **Save/Resume-Test:** Save bei T+90 s, Resume, weiterlaufen → Endzustands-Hash identisch mit dem Durchlauf ohne Save.
- **Doppel-Playback-Test:** Zweimal dasselbe Replay abspielen → identische Hash-Reihe (alle 600 Ticks).
- Testvektoren für `sim/math.ts` und `sim/rng.ts` sind gepinnt.

## Arbeitsweise

- Sim-Kern test-first; UI danach gegen den laufenden Kern.
- Kleine, thematische Commits (Conventional Commits, deutsche Beschreibung ok).
- Keine zusätzlichen Dependencies ohne Rückfrage.

## Definition of Done – Phase 0 (Konzept §9/§11)

1. `HOLD → ARMED → IGNITION → LIFTOFF → MAX_Q → MECO → SEP → ORBIT_CHECK` läuft mit Live-Telemetrie, Event-Log und Sound.
2. CI grün, inklusive Replay-, Save/Resume- und Doppel-Playback-Test.
3. „Man will sofort wieder Start drücken" – menschliches Urteil, nicht deins: Prototyp Peter vorführen.
