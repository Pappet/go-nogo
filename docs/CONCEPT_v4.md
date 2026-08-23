# 🚀 GO/NOGO – Game Concept v4 (Design Freeze)

**Working title:** *GO/NOGO* (trademark research before Phase 2, then lock it in)

> **Design principle:** *Replay value comes from decision space, not from dice.*
> **Axioms:** *Pause stops the simulation, never the cost. Every die roll is addressable. The control room works in parallel – diagnosis is a sequencing puzzle, not a menu.*
>
> **Status: Design Freeze.** From now on, this document only changes based on playtest evidence (Phase 1 replay test), not on further review rounds – the marginal value of more iteration has been reached.

---

## 0. Change History

**v1 → v2** (short version): Cause graph instead of failure table · Risk budget with a price tag · Doctrines, markets, exclusive tech forks · Counter-scaling (fleet, light delay, policies) · Determinism specification from Phase 0 onward.

**v2 → v3** (incorporating the Ox Alpha review + two additions of our own):

| # | Review point | Answer in v3 | Section |
|---|---|---|---|
| 1 | Pause paradox | **Pause as a difficulty axis**: pause stops the sim, but measures cost sim time – pause = thinking, acting = time | §5.7 |
| 2 | Long-term flattening of diagnosis | Context-dependent candidate priors, varying symptom strengths, **timed mechanic unlocks** against graph fatigue | §5.8 |
| 3 | Retry = same crash | Two explicit paths after a loss: "same seed" (learning) / "new configuration" (loop) – thanks to point 4, **only changed parts re-roll** | §5.4 |
| 4 | RNG architecture | **Counter-/hash-based draws** for everything tied to configuration; sequential streams only for genuine event *sequences*. Makes what-if exact | §8.2 |
| 5 | Undefined edge systems | Staff minimally specified, bankruptcy as soft fail, mid-mission save mandatory, **hotkey scheme from Phase 1** | §6.5, §6.6, §7.7, §8.2 |
| 6 | Policy editor UX | Visual chip editor + template library, text mode only as an expert view | §5.6 |
| 7 | Graph needs tooling | **Linting the cause graph in CI** (4 rules + time window check) | §8.4 |
| 8 | Phase 3 overloaded | Split into **3a** (light delay + policies) and **3b** (fleet + infrastructure) | §9 |
| 9 | Economy degeneration | Contract board minimum guarantee + balancing metric "market usage per campaign" | §6.2 |
| + | *(own addition)* Daily challenge scoring was missing | **Time-independent scoring** (profit → precision → residual risk): rewards risk management, defuses the pause problem on the leaderboard | §6.8 |
| + | *(review §3)* Modding & sandbox unused | Modding as an explicit feature (the data architecture gives it away for free), sandbox mode after the first milestone | §8.5, §6.7 |
| + | *(review §4)* Replay robustness | Version pinning (game + data), state hash every 600 ticks to localize desyncs | §8.2 |

**v3 → v4** (final review – specification gaps at the system boundaries closed):

| # | Finding | Answer in v4 | Section |
|---|---|---|---|
| 1 | Action concurrency undefined (biggest lever) | **Resource model**: actions occupy resources for their duration, conflict-free actions run **in parallel** – diagnosis is a sequencing puzzle under resource scarcity | §5.2 |
| 2 | Linter rule 4 wrongly formulated for parallelism | Now checks the **critical path (makespan)** under resource constraints instead of the sum | §8.4 |
| 3 | Pause queue ambiguous; result auto-pause and "critical phase" undefined | **Unlimited queuing** + command timeline preview; "RESULT READY" soft pause; phase flag in the mission data | §5.7 |
| 4 | Daily: tiebreaker contradicts the thesis, losers invisible, server missing | Tiebreaker 2 = **lowest launch mass**; crashed runs appear on the board; leaderboard backend as a work package in 3b | §6.8, §9 |
| 5 | Hashing practice: float serialization, hash64 primitive open | Canonical **binary encoding** (DataView, LE) instead of JSON.stringify; hash64 as 2×32 lane mixing with pinned test vectors | §8.2 |
| 6 | Fatigue table tied to the mission counter | Unlocks tied to **campaign milestones** – complexity arrives with capability, not with the calendar | §5.8 |
| 7 | Edge points: tutorial, i18n, Q/W/E binding, freeze × fork, investor contracts | Tutorial + i18n decision placed in Phase 2; stable measure ordering; freeze and dictated-contract rules made precise | §6.6, §7.7, §9 |
| + | *(review bonus)* Serial number lore | Part history visible in the post-mortem – "valve #4731 was already suspicious in mission 3" | §7 |

---

## 1. Vision & Pitch

> **"You are the flight director of a small space startup. From the first wobbling solid-fuel vehicle to an autonomous probe network across the solar system – every mission runs live through YOUR console. And every risk that materializes is one you saw beforehand and knowingly accepted."**

