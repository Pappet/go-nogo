/**
 * The anomaly system (concept §5.3, §5.4, §5.5).
 *
 * What fires, and when, is decided once from seed and mission — not rolled as
 * the flight goes. Every draw is `hash64(seed, key, context)`, so the set of
 * anomalies is a property of the mission: replaying it reproduces them, and a
 * post-mortem what-if is exact rather than approximate (§8.2 rule 4).
 *
 * The escalation clock is simulation state at a tick, not a UI timer. An
 * anomaly the player does not resolve inside its window escalates, and that is
 * decided by the tick counter alone.
 *
 * The fairness rule (§5.5) is a property of the *data*, proven by the graph
 * linter before shipping: every anomaly is solvable with information. This
 * module does not soften anything at runtime — no rubber-banding, no dice
 * nudged toward a struggling player.
 */
import { hashUnit } from '../rng.js';
import {
  type CauseGraph,
  type SymptomBands,
  type SymptomInstance,
  buildSymptomInstances,
} from '../diagnosis/causeGraph.js';
import { TICKS_PER_SECOND } from '../engine.js';

export interface OnsetWindow {
  readonly earliest: number;
  readonly latest: number;
}

export interface AnomalySettings extends SymptomBands {
  /** Chance that any one cause fires in a given mission. */
  readonly occurrenceProbability: number;
  /** Seconds after liftoff within which an anomaly may start. */
  readonly onsetWindow_s: OnsetWindow;
}

export interface AppliedMeasure {
  readonly measureId: string;
  readonly tick: number;
  readonly correct: boolean;
  /** Chain this measure set off, if it did (§5.3). */
  readonly sideEffect: string | null;
}

export interface Anomaly {
  readonly id: string;
  /** Hidden from the player until the post-mortem. */
  readonly causeId: string;
  readonly onsetTick: number;
  readonly escalationTick: number;
  readonly symptoms: readonly SymptomInstance[];
  /** Anomaly this one cascaded from, or null when it is a root cause. */
  readonly spawnedBy: string | null;
  resolvedTick: number;
  escalatedTick: number;
  applied: AppliedMeasure[];
}

export interface AnomalyState {
  anomalies: Anomaly[];
  /** Anomalies the console has already announced — auto-pause fires once each. */
  announced: string[];
  /** Serial for chain anomalies, so their ids stay stable across a replay. */
  nextChainSerial: number;
}

export function createAnomalyState(): AnomalyState {
  return { anomalies: [], announced: [], nextChainSerial: 0 };
}

const seconds = (value: number): number => Math.round(value * TICKS_PER_SECOND);

/**
 * Decides the whole anomaly schedule for a mission.
 *
 * Only root causes are planned here; chains arrive later, and only because the
 * player caused them. Each cause draws independently, so adding a cause to the
 * graph cannot shift the others — the same reason §8.2 prefers keyed draws
 * over a roll sequence.
 */
export function planAnomalies(
  graph: CauseGraph,
  settings: AnomalySettings,
  seed: number,
  missionKey: string,
  liftoffTick: number,
): Anomaly[] {
  const planned: Anomaly[] = [];

  for (const causeId of graph.causeIds) {
    if (graph.cause(causeId).is_chain) continue;

    const key = `${missionKey}/${causeId}`;
    if (hashUnit(seed, key, 'anomalyOccurs') >= settings.occurrenceProbability) continue;

    const span = settings.onsetWindow_s.latest - settings.onsetWindow_s.earliest;
    const onset_s = settings.onsetWindow_s.earliest + hashUnit(seed, key, 'anomalyOnset') * span;
    const onsetTick = liftoffTick + seconds(onset_s);

    planned.push({
      id: `anomaly:${causeId}`,
      causeId,
      onsetTick,
      escalationTick: onsetTick + seconds(graph.escalationWindow_s(causeId)),
      symptoms: buildSymptomInstances(graph, settings, seed, missionKey, causeId),
      spawnedBy: null,
      resolvedTick: -1,
      escalatedTick: -1,
      applied: [],
    });
  }

  // Onset order, then id, so the list is stable whatever order causes are
  // declared in — a reordered JSON file must not change a replay.
  planned.sort((a, b) => a.onsetTick - b.onsetTick || (a.id < b.id ? -1 : 1));
  return planned;
}

