/**
 * GO/NOGO — Cause Graph Linter (v2)
 *
 * Implements the 5 rules from KONZEPT_v4.md §8.4, with Rule 4 as a true
 * makespan check under resource constraints (§5.2), not a duration sum.
 *
 * Design notes:
 * - `lintGraph()` is a pure function (no fs/process) so the exact same
 *   validation can run in the browser when loading mods (Konzept §8.5).
 *   The CLI wrapper at the bottom is Node-only via dynamic imports.
 * - Identification model: every diagnosis declares `discriminates`, the
 *   set of causes it can confirm or rule out. A diagnosis separates cause
 *   A from cause B iff exactly one of them is in that set. To solve a
 *   cause, the player must separate it from every other candidate
 *   (= causes sharing at least one symptom), then apply a correct
 *   resolution. The linter searches all diagnosis subsets for the
 *   cheapest feasible plan.
 * - Scheduling: diagnoses with disjoint resources run in parallel
 *   (greedy longest-first list scheduling; exact enough at this size and
 *   conservative — if the greedy plan fits the window, a player can too).
 *   The resolution runs after the diagnosis phase (conservative).
 */

// ---------- Types (shared schema with the game / mod loader) ----------

export interface DelayBand { min: number; max: number; }

export interface SymptomDef {
    title: string;
    /** This reading's own delay band. Absent = the global band applies. */
    delay_s?: DelayBand;
}

export interface MeasureRef { measure: string; side_effect?: string; }

export interface CauseDef {
    title: string;
    symptoms: string[];
    /** Cause that takes over when this one is left past its window (§5.3). */
    escalates_to?: string;
    /** Escalation window for this cause in sim seconds. */
    escalation_s?: number;
    context_priors?: string[];
    correct_measures: string[];
    incorrect_measures: MeasureRef[];
    is_chain?: boolean;
}

export interface MeasureDef {
    title: string;
    type: 'diagnosis' | 'resolution';
    duration_s: number;
    /** Resource tokens this measure occupies exclusively for duration_s. */
    occupies: string[];
    /** Diagnosis only: causes this measure can confirm or rule out. */
    discriminates?: string[];
}

export interface GraphData {
    _resources?: Record<string, number>;   // resource capacities, default 1
    symptoms: Record<string, SymptomDef>;
    causes: Record<string, CauseDef>;
    measures: Record<string, MeasureDef>;
}

export interface LintResult {
    errors: string[];
    warnings: string[];
    /** Human-readable solution plan per cause — direct input for the paper playtest (§11). */
    report: string[];
}

const DEFAULT_ESCALATION_S = 52;

// ---------- Scheduling: makespan of a parallel measure set ----------

/**
 * Greedy longest-processing-time list scheduling.
 * Each resource token has a capacity (default 1); a task starts at the
 * earliest time all its resources have a free slot, occupying them for
 * its whole duration. Returns total makespan.
 */
export function scheduleMakespan(
    measureIds: string[],
    data: GraphData,
): number {
    const capacities = data._resources ?? {};
    const capacity = (res: string) => capacities[res] ?? 1;

    // One entry per slot, holding the time that slot frees up. Fixed length,
    // because a resource has as many slots as its capacity and no more.
    const slotsByResource: Record<string, number[]> = {};
    const slotsOf = (res: string) => {
        if (!slotsByResource[res]) {
            slotsByResource[res] = new Array<number>(capacity(res)).fill(0);
        }
        return slotsByResource[res];
    };

    /**
     * How many slots of each resource a measure needs. A token repeated in
     * `occupies` is a request for that many slots — a raw-telemetry check
     * eating two of four channels, say. Counting the repeats separately
     * against the current state (rather than as one combined demand) would
     * let a two-slot measure start with one slot free.
     */
    const demandOf = (id: string): Map<string, number> => {
        const demand = new Map<string, number>();
        for (const res of data.measures[id].occupies) {
            demand.set(res, (demand.get(res) ?? 0) + 1);
        }
        return demand;
    };

    const tasks = [...measureIds].sort(
        (a, b) => data.measures[b].duration_s - data.measures[a].duration_s,
    );

    let makespan = 0;
    for (const id of tasks) {
        const m = data.measures[id];
        const demand = demandOf(id);

        // Earliest start: for each resource, the moment the n-th slot is free.
        let start = 0;
        for (const [res, needed] of demand) {
            const free = [...slotsOf(res)].sort((a, b) => a - b);
            if (needed > free.length) return Number.POSITIVE_INFINITY; // impossible
            start = Math.max(start, free[needed - 1]);
        }

        // Occupy that many slots, taking the ones that free up earliest.
        for (const [res, needed] of demand) {
            const slots = slotsOf(res);
            for (let taken = 0; taken < needed; taken++) {
                let earliest = 0;
                for (let i = 1; i < slots.length; i++) {
                    if (slots[i] < slots[earliest]) earliest = i;
                }
                slots[earliest] = start + m.duration_s;
            }
        }
        makespan = Math.max(makespan, start + m.duration_s);
    }
    return makespan;
}