| Aspect | Description |
|---|---|
| **Genre** | Simulation/management hybrid ("reverse Kerbal": not build & fly, but control & decide) |
| **Platform** | Web app (desktop-focused), later Tauri/Electron for Steam |
| **Player role** | Flight director + startup CEO in one person |
| **Core feeling** | Tension through responsibility: read telemetry, narrow down causes, decide under pressure – with risks you bought yourself |
| **Session length** | 10–40 min per mission; campaign across many hours; sandbox afterwards |
| **Replay value** | Doctrines × scenarios × tech forks as a strategic space; seeded runs, daily challenge, ghost replays, modding |

**Design fundamentals:**
1. The player *controls* but does not *fly*. Rockets follow programs – the craft lies in planning and in handling the unexpected.
2. *No dice without a price tag.* Every random component is either bought by the player (cheap parts, no testing, no redundancy) or announced in the briefing (solar storm forecast).
3. *(new)* *Pause is thinking time, not acting time.* Every measure costs sim seconds – stopping defers decisions, it does not replace them.

---

## 2. Core Gameplay Loop

```
┌──────────────────────────────────────────────────────────────┐
│  0. DOCTRINE      (once per campaign) choose startup profile  │
│      ↓                                                        │
│  1. OFFICE        Contract board (3 markets), budget, staff,  │
│      ↓            reputation                                  │
│  2. MISSION PLANNING  Configure vehicle, choose QA level,     │
│      ↓                redundancy vs. mass, read RISK BUDGET   │
│  3. PRELAUNCH     Checklists, GO/NOGO poll, countdown         │
│      ↓                                                        │
│  4. LIVE OPS      ◄── Heart of it: read symptoms, pay for     │
│      │               DIAGNOSIS or act blind, authorize        │
│      │               maneuvers, time warp in quiet phases     │
│      ↓                                                        │
│  5. DEBRIEF       Post-mortem with replay: "risk 9 % accep-   │
│      ↓               ted – materialized: gimbal bearing"      │
│      ↓            → retry: same seed OR new config            │
│  6. GROWTH        Invest money/data, choose a FORK,           │
│      └────────────► build market reputation                   │
└──────────────────────────────────────────────────────────────┘
```

**Tension arc per mission:** calm planning → adrenaline at launch → time warp as the rhythm keeper → crisis as a puzzle under time pressure → deliverance or catastrophe.

---

## 3. Simulation Core (Physics) – *as in v2*

2D world, patched conics, Kepler propagation, Tsiolkovsky, pitch program instead of live steering, Hohmann maneuver planner, simplified aerodynamics. Reference values: μ Earth 398,600 km³/s², LEO ≈ 7.78 km/s, Δv to LEO ≈ 9.3–9.5 km/s.

**Two propagation modes** (prerequisite for determinism, §8.2):

| Mode | When | Computation | Time warp |
|---|---|---|---|
| **Numerical** | Burn phase, atmosphere | Fixed step, dt = 50 ms | max 4× (= 4 ticks per frame, **never** scale dt) |
| **Analytical** | Coast phase | Closed-form Kepler: position(t) exact | arbitrary, dt-independent |

**Light delay:** `delay = dist / c` in both directions. Mars: 3–22 minutes. Telemetry is old, commands arrive later – the endgame plays fundamentally differently (§5.6).

---

## 4. Component System (Parts) – *as in v2, RNG binding new*

Spread is **visible as a band** and **influenced by QA**; the exact value stays hidden, the risk does not.

```typescript
interface PartInstance extends PartDef {
  serialNo: string;                     // ← key for the counter-based draw (§8.2)!
  qaLevel: 'series'|'acceptance'|'qualification'|'flightProven';
  visibleBand: [number, number];        // shrinks with QA
  effectiveReliability: number;         // = hash(seed, serialNo, 'rel') → scaled into the band
  wear: number;
  flightHistory: MissionRef[];
}
```

### 4.1 QA Levels (Time and Money for Certainty)

| Level | Cost | Build time | Effect |
|---|---|---|---|
| **Series** | 1.0× | +0 days | Band as delivered by the manufacturer (e.g. 0.88–0.98) |
| **Acceptance test** | 1.3× | +3 days | Band halved, outliers screened out |
| **Qualification / hot fire** | 1.8× | +10 days | Exact value known, +0.01 |
| **Flight-proven** | – | – | Value known, wear +1 |

Because the draw is tied to the `serialNo` (§8.2): **the same part is the same part in every what-if.** "An acceptance test would have screened out this valve" is therefore a provable statement, not an approximation.

### 4.2 Redundancy Costs Mass – *as in v2*

Backup valve, second telemetry channel, battery string, inertial fallback: everything weighs something, everything eats Δv. Lighter and riskier or heavier and safer – the risk budget (§5.4) shows the effect immediately.

---

