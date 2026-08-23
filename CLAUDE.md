# GO/NOGO – Project Rules for Claude Code

Mission control game (web, TypeScript). Full specification: `docs/CONCEPT_v4.md` (design freeze).
**Current assignment: Phase 0 ("The Countdown") – nothing beyond it.**
If this file and the concept contradict each other, the concept wins – report the contradiction instead of deciding silently.

## Language (hard)

**The project is English-only.** Everything that lives in the repository is written in English:

- Code: identifiers, types, function and file names, string literals, log and event texts.
- Comments and JSDoc – no German comments in the code.
- JSON data files: keys *and* human-readable values (`title`, `description`, …).
- Documentation, README, test names and test descriptions.
- Commit messages, branch names, PR titles and bodies (Conventional Commits, English description).

The game ships English-only for now; there is no i18n layer in Phase 0 (see the concept §9, Phase 2). Chat with the project owner is German – that is the only exception, and it never reaches the repository.

## Scope Fence (hard)

Phase 0 covers ONLY (concept §9):
- One hard-wired two-stage rocket (data in `data/rocket.json`)
- LAUNCH console: checklist switches, countdown state machine, ignition sequence
- Pitch program, live telemetry (altitude, v, G), MAX_Q/MECO/SEP/ORBIT_CHECK events
- Kepler propagator + a simple canvas orbit map
- Tick engine, command queue, RNG, replay + hash CI, save/resume
- Hotkeys `1`–`5` and `Space`; synthetic sounds (Web Audio)

Do NOT build – not even "prepare" (no scaffolding, no empty modules, no interfaces kept in stock):
- Anomaly/diagnosis system, cause graph, resource model
- Economy, contracts, markets, doctrines, tech tree, staff
- Engineering/comms console, policy editor, fleet ops, light delay
- Leaderboard/server, daily challenge, modding, i18n

If a task appears to need any of these → stop and ask.

**Phase 1 assets already in the repo:** `tools/graphLint.ts` and `data/causes.json` (concept §11, steps 1–2) were delivered by the project owner. They are Phase 1 content: they stay where they are, `src/**` never imports them, and no Phase 0 work builds on them.

## Determinism (non-negotiable, concept §8.2)

Inside `src/sim/**` this holds absolutely:

1. **NEVER** `Math.random`, `Date`, `performance.now()`, `setTimeout`/`setInterval` or any other wall-clock access.
2. **NEVER** `Math.sin/cos/tan/atan2/exp/log/pow` – these are not bit-identical across engines. Transcendental functions come exclusively from `sim/math.ts` (own implementation with pinned test vectors). Still allowed: `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `min`, `max`, `sign`.
3. **Time = integer ticks**, DT = 50 ms fixed. Time warp = more ticks per frame (numerical mode, max 4×) or analytical Kepler evaluation at t (coast). **Never scale dt.**
4. **All inputs are tick-stamped commands** through the queue. The UI never mutates sim state directly; `src/sim/` imports nothing from `src/ui/`.
5. **RNG on two tracks:** `hash64(seed, key, context)` for everything tied to configuration; separate `mulberry32` streams per system for event sequences. hash64 = 2×32-bit lane mixing (xmur3/cyrb53 family, no BigInt in the hot path). Test vectors are pinned – every change to the hash is a breaking change.
6. **State hash never via `JSON.stringify`:** canonical binary encoding (fixed schema order, `DataView.setFloat64` little-endian), hash the bytes (SHA-256). `NaN`/`Infinity` forbidden via debug assert.
7. Auto-pause is a sim state at a tick, not a UI timer.

## Architecture (concept §8.3, Phase 0 subset)

```
src/
├── sim/        engine.ts, math.ts, rng.ts, countdown.ts,
│               physics/{kepler,thrust,ascentProgram}.ts
├── data/       rocket.json, pitchProgram.json
├── replay/     run.ts, playback.ts, hash.ts
├── ui/         consoles/launch/, hotkeys.ts, audio/synth.ts,
│               widgets/{Gauge,SevenSeg,ToggleSwitch,EventLog}.svelte
└── main.ts
```

All tuning numbers (masses, Isp, thrust, pitch program, max-Q limits) live in `data/*.json` – never hard-coded.

## Stack

Vite · TypeScript strict (no `any`) · Svelte · Canvas 2D (orbit map) + SVG (gauges) · Vitest · Web Audio synthetic (no audio assets) · persistence via localStorage/IndexedDB.

## Tests & CI (mandatory – build them first, then features against them)

- `npm test` green before every commit; CI runs it on every push.
- **Replay fixture test:** seed 42 + a fixed command log → SHA-256 of the final state == the checked-in reference. If the hash breaks on purpose (physics change): update the reference deliberately and justify it in the commit.
- **Save/resume test:** save at T+90 s, resume, keep running → final state hash identical to the run without a save.
- **Double playback test:** play the same replay twice → identical hash series (every 600 ticks).
- Test vectors for `sim/math.ts` and `sim/rng.ts` are pinned.

## Way of Working

- Sim core test-first; UI afterwards against the running core.
- Small, thematic commits (Conventional Commits, English description).
- No additional dependencies without asking.

## Definition of Done – Phase 0 (concept §9/§11)

1. `HOLD → ARMED → IGNITION → LIFTOFF → MAX_Q → MECO → SEP → ORBIT_CHECK` runs with live telemetry, event log and sound.
2. CI green, including the replay, save/resume and double playback tests.
3. "You immediately want to press launch again" – a human judgment call, not yours: show the prototype to Peter.