// ---------- Identification model ----------

/** Causes that share at least one symptom with `causeId` (its confusion set). */
function candidatesOf(causeId: string, data: GraphData): string[] {
    const own = new Set(data.causes[causeId].symptoms);
    return Object.keys(data.causes).filter(other => {
        if (other === causeId) return false;
        return data.causes[other].symptoms.some(s => own.has(s));
    });
}

/** A diagnosis separates A from B iff exactly one of them is in its discriminates set. */
function separates(diagId: string, a: string, b: string, data: GraphData): boolean {
    const set = new Set(data.measures[diagId].discriminates ?? []);
    return set.has(a) !== set.has(b);
}

interface Plan { diagnoses: string[]; diagMakespan: number; resolution: string; total: number; }

/**
 * Cheapest feasible plan for a cause: smallest-makespan diagnosis subset
 * that separates the cause from all candidates, plus the fastest correct
 * resolution. Chains (unambiguous cascade announcements) need no diagnosis.
 */
function bestPlan(causeId: string, data: GraphData): Plan | null {
    const cause = data.causes[causeId];
    const resolutions = cause.correct_measures.filter(m => data.measures[m]);
    if (resolutions.length === 0) return null;
    const resTime = Math.min(...resolutions.map(m => data.measures[m].duration_s));
    const resolution = resolutions.find(m => data.measures[m].duration_s === resTime)!;

    const candidates = cause.is_chain ? [] : candidatesOf(causeId, data);
    if (candidates.length === 0) {
        return { diagnoses: [], diagMakespan: 0, resolution, total: resTime };
    }

    const diagIds = Object.keys(data.measures).filter(m => data.measures[m].type === 'diagnosis');
    let best: Plan | null = null;
    // Enumerate all diagnosis subsets (tiny by design: ≤ ~8 diagnoses per phase).
    for (let mask = 1; mask < (1 << diagIds.length); mask++) {
        const subset = diagIds.filter((_, i) => mask & (1 << i));
        const coversAll = candidates.every(other =>
            subset.some(d => separates(d, causeId, other, data)));
        if (!coversAll) continue;
        const diagMakespan = scheduleMakespan(subset, data);
        const total = diagMakespan + resTime;
        if (!best || total < best.total) {
            best = { diagnoses: subset, diagMakespan, resolution, total };
        }
    }
    return best;
}

/**
 * Mean time until the readings alone name the cause, in sim seconds.
 *
 * Deterministic on purpose: instead of sampling the RNG, each symptom's band
 * is walked at fixed quantile midpoints and every combination is enumerated.
 * Same answer on every machine and in every run, which is what a lint rule
 * needs — and close enough to the uniform draw the runtime makes.
 *
 * Mirrors `buildSymptomInstances`: draw a raw delay per symptom, then shift so
 * the earliest reading lands at zero. Returns Infinity when the full set never
 * identifies the cause (another cause explains all of it), which is the case
 * the rule does not care about.
 */
const QUANTILE_STEPS = 24;

export function meanFreeIdentification(
    causeId: string,
    data: GraphData,
    globalBand: DelayBand,
): number {
    const symptoms = data.causes[causeId].symptoms;
    const bands = symptoms.map(s => data.symptoms[s]?.delay_s ?? globalBand);

    // Which causes explain every symptom in a set — the same test the runtime
    // uses to decide whether the candidate list has collapsed to one.
    const identifies = (seen: string[]): boolean =>
        Object.keys(data.causes).filter(other =>
            seen.every(s => data.causes[other].symptoms.includes(s))).length === 1;

    let total = 0;
    let counted = 0;
    const draws = new Array<number>(symptoms.length);

    const walk = (index: number): void => {
        if (index === symptoms.length) {
            const earliest = Math.min(...draws);
            const order = symptoms
                .map((symptomId, i) => ({ symptomId, at: draws[i] - earliest }))
                .sort((a, b) => a.at - b.at);
            const seen: string[] = [];
            for (const entry of order) {
                seen.push(entry.symptomId);
                if (identifies(seen)) {
                    total += entry.at;
                    counted += 1;
                    return;
                }
            }
            return;
        }
        const { min, max } = bands[index];
        for (let step = 0; step < QUANTILE_STEPS; step += 1) {
            draws[index] = min + ((step + 0.5) / QUANTILE_STEPS) * (max - min);
            walk(index + 1);
        }
    };
    walk(0);

    return counted === 0 ? Infinity : total / counted;
}

// ---------- The linter ----------