## 5. ⚠️ Anomaly System v3

### 5.1 Cause Graph – *as in v2*

Symptoms and causes are decoupled: every cause produces 1–3 symptoms, every symptom can come from 2–4 causes. The player sees the symptom, never the cause.

| Symptom | Possible causes |
|---|---|
| Tank pressure dropping −4 %/min | Sluggish valve · Leak · Pressure sensor defective · Heater failed (cryo) |
| Steering noisy, wobble | Gimbal bearing · Sensor noise · Propellant slosh · Structural oscillation |
| Telemetry patchy | Antenna pointing · Handoff · Flight computer reset · Voltage problem |
| Bus voltage sagging | Cell defective · Short circuit · Panel shadowed · Measurement error |

### 5.2 Diagnosis Costs – *as in v2, plus context priors*

Buying certainty: sensor cross-check (10 s, 1 channel) · test pulse (20 s, propellant, risky) · engineering team (45 s, faster with a specialist engineer, §6.5) · bring up a channel (displaces another channel). Telemetry bandwidth is limited (direct link 4 channels, relay 12) – comms tech is diagnosis tech.

**New:** candidate probabilities are **context-dependent**: flight phase, temperature profile, mission history and part history shift the priors. "Tank pressure dropping" at max-Q has different likely causes than during coast with active cryo heating. In addition, `strength` and `delay_s` of the symptoms vary per instance (seeded) – the same cause never looks exactly the same.

**Resource model (concurrency, mandatory – decision from the final review):** every action occupies one or more resources for its duration: a telemetry channel, the relevant specialist engineer, the fuel line, the power budget, a flight computer slot. **Anything without a resource conflict runs in parallel.** Cross-check (10 s, occupies 1 channel) and asking the team (45 s, occupies the engineer) simultaneously = **45 s makespan instead of a 55 s sum** – with a 52-second escalation window, that is the difference between solvable and lost. Diagnosis is therefore a sequencing puzzle under resource scarcity, not a menu – and exactly the flight director fantasy: real control rooms work on parallel tracks.

```typescript
interface Measure {
  // … as before, plus:
  duration_s: number;
  occupies: ResourceId[];   // e.g. ['channel:any', 'engineer:prop'] – exclusive for duration_s
}
```

### 5.3 Wrong Measures Have Consequences – *as in v2*

Increasing pressure on a leak → the leak grows. Inertial navigation with a healthy sensor → drift. Shutting down loads on a measurement error → heater off → valve freezes (**new anomaly**). The chains live in the data (`side_effects`), the post-mortem reveals them.

### 5.4 Risk Visible + Retry via Two Paths

Risk budget in the planner *as in v2*: loss-of-mission estimate from bands, phase factors, redundancy, duration – every line item with a price tag you can push on. Post-mortem: *"Risk accepted: 11 %. Materialized: gimbal bearing."*

**Trigger mechanics made precise:** anomalies are determined at launch from seed + configuration – but via **counter-based draws per part** (§8.2), not via a sequential roll series.

**Two explicit buttons after a loss:**

| Button | What happens | Purpose |
|---|---|---|
| **"Same seed, same configuration"** | Identical run | Learning: diagnose the crisis correctly this time |
| **"New configuration"** | Planner opens with the last config; **only changed parts re-roll**, everything else stays identical | The actual loop: raise QA, buy redundancy, buy risk differently |

The surgical re-roll is the answer to "11 % materialized even though I did nothing wrong": whoever puts the defective valve through an acceptance test gets a *provably* different result – and the rest of the mission stays comparable. Optional pressure valve (verify in playtest): one seed re-roll per campaign in exchange for reputation.

### 5.5 Fairness Rule – *as in v2*

"Every anomaly is solvable with information – but information costs time, bandwidth or propellant. Sometimes the right decision is to abort, and it is scored as such." A clean abort pays a partial fee and reputation.

### 5.6 Counter-Scaling & Policies – *as in v2, editor UX new*

Tension budget of 2–4 relevant events per mission, held by mission complexity instead of loaded dice: more subsystems (cryo: boil-off, heating), fleet ops (2–3 vehicles), light delay, your own infrastructure failing.

**Policy editor (avionics 4) – UX is mandatory:** no free text. **Chip-based visual editor**:

```
┌ Policy: "Deep Space Standard" (cloned from template) ─────────┐
│  IF [bus voltage ▾] [< ▾] [24 V]  THEN [payload off ▾]        │
│                                   AND  [hold comms ▾]         │
│  IF [tank pressure ▾] [< ▾] [85 %] THEN [abort burn ▾]        │
│  + add rule                [template library] [simulate]      │
└───────────────────────────────────────────────────────────────┘
```

Prefabricated policies to clone and adapt; "simulate" replays the policy against the last replay ("rule 2 would have fired at T+03:07"). Text view only as an expert mode. A bad policy remains its own class of anomaly – the player becomes the flight director of a fleet, not a spectator.

