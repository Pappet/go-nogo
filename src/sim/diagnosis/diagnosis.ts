/**
 * The diagnosis runtime: what the player knows, and what it cost them.
 *
 * This is where the pieces meet. The anomaly system says what is wrong, the
 * scheduler says when a measure lands, the priors say how the candidates
 * weigh — and this module turns a completed measure into information, or into
 * a consequence.
 *
 * The important asymmetry: a diagnosis pays out *when it completes*, not when
 * it is queued, and so does a resolution. Acting is not instantaneous, which
 * is the whole reason the escalation window is interesting (§5.7).
 */
import type { Command } from '../engine.js';
import {
  type AnomalySettings,
  type AnomalyState,
  type AnomalyEvent,
  applyMeasure,
  createAnomalyState,
  isActive,
  visibleSymptoms,
} from '../systems/anomaly.js';
import {
  type PauseState,
  createPauseState,
  offerResultReady,
  recordQueuedAction,
  shouldAutoPause,
  canQueueAction,
} from '../pauseModel.js';

import type { CauseGraph } from './causeGraph.js';
import {
  type ScheduleState,
  advanceSchedule,
  createScheduleState,
  enqueueMeasure,
} from './measures.js';
import { type CandidatePrior, type PriorSettings, computePriors, activeContextTags } from './priors.js';

/** What a completed diagnosis told the player. */
export interface DiagnosisResult {
  readonly measureId: string;
  readonly anomalyId: string;
  readonly tick: number;
  /** Named the cause outright — the measure's set contained the real one. */
  readonly confirmed: string | null;
  /** Ruled these out. Never contains the real cause. */
  readonly excluded: readonly string[];
}

export interface DiagnosisState {
  anomalies: AnomalyState;
  schedule: ScheduleState;
  pause: PauseState;
  /** The mission's standing context profile (§5.2). */
  missionTags: string[];
  results: DiagnosisResult[];
}

export function createDiagnosisState(
  pause: PauseState = createPauseState(),
  missionTags: string[] = [],
): DiagnosisState {
  return {
    anomalies: createAnomalyState(),
    schedule: createScheduleState(),
    pause,
    missionTags,
    results: [],
  };
}

/**
 * The symptoms on screen for an anomaly — only those past their own delay.
 */
export function observedSymptoms(
  state: DiagnosisState,
  anomalyId: string,
  tick: number,
): string[] {
  const anomaly = state.anomalies.anomalies.find((entry) => entry.id === anomalyId);
  if (anomaly === undefined) return [];
  return visibleSymptoms(anomaly, tick).map((symptom) => symptom.symptomId);
}

/**
 * The candidates still standing: those that explain every visible symptom,
 * minus whatever a diagnosis has ruled out. A confirmed cause collapses the
 * list to one — the player bought certainty and gets it.
 */
export function candidatesFor(
  state: DiagnosisState,
  graph: CauseGraph,
  anomalyId: string,
  tick: number,
): string[] {
  const results = state.results.filter((result) => result.anomalyId === anomalyId);
  const confirmed = results.find((result) => result.confirmed !== null);
  if (confirmed?.confirmed != null) return [confirmed.confirmed];

  const excluded = new Set(results.flatMap((result) => result.excluded));
  return graph
    .candidatesFor(observedSymptoms(state, anomalyId, tick))
    .filter((causeId) => !excluded.has(causeId));
}

/** The candidate bars, weighted by context and ordered for §7.7. */
export function candidateBars(
  state: DiagnosisState,
  graph: CauseGraph,
  priorSettings: PriorSettings,
  anomalyId: string,
  phase: string,
  tick: number,
): CandidatePrior[] {
  const tags = activeContextTags(priorSettings, state.missionTags, phase);
  return computePriors(graph, candidatesFor(state, graph, anomalyId, tick), tags, priorSettings);
}

