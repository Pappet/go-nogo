# GO/NOGO – Project Rules for Claude Code

Mission control game (web, TypeScript). Full specification: `docs/CONCEPT_v4.md` (design freeze).
**Current assignment: Phase 2 ("The Game Emerges") – nothing beyond it.**
Phases 0 and 1 are delivered and merged; they are the foundation everything below builds on.
If this file and the concept contradict each other, the concept wins – report the contradiction instead of deciding silently.

## Language (hard)

**The project is English-only.** Everything that lives in the repository is written in English:

- Code: identifiers, types, function and file names, string literals, log and event texts.
- Comments and JSDoc – no German comments in the code.
- JSON data files: keys *and* human-readable values (`title`, `description`, …).
- Documentation, README, test names and test descriptions.
- Commit messages, branch names, PR titles and bodies (Conventional Commits, English description).

The game ships English-only for now. Phase 2 externalises the strings so a later i18n layer is cheap (§9) – externalising is in scope, translating is not. Chat with the project owner is German – that is the only exception, and it never reaches the repository.

## Scope Fence (hard)

Phase 2 covers ONLY (concept §9):
- Parts with serial numbers, QA levels and redundancy (§4, §4.1, §4.2) – reliability drawn as `hash64(seed, serialNo, …)`, so the same part is the same part in every what-if
- **Configurator** with QA levels and redundancy; **risk budget live** (§5.4) – the Phase 1 static budget goes away
- 3 doctrines (§6.1), 3 markets with reputation and **minimum guarantee** (§6.2), weekly board
- Tech tree levels 1–3 (propulsion + avionics) including the first exclusive fork (§6.4)
- COMMS console, research data (§6.3), **staff minimal** (§6.5), **bankruptcy soft fail** (§6.6)
- **Mid-mission save prominent** (the auto-save runs anyway, §8.2)
- 2 starting scenarios; **sandbox unlock** after the first orbit (§6.7)
- **Tutorial missions** – scripted 1:1 crises on the seed/replay infrastructure
- **i18n preparation:** strings external, seven-segment widgets with a text fallback for non-ASCII
- Hotkey rebinding (§7.7: "rebinding from Phase 2"); every new UI function ships with a hotkey

Do NOT build – not even "prepare" (no scaffolding, no empty modules, no interfaces kept in stock):
- Policy editor, light delay, real-time mode, fleet ops (Phase 3a/3b)
- Leaderboard/server, daily and weekly challenge (§6.8 – the backend is Phase 3b)
- Ghost replays, post-mortem export as image/text, achievements (Phase 4)
- Steam Workshop / Tauri port (Phase 4). The `/mods` folder and its schema validation (§8.5) stay out until someone asks – the data architecture already permits it, which is not the same as shipping it.
- Actual translations. Phase 2 externalises strings; it does not add a second language.

If a task appears to need any of these → stop and ask.

**Phases 0 and 1 stay honest.** The countdown, the physics, the engine, the replay harness, the cause graph, the anomaly runtime and the LAUNCH/ENGINEERING/POST-MORTEM consoles are delivered. Changing them is allowed where Phase 2 genuinely needs it – the configurator in particular *will* reach into the risk budget and the retry paths – but a moved replay hash is a breaking change: regenerate the fixture deliberately and justify it in the commit.

**Two things Phase 1 deliberately left for this phase:**
1. The second retry button (§5.4) currently rolls a whole new mission key because there was no configuration to change. With the configurator it must become what §5.4 asks for: the planner reopens and **only changed parts re-roll**.
2. The risk budget is a static number in `src/data/riskBudget.json`. It becomes a computation over the actual configuration.

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

## Architecture (concept §8.3, Phase 0 + 1 + 2 subset)

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

Phase 1 added (concept §8.3):

```
src/
├── sim/diagnosis/   causeGraph.ts, priors.ts, measures.ts, postMortem.ts
├── sim/systems/     anomaly.ts
├── sim/             pauseModel.ts
├── data/            causes.json, anomalies.json, priors.json
└── ui/consoles/     engineering/, postmortem/
```

Phase 2 adds (concept §8.3):

```
src/
├── sim/parts/       partInstance.ts, qa.ts, redundancy.ts
├── economy/         riskBudget.ts, markets.ts, reputation.ts, staff.ts, techTree.ts, campaign.ts
├── data/            parts.json, doctrines.json, contracts.json, techtree.json, scenarios.json
├── ui/consoles/     configurator/, comms/
├── ui/strings.ts    every user-facing string, externalised (i18n preparation)
└── save/            campaign persistence
```

`src/economy/` is not `src/sim/`: it is the between-missions layer, it holds no ticks, and the
determinism rules that bind `src/sim/**` do not apply to it. What *does* bind it: every draw that
decides a mission outcome — a part's reliability above all — is `hash64(seed, serialNo, context)`,
because §5.4's surgical re-roll and the post-mortem's what-if both stand or fall on it.

All tuning numbers (masses, Isp, thrust, pitch nodes, max-Q limits, measure durations, escalation
windows, resource capacities, part costs, QA multipliers, contract fees, reputation deltas) live
in `src/data/*.json` – never hard-coded.

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

## Definition of Done – Phase 2 (concept §9)

1. **Two campaigns with different doctrines feel different after 3 hours – not merely repainted.**
2. The configurator makes the risk budget live: changing a QA level or adding redundancy moves the
   loss-of-mission number, and the mass it costs shows up in the Δv.
3. §5.4's second retry path is surgical: reopening the planner and changing one part re-rolls
   *that part only*. Everything else about the mission stays identical, and a test proves it.
4. CI green: the Phase 0 replay, save/resume and double playback tests still pass, plus the graph
   linter.
5. Criterion 1 is a human measurement, not yours: it needs a player and three hours. What you can
   do is make the two campaigns *mechanically* divergent and say where you measured it.

### Phase 1 – delivered
An anomaly appears, is diagnosable under resource scarcity, and a wrong measure has a consequence
the post-mortem shows. Its criterion 3 – 3 testers × 5 runs, "done when run 5 still surprises",
alongside the A/B on unlimited queuing – is still an open human measurement, and it stays open
until someone runs it. Do not quietly treat it as passed.