### 5.7 Pause Model as a Difficulty Axis (new – resolves the pause paradox)

The core rule that resolves the paradox: **pause stops the simulation, not the cost.** While paused, the player can read, compare candidates and **queue any number of actions in the command queue** – but each one costs sim seconds, occupies its resources (§5.2) and only takes effect after resuming. The escalation clock keeps running in sim time and limits abuse on its own; there is no "one action per pause" limit (the one-action variant runs alongside in the Phase 1 replay test as a cheap A/B comparison). Pause = thinking. Acting = time.

**Command timeline preview:** queued commands are shown with their landing times against the escalation marker – "acting costs time" thus becomes visibly *planned* instead of merely explained:

```
NOW ────┬─────────┬───────────────┬────────── ▲ ESCALATION
        │ +10 s   │ +20 s         │ +45 s     │ +52 s
        cross-    test pulse      team
        check     (waits for a    response
        done      free channel)   done
```

| Mode | Rules | Audience |
|---|---|---|
| **Standard** | Auto-pause once per *new* anomaly; **soft "RESULT READY" pause offer** when a diagnosis result arrives; manual pause after that (unlimited) | Default, campaign |
| **Real time** | No auto-pause, no manual pause during critical phases. **"Critical phase" is a data flag per mission phase**: ignition → orbit check, plus every active anomaly until it is resolved. Escalation window ×1.5 at tech levels 1–2 | Experienced players, "hardcore" boards |
| **Daily challenge** | Standard rules, fixed. The reason is **uniformity** (everyone plays the same rules), not fairness – since all costs are sim time, pause behavior barely affects the result anyway | Leaderboard |

**Honest positioning in the mode selection UI:** *Standard = chess with a ticking clock. Real time = reaction mode.* Both are legitimate games – anyone expecting adrenaline should not accidentally pick chess.

Pausing is therefore never an exploit: it buys an overview, but not a single sim second.

### 5.8 Long-Term Curve of Diagnosis (new – against re-flattening)

After 50 hours every player knows the meta-patterns. Three antidotes, explicitly timed:

1. **Context priors and variable symptom strengths** (§5.2): "55 %" never permanently stands for the same cause.
2. **Chains take over the late game:** individual causes become recognizable – `side_effects` chains (measurement error → heater off → icing → flameout) stay combinatorially hard. The graph grows with tech level by chain links, not just by individual cases.
3. **Milestone-coupled unlocks:** complexity arrives with *capability*, not with the calendar. The gates hang on campaign milestones, not on the mission counter – the struggling player is not handed anything their tech cannot carry; the fast player does not wait. The mission numbers are pure calibration data for content density:

| Expected fatigue (calibration) | **Gate: campaign milestone** | New mechanic |
|---|---|---|
| ~mission 10–12: base graph seen through | First cryo/hypergolic mission | Subsystems (boil-off, heating) + context priors fully in effect |
| ~mission 20–25: single-cause meta mastered | First escape / lunar transfer | Light delay + policies (Phase 3a) |
| ~mission 30+: policies mastered | First accepted multi-vehicle contract | Fleet ops + failures of your own infrastructure (Phase 3b) |

The replay test from Phase 1 (§9) delivers the first real numbers for this table.
---

## 6. Economy & Progression v3

### 6.1 Doctrine (once per campaign) – *as in v2*

| Doctrine | Strength | Price | Natural path |
|---|---|---|---|
| **Mass & Volume** | Series parts −25 %, multi-payload bonus | Precision bonuses halved, no hot fire before level 3 | Constellations, commercial |
| **Precision** | Avionics −30 %, precision bonuses ×2 | Parts more expensive, series production locked | GEO, rendezvous, government |
| **Science** | Instruments −40 %, data ×1.5, patient investor | Commercial reputation starts negative, little capital | Moon, probes |

3 doctrines × 2 starting scenarios = 6 campaign openings before the first fork.

### 6.2 Three Markets Instead of a Ladder – *as in v2, plus degeneration protection*

Government (safe, slow, demands QA) · Commercial (fast, volume, penalty clauses) · Science (exotic orbits, data + prestige). Reputation per market; contracts in one market slightly lower the others. The board regenerates weekly from reputation + tech. Milestone branches after the first LEO: GEO service / Moon / constellation – all reachable, but order, financing and fork differ.

**New – two protections against "commercial spam prints money":**
- **Minimum guarantee:** the board never contains a week without at least one contract per market that is *fulfillable with existing tech*. Nobody is locked out, but neglected markets offer worse terms.
- **Balancing metric:** "share of markets used per campaign" goes into the telemetry dashboard (daily challenge data). If a market drops below ~15 % usage across campaigns, that is a balancing alarm, not a player error.

### 6.3 Research Data – *as in v2*