export interface LintOptions {
    /**
     * The global symptom delay band from `data/anomalies.json`. Rule 6 needs
     * it to measure how long waiting actually takes; without it the rule falls
     * back to reporting bare uniqueness, which is the weaker statement.
     */
    globalDelayBand?: DelayBand;
}

export function lintGraph(data: GraphData, options: LintOptions = {}): LintResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const report: string[] = [];
    const err = (m: string) => errors.push(m);
    const warn = (m: string) => warnings.push(m);

    const causeIds = Object.keys(data.causes);
    const measureIds = Object.keys(data.measures);

    // ---- Referential integrity (everything, loudly — no silent skips) ----
    for (const causeId of causeIds) {
        const c = data.causes[causeId];
        for (const s of c.symptoms) {
            if (!data.symptoms[s]) err(`Integrity: cause '${causeId}' references unknown symptom '${s}'.`);
        }
        for (const m of c.correct_measures) {
            if (!data.measures[m]) err(`Integrity: cause '${causeId}' references unknown measure '${m}'.`);
        }
        for (const im of c.incorrect_measures) {
            if (!data.measures[im.measure]) err(`Integrity: cause '${causeId}' references unknown incorrect measure '${im.measure}'.`);
            if (im.side_effect) {
                const target = data.causes[im.side_effect];
                if (!target) err(`Integrity: side_effect '${im.side_effect}' of cause '${causeId}' does not exist.`);
                else if (!target.is_chain) warn(`Design: side_effect '${im.side_effect}' of '${causeId}' is not marked is_chain.`);
            }
        }
    }
    for (const mId of measureIds) {
        const m = data.measures[mId];
        for (const c of m.discriminates ?? []) {
            if (!data.causes[c]) err(`Integrity: measure '${mId}' discriminates unknown cause '${c}'.`);
        }
        if (m.type === 'diagnosis' && (!m.discriminates || m.discriminates.length === 0)) {
            err(`Design: diagnosis '${mId}' discriminates nothing — it is useless to the player.`);
        }
    }
    // Escalation targets must exist, and must be chains.
    for (const causeId of causeIds) {
        const target = data.causes[causeId].escalates_to;
        if (target === undefined) continue;
        if (!data.causes[target]) {
            err(`Integrity: cause '${causeId}' escalates into unknown cause '${target}'.`);
        } else if (!data.causes[target].is_chain) {
            warn(`Design: escalation target '${target}' of '${causeId}' is not marked is_chain.`);
        }
    }

    // Every chain cause must be reachable through some side_effect.
    const sideEffectTargets = new Set([
        ...causeIds.flatMap(id => data.causes[id].incorrect_measures.map(im => im.side_effect)),
        ...causeIds.map(id => data.causes[id].escalates_to),
    ].filter(Boolean) as string[]);
    for (const causeId of causeIds) {
        if (data.causes[causeId].is_chain && !sideEffectTargets.has(causeId)) {
            err(`Integrity: chain cause '${causeId}' is never triggered by any side_effect (dead data).`);
        }
    }
    if (errors.length > 0) return { errors, warnings, report }; // graph broken; rules below would cascade

    // ---- Rule 1: >=1 correct measure, and (non-chain) >=1 plausible wrong measure ----
    for (const causeId of causeIds) {
        const c = data.causes[causeId];
        if (c.correct_measures.length < 1) err(`Rule 1: cause '${causeId}' has no correct measure.`);
        if (!c.is_chain && c.incorrect_measures.length < 1) {
            err(`Rule 1: cause '${causeId}' has no plausibly-wrong measure — blind acting would dominate.`);
        }
    }

    // ---- Rules 2 & 3: symptom ambiguity & reachability ----
    // Chains are cascade *announcements*: their symptoms may be unambiguous by design,
    // so Rule 2 counts non-chain causes only.
    for (const symId of Object.keys(data.symptoms)) {
        const all = causeIds.filter(c => data.causes[c].symptoms.includes(symId));
        const nonChain = all.filter(c => !data.causes[c].is_chain);
        if (all.length === 0) err(`Rule 3: symptom '${symId}' is unreachable (no cause produces it).`);
        else if (nonChain.length === 1) err(`Rule 2: symptom '${symId}' is a dead giveaway (exactly one non-chain cause).`);
        else if (nonChain.length === 0) warn(`Rule 2 (exempt): '${symId}' is a chain announcement — unambiguous by design.`);
    }

    // ---- Rule 4: makespan (critical path under resource constraints) per cause ----
    for (const causeId of causeIds) {
        const c = data.causes[causeId];
        const window = c.escalation_s ?? DEFAULT_ESCALATION_S;
        if (c.escalation_s === undefined) {
            warn(`Rule 4: cause '${causeId}' has no escalation_s — using default ${DEFAULT_ESCALATION_S}s.`);
        }
        const plan = bestPlan(causeId, data);
        if (!plan) {
            err(`Rule 4: cause '${causeId}' is not identifiable — no diagnosis subset separates it from its candidates.`);
            continue;
        }
        const diag = plan.diagnoses.length > 0
            ? `[${plan.diagnoses.join(' ∥ ')}] makespan ${plan.diagMakespan}s → `
            : '(unambiguous, no diagnosis) → ';
        report.push(`${causeId}: ${diag}${plan.resolution} (${data.measures[plan.resolution].duration_s}s) = ${plan.total}s / window ${window}s`);
        if (plan.total > window) {
            err(`Rule 4: cause '${causeId}' unsolvable in ${window}s — best plan needs ${plan.total}s (${diag}${plan.resolution}).`);
        }
    }

    // ---- Rule 6: waiting must not beat paying ----
    // Rule 2 protects single symptoms. It cannot see that a cause may be the
    // only one explaining its whole *set* — once every reading is on screen,
    // that names the cause for free. What decides whether that matters is not
    // uniqueness but timing: a diagnosis is worth buying only when it is
    // faster than the symptoms. So the rule measures both and compares them.
    //
    // Reported rather than failed, because the fix is a tuning pass on the
    // delay bands and the designer may want the free path on purpose.
    for (const causeId of causeIds) {
        if (data.causes[causeId].is_chain) continue;
        const needed = data.causes[causeId].symptoms;
        const explainers = causeIds.filter(other =>
            needed.every(s => data.causes[other].symptoms.includes(s)));
        if (explainers.length !== 1) continue;

        const band = options.globalDelayBand;
        if (!band) {
            warn(
                `Rule 6: the full symptom set of '${causeId}' is explained by no other cause — ` +
                `waiting for every reading identifies it. Timing not checked (no global delay band given).`,
            );
            continue;
        }

        const free = meanFreeIdentification(causeId, data, band);
        const plan = bestPlan(causeId, data);
        const paid = plan ? plan.diagMakespan : Infinity;
        if (free <= paid) {
            warn(
                `Rule 6: '${causeId}' identifies itself for free after ~${free.toFixed(1)}s, ` +
                `but the cheapest diagnosis needs ${paid}s — waiting beats paying, so the ` +
                `diagnosis panel is decoration for this cause.`,
            );
        } else {
            report.push(
                `${causeId}: free identification after ~${free.toFixed(1)}s vs ${paid}s to buy it ` +
                `— paying wins by ${(free - paid).toFixed(1)}s.`,
            );
        }
    }

    // ---- Rule 5: every side_effect chain terminates ----
    for (const causeId of causeIds) {
        for (const im of data.causes[causeId].incorrect_measures) {
            if (im.side_effect && hasCycle(data.causes, im.side_effect, new Set([causeId]))) {
                err(`Rule 5: cycle in side_effect chain starting at '${causeId}' → '${im.side_effect}'.`);
            }
        }
    }

    return { errors, warnings, report };
}