/**
 * Queues a measure against an anomaly.
 *
 * Returns false when the pause model refuses it — only the A/B arm ever does
 * (§5.7). Standard has no limit, because pausing buys no sim time.
 */
export function queueMeasure(
  state: DiagnosisState,
  measureId: string,
  anomalyId: string,
  tick: number,
): boolean {
  if (!canQueueAction(state.pause)) return false;
  enqueueMeasure(state.schedule, measureId, tick, anomalyId);
  recordQueuedAction(state.pause);
  return true;
}

export interface DiagnosisTickResult {
  readonly events: AnomalyEvent[];
  /** Results that landed on this tick. */
  readonly results: DiagnosisResult[];
  /** True when an anomaly appeared that has not had its auto-pause yet. */
  readonly autoPause: boolean;
}

/**
 * Advances the diagnosis runtime by one tick.
 *
 * Order matters: measures that finish on this tick pay out before the
 * escalation check, so a fix landing on the very last tick still counts. A
 * player who planned to the second deserves the second.
 */
export function stepDiagnosis(
  state: DiagnosisState,
  graph: CauseGraph,
  anomalySettings: AnomalySettings,
  seed: number,
  missionKey: string,
  tick: number,
  stepAnomalies: (state: AnomalyState, graph: CauseGraph, tick: number) => AnomalyEvent[],
): DiagnosisTickResult {
  const events: AnomalyEvent[] = [];
  const results: DiagnosisResult[] = [];

  for (const finished of advanceSchedule(state.schedule, tick, graph.specs, graph.capacities)) {
    const measure = graph.measure(finished.measureId);
    const anomaly = state.anomalies.anomalies.find((entry) => entry.id === finished.targetId);
    if (anomaly === undefined) continue;

    if (measure.type === 'diagnosis') {
      const result = readDiagnosis(graph, finished.measureId, anomaly.causeId, anomaly.id, tick);
      state.results.push(result);
      results.push(result);
      offerResultReady(state.pause, anomaly.id, finished.measureId, tick);
    } else {
      const outcome = applyMeasure(
        state.anomalies,
        graph,
        anomalySettings,
        seed,
        missionKey,
        anomaly.id,
        finished.measureId,
        tick,
      );
      events.push(...outcome.events);
    }
  }

  events.push(...stepAnomalies(state.anomalies, graph, tick));

  // Auto-pause once per new anomaly, decided at the tick it appears.
  let autoPause = false;
  for (const event of events) {
    if (event.type === 'ONSET' || event.type === 'CHAIN') {
      if (shouldAutoPause(state.pause, event.anomalyId)) autoPause = true;
    }
  }

  return { events, results, autoPause };
}

/**
 * What a diagnosis reveals. Its `discriminates` set either contains the real
 * cause — naming it — or does not, ruling every member of the set out.
 *
 * This is the linter's identification model at runtime, deliberately: a
 * measure the linter counted on to prove solvability has to mean the same
 * thing when the player pays for it.
 */
export function readDiagnosis(
  graph: CauseGraph,
  measureId: string,
  trueCauseId: string,
  anomalyId: string,
  tick: number,
): DiagnosisResult {
  const discriminates = graph.measure(measureId).discriminates ?? [];
  const hit = discriminates.includes(trueCauseId);
  return {
    measureId,
    anomalyId,
    tick,
    confirmed: hit ? trueCauseId : null,
    excluded: hit ? [] : [...discriminates],
  };
}

/** Anomalies the console should show right now. */
export function openAnomalies(state: DiagnosisState, tick: number): string[] {
  return state.anomalies.anomalies
    .filter((anomaly) => isActive(anomaly, tick))
    .map((anomaly) => anomaly.id);
}

/** Commands the diagnosis runtime understands. */
export const DIAGNOSIS_COMMANDS = ['queueMeasure'] as const;

export interface QueueMeasurePayload {
  readonly measureId: string;
  readonly anomalyId: string;
}

export function isQueueMeasure(command: Command): boolean {
  return command.type === 'queueMeasure';
}
