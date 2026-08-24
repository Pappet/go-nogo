# GO/NOGO – Project Rules for Claude Code

Mission control game (web, TypeScript). Full specification: `docs/CONCEPT_v4.md` (design freeze).
**Current assignment: Phase 1 ("The Diagnosis") – nothing beyond it.**
Phase 0 is delivered and merged; it is the foundation everything below builds on.
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

Phase 1 covers ONLY (concept §9):
- Cause graph v1 as data: 4 causes, 6 symptoms, 8 measures, 2 side-effect chains (`src/data/causes.json`) – **the linter runs in CI** (§8.4)
- Anomaly runtime: seeded symptom instances with varying `strength`/`delay_s`, context priors v1 (§5.2)
- Resource model (§5.2): a measure occupies resources for its duration; conflict-free measures run **in parallel**
- Pause model Standard (§5.7): auto-pause once per *new* anomaly, soft RESULT READY offer, unlimited queuing, command timeline preview
- ENGINEERING console: diagnosis panel with candidate bars, measures with costs, act-without-certainty row, escalation clock, channel matrix (4 channels)
- Risk budget (static), post-mortem with the cause chain, two retry buttons (§5.4)
- Hotkey scheme §7.7 – **mandatory from this phase**, including `1`–`5` for console switching

Do NOT build – not even "prepare" (no scaffolding, no empty modules, no interfaces kept in stock):
- Economy, contracts, markets, doctrines, tech tree, staff hiring
- Configurator with QA levels and redundancy (Phase 2 – the Phase 1 risk budget is *static*)
- COMMS console beyond the channel matrix, policy editor, fleet ops, light delay (Phase 3a/3b)
- Real-time mode (§5.7 – Phase 3a); Phase 1 ships Standard only
- Leaderboard/server, daily challenge, modding, i18n, tutorial missions

If a task appears to need any of these → stop and ask.

**Phase 0 stays honest.** The countdown, the physics, the engine, the replay harness and the LAUNCH console are delivered. Changing them is allowed where Phase 1 genuinely needs it – but a moved replay hash is a breaking change: regenerate the fixture deliberately and justify it in the commit.

## Determinism (non-negotiable, concept §8.2)

Inside `src/sim/**` this holds absolutely:

1. **NEVER** `Math.random`, `Date`, `performance.now()`, `setTimeout`/`setInterval` or any other wall-clock access.
2. **NEVER** `Math.sin/cos/tan/atan2/exp/log/pow` – these are not bit-identical across engines. Transcendental functions come exclusively from `sim/math.ts` (own implementation with pinned test vectors). Still allowed: `Math.sqrt`, `abs`, `floor`, `ceil`, `round`, `trunc`, `min`, `max`, `sign`, `imul`.
   The test for this rule is not "is it on `Math`" but "does the language pin the result down". `Math.imul` is a 32-bit integer multiply the spec defines exactly, which is why the RNG uses it and why it is the opposite case to `Math.sin`. Anything not on the allowed list stays out until someone can point at the same guarantee.
3. **Time = integer ticks**, DT = 50 ms fixed. Time warp = more ticks per frame (numerical mode, max 4×) or analytical Kepler evaluation at t (coast). **Never scale dt.**
4. **All inputs are tick-stamped commands** through the queue. The UI never mutates sim state directly; `src/sim/` imports nothing from `src/ui/`.
5. **RNG on two tracks:** `hash64(seed, key, context)` for everything tied to configuration; separate `mulberry32` streams per system for event sequences. hash64 = 2×32-bit lane mixing (xmur3/cyrb53 family, no BigInt in the hot path). Test vectors are pinned – every change to the hash is a breaking change.
6. **State hash never via `JSON.stringify`:** canonical binary encoding (fixed schema order, `DataView.setFloat64` little-endian), hash the bytes (SHA-256). `NaN`/`Infinity` forbidden via debug assert.
7. Auto-pause is a sim state at a tick, not a UI timer.

## Architecture (concept §8.3, Phase 0 + 1 subset)

Delivered in Phase 0:

```
src/
├── sim/        engine.ts, math.ts, rng.ts, countdown.ts, flight.ts,
│               physics/{kepler,thrust,ascentProgram,ascent,constants}.ts
├── data/       rocket.json, pitchProgram.json, checklist.json
├── replay/     run.ts, playback.ts, hash.ts, sha256.ts
├── ui/         consoles/launch/, hotkeys.ts, format.ts, mission.svelte.ts,
│               audio/synth.ts, widgets/*.svelte
└── main.ts
```

Phase 1 adds (concept §8.3):

```
src/
├── sim/diagnosis/   causeGraph.ts, priors.ts, measures.ts
├── sim/systems/     anomaly.ts
├── data/            causes.json
└── ui/consoles/     engineering/, postmortem/
```

All tuning numbers (masses, Isp, thrust, pitch nodes, max-Q limits, measure durations,
escalation windows, resource capacities) live in `src/data/*.json` – never hard-coded.

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

## Definition of Done – Phase 1 (concept §9)

1. An anomaly appears, is diagnosable under resource scarcity, and a wrong measure has a consequence the post-mortem can show.
2. CI green: the Phase 0 replay, save/resume and double playback tests still pass, plus the graph linter.
3. **Replay test:** 3 testers play the same mission 5×; we measure from which run on they guess correctly without diagnosing. **Done when run 5 still surprises** – otherwise densify the graph before Phase 2. The A/B comparison "unlimited queuing vs. one action per pause" runs alongside.
4. Criterion 3 is a human measurement, not yours: it needs testers on a real screen.