Sell / keep / sell after analysis (+50 %). Downlink limited by comms. Data is also a diagnosis currency: company experience sharpens the candidate priors (§5.2).

### 6.4 Tech Tree with Exclusive Forks – *as in v2*

Levels 1–2 linear, **level 3 one exclusive choice per branch per campaign** (cryogenic ⊕ hypergolic · flight computer ⊕ ground guidance · own relay ⊕ DSN rental · large solar ⊕ RTG). Different risk profiles instead of better/worse; forks interact. New Game+ allows expensive re-research.

### 6.5 Staff – Minimally Specified (new)

No Sims-style management, just a diagnosis modifier with fixed costs:

- **2–4 engineers**, each with one specialization: prop, avionics, comms, power.
- Effect: "ask the team" in that specialty 45 s → 25 s, candidate priors in that specialty sharper.
- Fixed costs per week; the offer pool regenerates monthly; hiring in the office, one click.
- No skill trees, no morale, no name drama. The game needs no more than this – anything further would be scope creep.

### 6.6 Bankruptcy & End of Campaign – Soft Fail (new)

Account below zero for two weeks → **the investor takes over**: debt relief in exchange for conditions – the investor dictates the next 3 contracts, one tech branch is frozen for the rest of the campaign, reputation loss in all markets. That is a painful *consequence of decisions*, not a game-over screen – in keeping with the decision-space philosophy. A **second** bankruptcy in the same campaign ends it with a company post-mortem (which can be shared just like a mission post-mortem).

Two clarifications against the death spiral:
- **Freeze × fork:** the freeze preferentially hits a branch that has not been forked yet. If the affected branch is already forked, its level 4 upgrade and dependent contracts are locked instead – **a fork already taken is never changed retroactively.**
- **Dictated contracts are guaranteed feasible:** they are generated exclusively from already unlocked tech. Declining is possible but costs reputation – the soft fail is meant to punish, not to suffocate.

### 6.7 Sandbox Mode (new)

After the first campaign milestone (first stable orbit), a **free mode** unlocks: no fixed costs, no deadlines, all already researched parts, contracts optional as templates. Purpose: experimenting, testing Δv budgets, recreating story situations, screenshots. Costs almost nothing (the same sim without economy hooks) and serves the "open" promise directly.

### 6.8 Daily & Weekly Challenge – with Defined Scoring (new)

The metric was missing so far. Locked in:

- **Setup:** everyone plays the same seed, the same doctrine, a fixed budget, the same contract. Pause model: standard, fixed (§5.7).
- **Scoring (in this order):**
  1. **Profit** = fee + bonuses − mission costs (parts, QA, propellant)
  2. Tiebreaker 1: **target orbit precision**
  3. Tiebreaker 2: **lowest launch mass** – whoever completes the same mission with less safety mass (redundancy, heavy QA parts) literally dared more and ranks higher. *(The original tiebreaker "lowest accepted LOM" would have rewarded the conservative player at profit parity – the normal case with a fixed seed – and thus contradicted our own thesis.)*
- **Sim time does not count.** That removes speedrun pressure, pausing is score-neutral, and the leaderboard rewards exactly what the game means to teach: risk management. Whoever flies cheap and risky and makes it through ranks at the top – whoever tries the same and crashes ranks at the bottom. Both are the design thesis in a table.
- **Verification:** command log + state hashes (§8.2). Replays with mods are unscored (§8.5).
- **Crashed runs appear on the board** – below all successes, with negative profit. Visible failure is part of the design thesis; a leaderboard of winners only tells half of it.
- **The backend is its own work package** (endpoint, verification replay against data snapshots, snapshot store, operations) – scheduled in Phase 3b (§9); the daily launch therefore sits at the *end* of 3b.
- **Weekly challenge** (later): real-time mode as a "hardcore" board for experienced players.

---

## 7. UI/UX: The Consoles

Layout *as in v2*: full screen, dark, subtle CRT feel, monospace, tab bar at the bottom with sound. Consoles:

**① LAUNCH** – countdown, checklists, "LOM accepted: 11 %" next to the clock. **GO/NOGO poll with named stations** (BOOSTER · PROP · GUIDO · TELMU · FIDO · RANGE): one vote per station, one relay clack per click. Zero system cost, maximum atmosphere.

**② FLIGHT** – orbit map, maneuver planner, warp control. Light delay display (two clocks: vehicle time/receive time, "command arrives in 00:08:12"). Fleet tab from Phase 3b.

**③ COMMS** – signal strengths, visibility windows, downlink. **Channel matrix** (which telemetry channels are live, switching costs seconds). Policy editor (§5.6) from Phase 3a.

**④ ENGINEERING** – diagnosis panel *as in v2*: candidate bars (context-dependent, §5.2), diagnostic actions with costs, act-without-certainty row, escalation clock.

**⑤ EVENT LOG** – ticker *as in v2*, including diagnosis results and policy triggers.