export function isActive(anomaly: Anomaly, tick: number): boolean {
  return (
    tick >= anomaly.onsetTick && anomaly.resolvedTick < 0 && anomaly.escalatedTick < 0
  );
}

export function isPending(anomaly: Anomaly, tick: number): boolean {
  return tick < anomaly.onsetTick;
}

export function activeAnomalies(state: AnomalyState, tick: number): Anomaly[] {
  return state.anomalies.filter((anomaly) => isActive(anomaly, tick));
}

/**
 * The symptoms visible right now. A symptom appears only after its own delay,
 * which is why a reading can arrive late enough to be worth waiting for.
 */
export function visibleSymptoms(anomaly: Anomaly, tick: number): SymptomInstance[] {
  if (tick < anomaly.onsetTick) return [];
  return anomaly.symptoms.filter(
    (symptom) => tick >= anomaly.onsetTick + seconds(symptom.delay_s),
  );
}

/** Ticks left before this anomaly escalates. Negative once it has. */
export function ticksToEscalation(anomaly: Anomaly, tick: number): number {
  return anomaly.escalationTick - tick;
}

export interface AnomalyEvent {
  readonly type: 'ONSET' | 'SYMPTOM' | 'ESCALATED' | 'RESOLVED' | 'CHAIN' | 'LOST';
  readonly anomalyId: string;
  readonly tick: number;
  readonly detail: string;
}

/**
 * Advances the anomaly system by one tick.
 *
 * Returns what changed, so the countdown machine can log it and the console
 * can decide whether to offer a pause. Nothing here reads a clock.
 */
export function stepAnomalies(
  state: AnomalyState,
  graph: CauseGraph,
  tick: number,
  settings?: AnomalySettings,
  seed = 0,
  missionKey = '',
): AnomalyEvent[] {
  const events: AnomalyEvent[] = [];

  for (const anomaly of state.anomalies) {
    if (anomaly.resolvedTick >= 0 || anomaly.escalatedTick >= 0) continue;

    if (tick === anomaly.onsetTick) {
      events.push({
        type: 'ONSET',
        anomalyId: anomaly.id,
        tick,
        detail: 'Anomaly detected',
      });
    }

    // `>=`, not `>`: a symptom drawn with zero delay is visible the moment the
    // anomaly starts, and would otherwise never be logged at all.
    if (tick >= anomaly.onsetTick) {
      for (const symptom of anomaly.symptoms) {
        if (tick === anomaly.onsetTick + seconds(symptom.delay_s)) {
          events.push({
            type: 'SYMPTOM',
            anomalyId: anomaly.id,
            tick,
            detail: graph.symptom(symptom.symptomId).title,
          });
        }
      }
    }

    // The window closing is a tick comparison, never a wall-clock timer.
    if (tick >= anomaly.escalationTick && tick >= anomaly.onsetTick) {
      anomaly.escalatedTick = tick;
      events.push({
        type: 'ESCALATED',
        anomalyId: anomaly.id,
        tick,
        detail: 'Escalation window closed without a fix',
      });

      // An unattended fault does not merely expire — it becomes the next one
      // (§5.3). A chain with nothing left to escalate into is the end of the
      // mission, which is what makes doing nothing the worst option rather
      // than a neutral one.
      const target = graph.escalationTarget(anomaly.causeId);
      if (target !== null && settings !== undefined) {
        const chain = spawnChain(state, graph, settings, seed, missionKey, anomaly, target, tick);
        events.push({
          type: 'CHAIN',
          anomalyId: chain.id,
          tick,
          detail: `Unattended: ${graph.cause(anomaly.causeId).title} → ${graph.cause(target).title}`,
        });
      } else if (target === null) {
        events.push({
          type: 'LOST',
          anomalyId: anomaly.id,
          tick,
          detail: `Mission lost: ${graph.cause(anomaly.causeId).title}`,
        });
      }
    }
  }

  return events;
}

