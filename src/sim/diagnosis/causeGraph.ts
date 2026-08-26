/**
 * The cause graph at runtime (concept §5.1).
 *
 * Symptoms and causes are decoupled: a cause produces several symptoms, a
 * symptom can come from several causes, and the player only ever sees the
 * symptom. This module is the read model over that data — which causes could
 * explain what is on screen, which measures tell them apart, and what a wrong
 * measure sets off.
 *
 * It also builds the *instances*. The same cause never looks exactly the same
 * twice: strength and onset delay are drawn per symptom from
 * `hash64(seed, key, context)`, so they are a property of the mission rather
 * than of a roll sequence. That is what makes a post-mortem what-if exact and
 * a retry surgical (§8.2 rule 4) — reordering anything else in the mission
 * cannot move these numbers.
 *
 * The linter (`tools/graphLint.ts`) validates the same file before it ships;
 * this module re-checks referential integrity at load, because a mod or a
 * hand-edit can reach the game without passing CI (§8.5).
 */
import { hashUnit } from '../rng.js';

import type { MeasureSpec, ResourceCapacities } from './measures.js';

export interface SymptomDef {
  readonly title: string;
  /**
   * How long this particular reading takes to move, in sim seconds. Optional:
   * a symptom without a band uses the global one from `data/anomalies.json`.
   *
   * This exists because a diagnosis is only worth buying when it is faster
   * than the symptoms. A reading that identifies its cause on its own has to
   * arrive *late*, or waiting for it is strictly better than paying — and the
   * console's whole middle column becomes decoration. Per symptom rather than
   * per cause: the same late reading discriminates for several causes at once,
   * and tuning it in one place keeps them consistent.
   */
  readonly delay_s?: { readonly min: number; readonly max: number };
}

export interface MeasureRef {
  readonly measure: string;
  /** Cause this wrong measure sets off, if any (§5.3). */
  readonly side_effect?: string;
}

export interface CauseDef {
  readonly title: string;
  readonly symptoms: readonly string[];
  /** Escalation window in sim seconds. */
  readonly escalation_s?: number;
  /**
   * Probability this anomaly ends the mission when it is not correctly
   * diagnosed. Not 1: escalation spawns a chain, and the chain gives a second,
   * shorter window to abort. The risk budget (§5.4) weights by this, which is
   * what lets a mission be eventful without being usually fatal (§5.6).
   */
  readonly lethality?: number;
  readonly context_priors?: readonly string[];
  /** Cause that takes over when this one runs past its window (§5.3). */
  readonly escalates_to?: string;
  readonly correct_measures: readonly string[];
  readonly incorrect_measures: readonly MeasureRef[];
  /** Chains are cascade announcements: unambiguous by design. */
  readonly is_chain?: boolean;
}

export type MeasureKind = 'diagnosis' | 'resolution';

export interface MeasureDef {
  readonly title: string;
  readonly type: MeasureKind;
  readonly duration_s: number;
  readonly occupies: readonly string[];
  /** Diagnosis only: the causes this measure can confirm or rule out. */
  readonly discriminates?: readonly string[];
}

export interface CauseGraphData {
  readonly _resources?: ResourceCapacities;
  readonly symptoms: Readonly<Record<string, SymptomDef>>;
  readonly causes: Readonly<Record<string, CauseDef>>;
  readonly measures: Readonly<Record<string, MeasureDef>>;
}

/** Escalation window used when a cause does not name one. Matches the linter. */
export const DEFAULT_ESCALATION_S = 52;

export class CauseGraph {
  readonly data: CauseGraphData;
  readonly capacities: ResourceCapacities;

  private readonly causesBySymptom = new Map<string, string[]>();
  private readonly measureSpecs = new Map<string, MeasureSpec>();

  constructor(data: CauseGraphData) {
    this.data = data;
    this.capacities = data._resources ?? {};

    for (const [causeId, cause] of Object.entries(data.causes)) {
      for (const symptomId of cause.symptoms) {
        const list = this.causesBySymptom.get(symptomId);
        if (list === undefined) this.causesBySymptom.set(symptomId, [causeId]);
        else list.push(causeId);
      }
    }

    for (const [measureId, measure] of Object.entries(data.measures)) {
      this.measureSpecs.set(measureId, {
        id: measureId,
        duration_s: measure.duration_s,
        occupies: measure.occupies,
      });
    }
  }