**⑥ POST-MORTEM** – timeline, decision points, cause chains, what-if ("an acceptance test would have screened out this valve" – provable thanks to §8.2). Two retry buttons (§5.4). Export as a replay file; from Phase 4 additionally as image/text for sharing. **Part history is visible:** because serial numbers live across missions (`flightHistory`, wear), the post-mortem shows the prior history of every part involved – *"valve #4731 was already suspicious in mission 3."* Free company lore; the community will attach stories to their serial numbers. Zero system cost, direct fuel for sharing.

### 7.7 Hotkey Scheme (new, mandatory from Phase 1)

When a crisis lasts 60 sim seconds, the keyboard decides how the game feels:

| Key | Function |
|---|---|
| `1`–`5` | Switch console (with console sound) |
| `Space` | Pause / resume |
| `+` / `-` | Time warp up/down |
| `Q` `W` `E` | Measures in the diagnosis panel – **stable ordering**: sorted by candidate prior when the panel opens, then frozen (no reordering behind your back); key hints inline on every button |
| `D` | Focus the diagnosis menu |
| `L` | Focus the event log |
| `Enter` | GO in the poll / confirm measure |

Rebinding from Phase 2. From now on, every new UI function must be specified with a hotkey – retrofitting is expensive.

### 7.8 Accessibility (new)

Warning levels never by color alone: always **symbol + text tag + color** (`▲ WARNING`, `■ CRITICAL`). Alternative color palette for color vision deficiency (~8 % of the target audience), minimum font sizes for the monospace displays, alarm sounds distinguishable by severity (not just by volume).

Sound design *as in v2* (Web Audio, synthetic; light-delay echo on sent commands).

---

## 8. Technical Architecture

### 8.1 Stack – *as in v2*

Vite · TypeScript strict · Svelte · Canvas 2D + SVG · Web Audio · sim-owned store · JSON/IndexedDB.

### 8.2 Determinism Specification v3 (mandatory from Phase 0)

1. **The sim knows only ticks (integers).** No `Date`, no `performance.now()`, no wall-clock access in `src/sim/`.
2. **Time warp = more ticks per frame** (numerical) or analytical evaluation at `t` (coast). Never scale dt.
3. **All inputs are tick-stamped commands.** The UI writes into a queue, the sim applies them at the tick boundary.
   ```typescript
   interface Command { tick: number; type: string; payload: unknown; }
   interface Run {
     gameVersion: string;
     dataVersion: string;      // hash over data/*.json (+ mod hashes, §8.5)
     seed: number;
     configuration: MissionConfig;
     commands: Command[];
     stateHashes: { tick: number; sha256: string }[];  // every 600 ticks (30 s)
   }
   ```
4. **RNG in two mechanisms (decision from the review, fixed):**
   - **Counter-/hash-based draws** for everything tied to configuration:
     `roll = hash64(seed, part.serialNo, context)` → part #4731 has the same reliability and the same failure times no matter what else is configured. Consequences: what-if in the post-mortem is **exact**, retry with a new configuration is **surgical** (only changed parts re-roll), debugging becomes trivial ("give me the roll of part X").
   - **Sequential `mulberry32` streams** only for genuine event *sequences* without configuration ties: solar activity, market movements, contract generation. Separate streams per system, so that one extra query does not shift all subsequent rolls.
   - **The hash64 primitive is core mechanics, not an implementation detail** (what-if and surgical retry depend on it): fixed as **2×32-bit lane mixing** (xmur3/cyrb53 family, no BigInt in the hot path), with **pinned test vectors in the repo**. Every change to the hash is a breaking change and raises the dataVersion.
5. **No `Math.random`; own transcendentals** (`sim/math.ts`, Chebyshev/Taylor, ~60 lines) – `Math.sin/exp` are not bit-identical across engines.
6. **Auto-pause is a sim state** at a tick, not a UI timer.
7. **Replay compatibility:** a replay pins `gameVersion` + `dataVersion`. Daily challenge replays are archived server-side with a data snapshot; old replays run against their snapshot, not against current data. Breaking changes to `data/*.json` raise the dataVersion – policy from Phase 0 onward, not retrofitted.
8. **Desync detection:** state hash every 600 ticks in the run (see above) – a deviation is localized to a 30-second interval instead of the whole run. The hash **never** runs over `JSON.stringify` – float formatting differs between engines (the same bug class as `Math.sin`: passes locally, breaks on the first cross-browser daily). Instead: **canonical binary encoding** with a fixed schema order, `DataView.setFloat64` little-endian, hash the bytes; `NaN`/`Infinity` forbidden via debug assert.
9. **Mid-mission save = replay prefix:** serialize `{run up to tick n}`; resuming = deterministically replaying up to tick n (under a second at 20 Hz sim). Auto-save every 30 s real time and on `visibilitychange` (web tabs do get closed). This makes the save not its own system but a by-product of the replay architecture. *Noted future task (deliberately not now):* snapshot compaction for very long campaigns (state snapshot + log suffix instead of a linear total log).
10. **CI test:** seed 42 + a fixed command log → SHA-256 of the final state. If the hash breaks, the build breaks. Every sim PR must pass the replay fixtures.