export interface MeasureOutcome {
  readonly resolved: boolean;
  readonly correct: boolean;
  readonly spawnedAnomalyId: string | null;
  readonly events: AnomalyEvent[];
}

/**
 * Applies a resolution measure to an anomaly.
 *
 * A correct measure ends it. A wrong one is not merely wasted time: where the
 * graph says so, it sets off a chain — the failure mode §5.3 exists to make
 * visible in the post-mortem.
 */
export function applyMeasure(
  state: AnomalyState,
  graph: CauseGraph,
  settings: AnomalySettings,
  seed: number,
  missionKey: string,
  anomalyId: string,
  measureId: string,
  tick: number,
): MeasureOutcome {
  const anomaly = state.anomalies.find((entry) => entry.id === anomalyId);
  if (anomaly === undefined || !isActive(anomaly, tick)) {
    return { resolved: false, correct: false, spawnedAnomalyId: null, events: [] };
  }

  const correct = graph.isCorrectFor(anomaly.causeId, measureId);
  const sideEffect = correct ? null : graph.sideEffectOf(anomaly.causeId, measureId);
  const events: AnomalyEvent[] = [];
  let spawnedAnomalyId: string | null = null;

  anomaly.applied.push({ measureId, tick, correct, sideEffect });

  if (correct) {
    anomaly.resolvedTick = tick;
    events.push({
      type: 'RESOLVED',
      anomalyId: anomaly.id,
      tick,
      detail: graph.measure(measureId).title,
    });
  } else if (sideEffect !== null) {
    const chain = spawnChain(state, graph, settings, seed, missionKey, anomaly, sideEffect, tick);
    spawnedAnomalyId = chain.id;
    events.push({
      type: 'CHAIN',
      anomalyId: chain.id,
      tick,
      detail: `${graph.measure(measureId).title} → ${graph.cause(sideEffect).title}`,
    });
  }

  return { resolved: correct, correct, spawnedAnomalyId, events };
}

/**
 * Adds the cascade a wrong measure caused. Its id carries a serial so that two
 * identical cascades stay distinguishable in the log and in a replay.
 */
function spawnChain(
  state: AnomalyState,
  graph: CauseGraph,
  settings: AnomalySettings,
  seed: number,
  missionKey: string,
  parent: Anomaly,
  chainCauseId: string,
  tick: number,
): Anomaly {
  const serial = state.nextChainSerial;
  state.nextChainSerial += 1;

  const chain: Anomaly = {
    id: `chain:${chainCauseId}:${serial}`,
    causeId: chainCauseId,
    onsetTick: tick,
    escalationTick: tick + seconds(graph.escalationWindow_s(chainCauseId)),
    symptoms: buildSymptomInstances(
      graph,
      settings,
      seed,
      `${missionKey}/chain${serial}`,
      chainCauseId,
    ),
    spawnedBy: parent.id,
    resolvedTick: -1,
    escalatedTick: -1,
    applied: [],
  };
  state.anomalies.push(chain);
  return chain;
}

/**
 * The cause chain behind an anomaly, root first — what the post-mortem shows
 * instead of a single verdict (§7 ⑥).
 */
export function causeChain(state: AnomalyState, anomalyId: string): Anomaly[] {
  const chain: Anomaly[] = [];
  const byId = new Map(state.anomalies.map((anomaly) => [anomaly.id, anomaly]));

  let current = byId.get(anomalyId);
  const guard = new Set<string>();
  while (current !== undefined && !guard.has(current.id)) {
    guard.add(current.id);
    chain.unshift(current);
    current = current.spawnedBy === null ? undefined : byId.get(current.spawnedBy);
  }
  return chain;
}