  get causeIds(): string[] {
    return Object.keys(this.data.causes);
  }

  get measureIds(): string[] {
    return Object.keys(this.data.measures);
  }

  cause(causeId: string): CauseDef {
    const cause = this.data.causes[causeId];
    if (cause === undefined) throw new Error(`Unknown cause '${causeId}'`);
    return cause;
  }

  measure(measureId: string): MeasureDef {
    const measure = this.data.measures[measureId];
    if (measure === undefined) throw new Error(`Unknown measure '${measureId}'`);
    return measure;
  }

  /** How much of a loss-of-mission this cause is worth (§5.4). */
  lethality(causeId: string): number {
    return this.cause(causeId).lethality ?? 1;
  }

  symptom(symptomId: string): SymptomDef {
    const symptom = this.data.symptoms[symptomId];
    if (symptom === undefined) throw new Error(`Unknown symptom '${symptomId}'`);
    return symptom;
  }

  /** What the scheduler needs, keyed by measure id. */
  get specs(): ReadonlyMap<string, MeasureSpec> {
    return this.measureSpecs;
  }

  escalationWindow_s(causeId: string): number {
    return this.cause(causeId).escalation_s ?? DEFAULT_ESCALATION_S;
  }

  /** Every cause that can produce this symptom. */
  causesOf(symptomId: string): readonly string[] {
    return this.causesBySymptom.get(symptomId) ?? [];
  }

  /**
   * The causes still in play given everything currently visible: a candidate
   * must explain *all* observed symptoms, which is what makes a second symptom
   * worth waiting for.
   */
  candidatesFor(observedSymptoms: readonly string[]): string[] {
    if (observedSymptoms.length === 0) return [];
    let candidates = [...this.causesOf(observedSymptoms[0])];
    for (const symptomId of observedSymptoms.slice(1)) {
      const explains = new Set(this.causesOf(symptomId));
      candidates = candidates.filter((causeId) => explains.has(causeId));
    }
    return candidates;
  }

  /**
   * True when `measureId` can tell `a` from `b` — exactly one of them is in
   * its discriminates set. The same rule the linter uses to prove solvability.
   */
  separates(measureId: string, a: string, b: string): boolean {
    const set = new Set(this.measure(measureId).discriminates ?? []);
    return set.has(a) !== set.has(b);
  }

  /** Diagnoses that would narrow the given candidate set. */
  usefulDiagnoses(candidates: readonly string[]): string[] {
    return this.measureIds.filter((measureId) => {
      if (this.measure(measureId).type !== 'diagnosis') return false;
      return candidates.some((a) => candidates.some((b) => a !== b && this.separates(measureId, a, b)));
    });
  }

  isCorrectFor(causeId: string, measureId: string): boolean {
    return this.cause(causeId).correct_measures.includes(measureId);
  }

  /** What an unattended anomaly turns into, or null when it ends the mission. */
  escalationTarget(causeId: string): string | null {
    return this.cause(causeId).escalates_to ?? null;
  }

  /** The chain a wrong measure sets off, or null if it merely fails (§5.3). */
  sideEffectOf(causeId: string, measureId: string): string | null {
    const wrong = this.cause(causeId).incorrect_measures.find((entry) => entry.measure === measureId);
    return wrong?.side_effect ?? null;
  }
}

// ---------- Symptom instances ----------

export interface SymptomInstance {
  readonly symptomId: string;
  /** 0..1. How pronounced the reading is — the same fault reads differently. */
  readonly strength: number;
  /** Seconds after the anomaly starts before this symptom becomes visible. */
  readonly delay_s: number;
}

/** The bands the drawn values fall into. They live in `data/anomalies.json`. */
export interface SymptomBands {
  /** Strength stays inside this band, so a symptom is never invisible. */
  readonly symptomStrength: { readonly min: number; readonly max: number };
  /** Seconds between the fault starting and the reading showing it. */
  readonly symptomDelay_s: { readonly min: number; readonly max: number };
}

function scale(unit: number, low: number, high: number): number {
  return low + unit * (high - low);
}

/** The symptom's own band, or the global one when it does not declare one. */
export function delayBandOf(
  graph: CauseGraph,
  symptomId: string,
  bands: SymptomBands,
): [number, number] {
  const own = graph.symptom(symptomId).delay_s;
  return own === undefined
    ? [bands.symptomDelay_s.min, bands.symptomDelay_s.max]
    : [own.min, own.max];
}