### 8.3 Module Structure

```
src/
├── sim/                  // NO UI imports, NO wall clock
│   ├── engine.ts         // ticks, command queue, warp modes, pause
│   ├── math.ts           // deterministic trig/exp
│   ├── rng.ts            // hash64 draws + mulberry32 streams
│   ├── physics/          // kepler.ts, thrust.ts, ascentProgram.ts, lightDelay.ts
│   ├── diagnosis/        // causeGraph.ts, priors.ts, measures.ts
│   ├── policy/           // chip rule interpreter
│   └── systems/          // anomaly.ts, comms.ts, power.ts, fleet.ts
├── data/                 // parts.json, techtree.json, causes.json, contracts.json, doctrines.json
├── economy/              // markets.ts, reputation.ts, staff.ts, riskBudget.ts
├── replay/               // run serialization, playback, hashing, save prefix
├── tools/                // graphLint.ts (§8.4), balanceDashboard/
├── ui/
│   ├── consoles/         // launch/, flight/, comms/, engineering/, postmortem/
│   ├── widgets/          // Gauge, ToggleSwitch, SevenSeg, DiagnosisPanel, ChannelMatrix, PolicyChips
│   ├── hotkeys.ts        // central scheme (§7.7)
│   └── audio/
└── save/
```

### 8.4 Cause Graph Linting in CI (new)

The graph is data – so it is checked mechanically, on every change to `data/causes.json`:

1. Every cause has ≥ 1 correct measure **and** ≥ 1 plausibly-wrong measure (otherwise blind acting dominates).
2. No symptom has exactly one cause (otherwise it is a lookup table).
3. Every symptom is reachable from at least one cause (no dead data).
4. **Time window check (makespan):** for every cause there exists a diagnosis+measure *plan* whose **critical path under resource constraints** (§5.2) fits into the escalation window. Summing individual costs would be the wrong math under parallelism – cross-check (10 s, channel) ∥ ask the team (45 s, engineer) has a makespan of 45 s, not 55 s.
5. Every `side_effects` chain terminates (no cycle without an exit).

Only then is "a new anomaly = just one JSON entry" both true *and* safe. The paper playtest (§11) remains mandatory on top – the linter checks solvability, not tension.

### 8.5 Modding as an Explicit Feature (new)

The data architecture *is* already modding capability – it is only being named and secured:

- **`/mods` folder** with a load order; moddable: parts, cause graph, contracts, doctrines, scenarios, sounds.
- **JSON schema validation** on load (the same schemas as the linter, §8.4) – a broken mod is rejected, not loaded.
- Replays carry the mod hashes in `dataVersion`; **modded runs are excluded from daily scoring**, but shareable.
- From Phase 4: Steam Workshop integration via the Tauri port.

For a game of this kind, modding is the strongest replay-value multiplier per hour invested – and here it costs almost nothing.

---

## 9. Development Roadmap v3

### Phase 0 – "The Countdown" *(1–2 weeks)*
- Hard-wired two-stage rocket, LAUNCH console, countdown state machine, pitch program, Kepler, orbit map
- **From day 1:** tick engine, command queue, **hash64 draws + stream RNG** (the decision is made, §8.2), run format including versions and state hashes, replay + hash CI
- **Done when:** you immediately want to press "launch" again – and a replay runs bit-identically, even after a save/resume mid-flight.

### Phase 1 – "The Diagnosis" *(4 weeks + buffer)*
- Cause graph v1: 4 causes, 6 symptoms, 8 measures with side effects (JSON) — **graph linter first** (§8.4)
- Engineering console with diagnosis panel, channel matrix (4 channels), context priors v1
- **Pause model standard** including command timeline and RESULT READY (§5.7), **resource parallelism** (§5.2) and the **hotkey scheme** (§7.7) from the start; the A/B comparison "unlimited queuing vs. one action per pause" runs alongside in the replay test
- Risk budget (static), post-mortem with cause chain, **two retry buttons**
- **Replay test:** 3 testers play the same mission 5×; we measure from which run on they guess correctly without diagnosing. **Done when:** run 5 still surprises – otherwise densify the graph before Phase 2 begins. The results calibrate the fatigue table (§5.8).