function hasCycle(causes: Record<string, CauseDef>, node: string, visited: Set<string>): boolean {
    if (visited.has(node)) return true;
    const c = causes[node];
    if (!c) return false;
    const next = new Set(visited); next.add(node);
    return c.incorrect_measures.some(im => im.side_effect && hasCycle(causes, im.side_effect, next));
}

// ---------- CLI (Node only; the pure part above stays browser-safe) ----------

async function cli() {
    const fs = await import('fs');
    const path = await import('path');
    const file = process.argv[2] ?? 'causes.json';
    const resolved = path.resolve(file);
    const data = JSON.parse(fs.readFileSync(resolved, 'utf-8')) as GraphData;

    // The global band lives with the other runtime tuning, next to the graph.
    // Read rather than duplicated: a second copy of 0..40 here would drift.
    const anomaliesFile = path.join(path.dirname(resolved), 'anomalies.json');
    const globalDelayBand = fs.existsSync(anomaliesFile)
        ? (JSON.parse(fs.readFileSync(anomaliesFile, 'utf-8')) as { symptomDelay_s: DelayBand })
              .symptomDelay_s
        : undefined;

    const { errors, warnings, report } = lintGraph(data, { globalDelayBand });

    if (report.length) {
        console.log('Solution plans (paper-playtest input):');
        report.forEach(r => console.log(`  ${r}`));
        console.log('');
    }
    if (warnings.length) {
        console.warn('WARNINGS:');
        warnings.forEach(w => console.warn(`  - ${w}`));
        console.log('');
    }
    if (errors.length) {
        console.error('ERRORS:');
        errors.forEach(e => console.error(`  - ${e}`));
        console.error(`\nLinter failed with ${errors.length} error(s).`);
        process.exit(1);
    }
    console.log('All rules passed. The graph is solid.');
}

import { pathToFileURL } from 'url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    cli();
}