/**
 * Builds the symptom instances for one occurrence of a cause.
 *
 * Keyed by mission and cause rather than drawn from a stream: asking for the
 * same instance twice returns the same numbers, and an unrelated draw
 * elsewhere in the mission cannot shift them.
 */
export function buildSymptomInstances(
  graph: CauseGraph,
  bands: SymptomBands,
  seed: number,
  missionKey: string,
  causeId: string,
): SymptomInstance[] {
  const drawn = graph.cause(causeId).symptoms.map((symptomId) => {
    const key = `${missionKey}/${causeId}/${symptomId}`;
    return {
      symptomId,
      strength: scale(
        hashUnit(seed, key, 'symptomStrength'),
        bands.symptomStrength.min,
        bands.symptomStrength.max,
      ),
      rawDelay_s: scale(
        hashUnit(seed, key, 'symptomDelay'),
        ...delayBandOf(graph, symptomId, bands),
      ),
    };
  });

  // Shift so the earliest reading lands at zero. Two things depend on it: the
  // crisis has to announce itself promptly (the auto-pause waits for the first
  // visible symptom), and the *spread* between first and last is what makes
  // waiting for the full picture expensive. Drawing an absolute delay would
  // sometimes leave the player staring at nothing for half the window.
  const earliest = Math.min(...drawn.map((entry) => entry.rawDelay_s));
  return drawn.map((entry) => ({
    symptomId: entry.symptomId,
    strength: entry.strength,
    delay_s: entry.rawDelay_s - earliest,
  }));
}

// ---------- Loading ----------

/**
 * Checks the references a hand-edit or a mod could break. The linter proves
 * far more before shipping (§8.4); this is the guard for data that never went
 * through it, and it fails loudly rather than producing a graph with holes.
 */
export function validateCauseGraph(data: CauseGraphData): void {
  const problems: string[] = [];

  for (const [causeId, cause] of Object.entries(data.causes)) {
    for (const symptomId of cause.symptoms) {
      if (data.symptoms[symptomId] === undefined) {
        problems.push(`cause '${causeId}' references unknown symptom '${symptomId}'`);
      }
    }
    for (const measureId of cause.correct_measures) {
      if (data.measures[measureId] === undefined) {
        problems.push(`cause '${causeId}' references unknown measure '${measureId}'`);
      }
    }
    for (const wrong of cause.incorrect_measures) {
      if (data.measures[wrong.measure] === undefined) {
        problems.push(`cause '${causeId}' references unknown measure '${wrong.measure}'`);
      }
      if (wrong.side_effect !== undefined && data.causes[wrong.side_effect] === undefined) {
        problems.push(`cause '${causeId}' has a side effect on unknown cause '${wrong.side_effect}'`);
      }
    }
  }

  for (const [symptomId, symptom] of Object.entries(data.symptoms)) {
    const band = symptom.delay_s;
    if (band === undefined) continue;
    // An inverted or negative band would draw silently wrong delays rather
    // than fail, and a symptom that never shows is not a symptom.
    if (band.min < 0 || band.max < band.min) {
      problems.push(
        `symptom '${symptomId}' has an impossible delay band ${band.min}..${band.max}`,
      );
    }
  }

  for (const [symptomId, symptom] of Object.entries(data.symptoms)) {
    const band = symptom.delay_s;
    if (band === undefined) continue;
    // An inverted or negative band draws silently wrong delays rather than
    // failing, and it is exactly the kind of thing a hand-edit gets wrong.
    if (band.min < 0 || band.max < band.min) {
      problems.push(
        `symptom '${symptomId}' has an impossible delay band ${band.min}..${band.max}`,
      );
    }
  }

  for (const [measureId, measure] of Object.entries(data.measures)) {
    for (const causeId of measure.discriminates ?? []) {
      if (data.causes[causeId] === undefined) {
        problems.push(`measure '${measureId}' discriminates unknown cause '${causeId}'`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Cause graph is inconsistent:\n  ${problems.join('\n  ')}`);
  }
}

export function loadCauseGraph(data: CauseGraphData): CauseGraph {
  validateCauseGraph(data);
  return new CauseGraph(data);
}