### Phase 2 – "The Game Emerges" *(5–7 weeks)*
- 3 doctrines, 3 markets with reputation + **minimum guarantee**, weekly board
- Configurator with QA levels and redundancy, risk budget live
- Tech tree levels 1–3 (propulsion + avionics) including the first fork
- COMMS console, research data, **staff minimal** (§6.5), **bankruptcy soft fail** (§6.6)
- **Mid-mission save prominent** (auto-save runs anyway, §8.2)
- 2 starting scenarios; **sandbox unlock** after the first orbit
- **Tutorial missions** (scripted 1:1 crises on the seed/replay infrastructure – authoring effort is chronically underestimated, hence explicitly scheduled here)
- **i18n decision:** strings external (the data architecture suggests it anyway), seven-segment widgets with a text fallback for non-ASCII characters – preparing costs almost nothing, retrofitting is expensive
- **Done when:** two campaigns with different doctrines feel different after 3 hours – not merely repainted.

### Phase 3a – "Autonomy Across Distance" *(3–4 weeks)*
- Light delay + policy editor (chip UI, templates, simulate button) – **one** vehicle
- Real-time mode (§5.7)
- **Done when:** a Mars probe with an 8-minute delay creates goosebumps instead of waiting time.

### Phase 3b – "The Fleet" *(3–4 weeks)*
- Fleet ops (up to 3 vehicles, mission templates enforce staggered critical phases)
- Own relay as failing infrastructure, insurance, investors
- Sound design complete, GO/NOGO poll with stations
- **Leaderboard backend** as its own work package (~1 week of engineering + ongoing operating costs): endpoint, verification replay against data snapshots, mod exclusion
- **Daily challenge live** with scoring per §6.8 – **at the end of 3b**, after the backend
- **Done when:** an endgame mission creates the same pulse as the first launch – measured against the tension budget (2–4 events) and against the tester.

### Phase 4 – Polish & Opening Up *(ongoing)*
- **Modding official** (folder, schema, docs; Workshop with the Steam port)
- Ghost replays, post-mortem export as **image/text** (story sharing), statistics, achievements
- Weekly challenge (real-time board), third scenario, New Game+, interplanetary
- Steam via Tauri, cloud saves

---

## 10. Risks & Countermeasures

| Risk | Countermeasure |
|---|---|
| Physics rabbit hole | 2D + patched conics, ironclad. "Plausible beats perfect." |
| Scope creep in parts | ≤15 parts per phase |
| Diagnosis graph too hard for beginners | Tutorial missions with 1:1 cases; priors start uniform; the graph densifies with tech |
| **Diagnosis flattens out long-term** | Context priors, chain late game, timed unlocks (§5.8); the fatigue table is calibrated with replay test data |
| **Pause becomes an exploit** | Pause stops the sim, not the cost (§5.7); daily scoring is time-independent |
| One doctrine dominates | Prices in JSON; metric "market usage per campaign" in the dashboard; balancing pass per phase |
| Determinism breaks unnoticed | Hash CI from Phase 0; state hashes every 600 ticks localize desyncs; version pinning |
| **Policy editor is off-putting** | Chip UI + template library + simulate button; text only as an expert mode |
| Fleet ops overwhelms the UI | Max 3 vehicles; auto-pause names the vehicle; staggered critical phases |
| Tension budget tips into unfairness | Events only from visible risk factors; no dice-rigging "director" |
| **Mods break replays/scoring** | Mod hashes in dataVersion; modded runs unscored |
| **Phase plans too optimistic** | Phase 3 is split; Phase 1 has an explicit buffer; every phase has a measurable abort criterion |
| Empty coast phases | Time warp + mini events; from 3b: operate another vehicle |
| Working title collides with a trademark | Short research before Phase 2, then lock it in |
| **Endless document iteration instead of playtesting** | Design freeze from v4: changes only from playtest evidence – the next version of this document is written by the Phase 1 test |

---

## 11. Next Concrete Step

**Paper first, then code – in this order:**

1. **Write `causes.json`** (4 causes, 6 symptoms, 8 measures **with resource occupancy**, 2 side-effect chains) and play it through on paper – with the concurrency question in hand: *Does a player with two **planned-in-parallel** diagnostic steps find the cause within 60 sim seconds? Is there a plausibly-wrong measure for every cause? And does resource scarcity (one engineer, four channels) make the ordering interesting?* This is the only test that decides the heart of the game – before a single line of UI.
2. **Build `graphLint.ts`** against exactly that file (5 rules, §8.4 – rule 4 as a makespan check) – tool and content validate each other.
3. **Phase 0 prototype** with the fixed RNG decision:
   - `sim/engine.ts`: tick loop, command queue, two warp modes (~60 lines)
   - `sim/rng.ts`: hash64 draw + mulberry32 streams; `sim/math.ts`: own sin/cos/exp (~100 lines)
   - Kepler propagator, countdown state machine `HOLD → ARMED → IGNITION → LIFTOFF → MAX_Q → MECO → SEP → ORBIT_CHECK`
   - Altitude gauge, seven-segment, event log, synth clicks, hotkeys `1`–`5` + `Space`
   - `replay/`: serialize, play back and hash a run — **test: save at T+90 s, resume, final state hash identical to the run without a save.**
