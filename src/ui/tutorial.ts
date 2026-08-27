/**
 * Tutorial missions (concept §9).
 *
 * "Scripted 1:1 crises on the seed/replay infrastructure." The important half
 * of that sentence is the second: a tutorial does not stage a fault, it names
 * a seed and a mission key and lets the same machinery that makes a replay
 * reproducible make the lesson reproducible. The fault at T+35 is a real draw
 * that happens to come out the same every time, which is why the script can
 * tell the player it is coming without lying to them.
 *
 * The runner is a pure function of mission state. It holds no progress of its
 * own, so it cannot desynchronise from what the player actually did: a step is
 * current when every step before it has been satisfied and it has not. Pausing,
 * reloading and resuming all land on the right step because there is nothing to
 * restore.
 */
import type { MissionState } from '../sim/countdown.js';

export type TutorialCondition =
  | { readonly kind: 'checklistComplete' }
  | { readonly kind: 'phase'; readonly phase: string }
  | { readonly kind: 'anomalyVisible' }
  | { readonly kind: 'diagnosisBought' }
  | { readonly kind: 'anomalyResolved' }
  | { readonly kind: 'chainSpawned' }
  | { readonly kind: 'missionOver' };

export interface TutorialStep {
  readonly id: string;
  readonly text: string;
  readonly until: TutorialCondition;
}

export interface TutorialDef {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly seed: number;
  readonly missionKey: string;
  readonly qaLevel: string;
  readonly steps: readonly TutorialStep[];
}

export interface TutorialData {
  readonly tutorials: readonly TutorialDef[];
}

/** Whether a condition already holds for this state. */
export function isSatisfied(
  condition: TutorialCondition,
  state: MissionState,
  missionOver: boolean,
): boolean {
  switch (condition.kind) {
    case 'checklistComplete':
      return state.checklist.every(Boolean);
    case 'phase':
      // Phases only ever move forward, so "reached" is what matters, not
      // "is" — a step must not un-satisfy because the flight moved on.
      return phaseReached(state.phase, condition.phase);
    case 'anomalyVisible':
      // Visible, not merely started: the onset is not observable, and a
      // tutorial that pointed at nothing would teach the wrong lesson.
      return state.diagnosis.anomalies.anomalies.some(
        (anomaly) =>
          anomaly.onsetTick >= 0 &&
          state.flight.tick >= anomaly.onsetTick &&
          anomaly.symptoms.length > 0,
      );
    case 'diagnosisBought':
      return state.diagnosis.results.length > 0;
    case 'anomalyResolved':
      return state.diagnosis.anomalies.anomalies.some((anomaly) => anomaly.resolvedTick >= 0);
    case 'chainSpawned':
      return state.diagnosis.anomalies.anomalies.some((anomaly) => anomaly.spawnedBy !== null);
    case 'missionOver':
      return missionOver;
  }
}

const PHASE_ORDER = [
  'HOLD',
  'ARMED',
  'IGNITION',
  'LIFTOFF',
  'MAX_Q',
  'MECO',
  'SEP',
  'ORBIT_CHECK',
] as const;

function phaseReached(current: string, wanted: string): boolean {
  return PHASE_ORDER.indexOf(current as never) >= PHASE_ORDER.indexOf(wanted as never);
}

export interface TutorialProgress {
  readonly step: TutorialStep | null;
  readonly index: number;
  readonly total: number;
  readonly complete: boolean;
}

/**
 * Where the player is in the script.
 *
 * The first step whose condition is not yet met. Earlier steps being satisfied
 * is not checked, deliberately: a player who solves step three by accident
 * while on step two should be moved forward rather than told to go back and do
 * it the intended way.
 */
export function progressIn(
  tutorial: TutorialDef,
  state: MissionState,
  missionOver: boolean,
): TutorialProgress {
  const total = tutorial.steps.length;
  for (let index = 0; index < total; index += 1) {
    if (!isSatisfied(tutorial.steps[index].until, state, missionOver)) {
      return { step: tutorial.steps[index], index, total, complete: false };
    }
  }
  return { step: null, index: total, total, complete: true };
}
