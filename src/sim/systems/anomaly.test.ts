/**
 * The anomaly system.
 *
 * The properties that matter are the ones a player would feel: the same
 * mission always throws the same anomalies, a wrong measure has a consequence
 * rather than merely wasting time, and the escalation window closes on a tick
 * count rather than on anything the UI does.
 */
import { describe, expect, it } from 'vitest';

import anomalySettings from '../../data/anomalies.json' with { type: 'json' };
import causesData from '../../data/causes.json' with { type: 'json' };
import { type CauseGraphData, loadCauseGraph } from '../diagnosis/causeGraph.js';
import { TICKS_PER_SECOND } from '../engine.js';
import { hashUnit } from '../rng.js';

import {
  type Anomaly,
  type AnomalySettings,
  type AnomalyState,
  activeAnomalies,
  applyMeasure,
  causeChain,
  createAnomalyState,
  isActive,
  planAnomalies,
  stepAnomalies,
  ticksToEscalation,
  visibleSymptoms,
} from './anomaly.js';

const graph = loadCauseGraph(causesData as unknown as CauseGraphData);
const settings = anomalySettings as AnomalySettings;
const seconds = (value: number): number => Math.round(value * TICKS_PER_SECOND);

function stateWith(anomalies: Anomaly[]): AnomalyState {
  const state = createAnomalyState();
  state.anomalies = anomalies;
  return state;
}

/** A mission that definitely contains the named cause. */
function missionContaining(causeId: string): { key: string; anomaly: Anomaly } {
  for (let attempt = 0; attempt < 500; attempt++) {
    const key = `mission-${attempt}`;
    const found = planAnomalies(graph, settings, 42, key, 0).find(
      (anomaly) => anomaly.causeId === causeId,
    );
    if (found !== undefined) return { key, anomaly: found };
  }
  throw new Error(`no mission produced ${causeId}`);
}

describe('planning', () => {
  it('gives the same mission the same anomalies every time', () => {
    const first = planAnomalies(graph, settings, 42, 'mission-1', 0);
    for (let i = 0; i < 50; i++) hashUnit(42, `noise-${i}`, 'unrelated');
    expect(planAnomalies(graph, settings, 42, 'mission-1', 0)).toEqual(first);
  });

  it('gives different missions and seeds different anomalies', () => {
    const base = JSON.stringify(planAnomalies(graph, settings, 42, 'mission-1', 0));
    const otherMission = JSON.stringify(planAnomalies(graph, settings, 42, 'mission-2', 0));
    const otherSeed = JSON.stringify(planAnomalies(graph, settings, 43, 'mission-1', 0));
    expect(otherMission).not.toBe(base);
    expect(otherSeed).not.toBe(base);
  });

  it('draws each cause independently of the others', () => {
    // Keyed draws, not a roll sequence: whether the valve fires must not
    // depend on whether the bus short did (§8.2 rule 4).
    const source = causesData as unknown as CauseGraphData;
    const full = planAnomalies(graph, settings, 42, 'mission-7', 0);

    // Remove the cause *and* every reference to it, so the reduced graph is a
    // consistent graph rather than one with a hole — the validator rightly
    // rejects the latter.
    const withoutOne: CauseGraphData = {
      ...source,
      causes: Object.fromEntries(
        Object.entries(source.causes).filter(([id]) => id !== 'cause_bus_short'),
      ),
      measures: Object.fromEntries(
        Object.entries(source.measures).map(([id, measure]) => [
          id,
          {
            ...measure,
            discriminates: measure.discriminates?.filter((causeId) => causeId !== 'cause_bus_short'),
          },
        ]),
      ),
    };
    const reduced = planAnomalies(loadCauseGraph(withoutOne), settings, 42, 'mission-7', 0);

    const survivors = full.filter((anomaly) => anomaly.causeId !== 'cause_bus_short');
    expect(reduced.map((a) => `${a.causeId}@${a.onsetTick}`)).toEqual(
      survivors.map((a) => `${a.causeId}@${a.onsetTick}`),
    );
  });

  it('plans only root causes — chains are earned, not scheduled', () => {
    for (let mission = 0; mission < 100; mission++) {
      for (const anomaly of planAnomalies(graph, settings, 42, `m${mission}`, 0)) {
        expect(graph.cause(anomaly.causeId).is_chain).toBeFalsy();
        expect(anomaly.spawnedBy).toBeNull();
      }
    }
  });

  it('starts every anomaly inside the onset window', () => {
    for (let mission = 0; mission < 100; mission++) {
      for (const anomaly of planAnomalies(graph, settings, 42, `m${mission}`, 1000)) {
        expect(anomaly.onsetTick).toBeGreaterThanOrEqual(
          1000 + seconds(settings.onsetWindow_s.earliest),
        );
        expect(anomaly.onsetTick).toBeLessThanOrEqual(
          1000 + seconds(settings.onsetWindow_s.latest),
        );
      }
    }
  });

  it('sets the escalation window from the cause', () => {
    const { anomaly } = missionContaining('cause_prop_leak');
    expect(anomaly.escalationTick - anomaly.onsetTick).toBe(seconds(55));
  });

  it('keeps the tension budget the concept asks for', () => {
    // §5.6: 2–4 relevant events per mission, before chains add any.
    const counts: number[] = [];
    for (let mission = 0; mission < 1000; mission++) {
      counts.push(planAnomalies(graph, settings, 42, `m${mission}`, 0).length);
    }
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    expect(mean).toBeGreaterThan(1.8);
    expect(mean).toBeLessThan(3.2);
    // A mission with nothing to do at all should be rare, not routine.
    expect(counts.filter((count) => count === 0).length / counts.length).toBeLessThan(0.1);
  });

  it('orders the plan by onset, whatever order the file declares causes in', () => {
    for (let mission = 0; mission < 50; mission++) {
      const planned = planAnomalies(graph, settings, 42, `m${mission}`, 0);
      for (let i = 1; i < planned.length; i++) {
        expect(planned[i].onsetTick).toBeGreaterThanOrEqual(planned[i - 1].onsetTick);
      }
    }
  });
});

describe('onset and symptoms', () => {
  const { anomaly } = missionContaining('cause_prop_leak');

  it('is not active before its onset tick', () => {
    expect(isActive(anomaly, anomaly.onsetTick - 1)).toBe(false);
    expect(isActive(anomaly, anomaly.onsetTick)).toBe(true);
  });

  it('reveals a symptom only after its own delay', () => {
    const state = stateWith([{ ...anomaly, applied: [] }]);
    const target = state.anomalies[0];
    const slowest = target.symptoms.reduce((a, b) => (a.delay_s > b.delay_s ? a : b));

    const justBefore = target.onsetTick + seconds(slowest.delay_s) - 1;
    expect(visibleSymptoms(target, justBefore).map((s) => s.symptomId)).not.toContain(
      slowest.symptomId,
    );
    expect(
      visibleSymptoms(target, target.onsetTick + seconds(slowest.delay_s)).map((s) => s.symptomId),
    ).toContain(slowest.symptomId);
  });

  it('announces onset and each symptom exactly once', () => {
    const state = stateWith([{ ...anomaly, applied: [] }]);
    const target = state.anomalies[0];
    const seen: string[] = [];
    for (let tick = target.onsetTick; tick < target.escalationTick; tick++) {
      for (const event of stepAnomalies(state, graph, tick)) {
        if (event.type === 'ONSET' || event.type === 'SYMPTOM') seen.push(`${event.type}:${event.detail}`);
      }
    }
    expect(seen.filter((entry) => entry.startsWith('ONSET'))).toHaveLength(1);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.filter((entry) => entry.startsWith('SYMPTOM'))).toHaveLength(
      target.symptoms.length,
    );
  });

  it('logs a zero-delay symptom at onset rather than losing it', () => {
    const state = stateWith([
      {
        ...anomaly,
        onsetTick: 100,
        escalationTick: 900,
        symptoms: [{ symptomId: 'sym_pressure_drop', strength: 0.8, delay_s: 0 }],
        applied: [],
      },
    ]);
    const events = stepAnomalies(state, graph, 100);
    expect(events.map((event) => event.type)).toContain('SYMPTOM');
  });
});

describe('escalation', () => {
  it('closes the window on the tick, and only then', () => {
    const { anomaly } = missionContaining('cause_prop_leak');
    const state = stateWith([{ ...anomaly, applied: [] }]);
    const target = state.anomalies[0];

    stepAnomalies(state, graph, target.escalationTick - 1);
    expect(target.escalatedTick).toBe(-1);

    const events = stepAnomalies(state, graph, target.escalationTick);
    expect(target.escalatedTick).toBe(target.escalationTick);
    expect(events.map((event) => event.type)).toContain('ESCALATED');
  });

  it('escalates once, not on every later tick', () => {
    const { anomaly } = missionContaining('cause_prop_leak');
    const state = stateWith([{ ...anomaly, applied: [] }]);
    const target = state.anomalies[0];

    let escalations = 0;
    for (let tick = target.escalationTick; tick < target.escalationTick + 50; tick++) {
      escalations += stepAnomalies(state, graph, tick).filter((e) => e.type === 'ESCALATED').length;
    }
    expect(escalations).toBe(1);
  });

  it('never escalates an anomaly that was resolved in time', () => {
    const { key, anomaly } = missionContaining('cause_prop_leak');
    const state = stateWith([{ ...anomaly, applied: [] }]);
    const target = state.anomalies[0];

    applyMeasure(state, graph, settings, 42, key, target.id, 'measure_iso_valve', target.onsetTick + 10);
    for (let tick = target.onsetTick; tick < target.escalationTick + 100; tick++) {
      stepAnomalies(state, graph, tick);
    }
    expect(target.escalatedTick).toBe(-1);
    expect(target.resolvedTick).toBe(target.onsetTick + 10);
  });

  it('counts down to the escalation the console displays', () => {
    const { anomaly } = missionContaining('cause_prop_leak');
    expect(ticksToEscalation(anomaly, anomaly.onsetTick)).toBe(seconds(55));
    expect(ticksToEscalation(anomaly, anomaly.escalationTick)).toBe(0);
  });
});

describe('measures and their consequences', () => {
  it('resolves the anomaly when the measure is right', () => {
    const { key, anomaly } = missionContaining('cause_prop_leak');
    const state = stateWith([{ ...anomaly, applied: [] }]);
    const outcome = applyMeasure(
      state, graph, settings, 42, key, anomaly.id, 'measure_iso_valve', anomaly.onsetTick + 5,
    );
    expect(outcome.resolved).toBe(true);
    expect(activeAnomalies(state, anomaly.onsetTick + 6)).toHaveLength(0);
  });

  it('sets off the chain when the measure is wrong — not just wasted time', () => {
    // §5.3: raising pressure on a leak makes the leak worse.
    const { key, anomaly } = missionContaining('cause_prop_leak');
    const state = stateWith([{ ...anomaly, applied: [] }]);
    const outcome = applyMeasure(
      state, graph, settings, 42, key, anomaly.id, 'measure_increase_pressure', anomaly.onsetTick + 5,
    );

    expect(outcome.resolved).toBe(false);
    expect(outcome.spawnedAnomalyId).not.toBeNull();
    const chain = state.anomalies.find((entry) => entry.id === outcome.spawnedAnomalyId);
    expect(chain?.causeId).toBe('chain_flameout');
    expect(chain?.spawnedBy).toBe(anomaly.id);
    // The original is still unresolved and still on its own clock.
    expect(state.anomalies[0].resolvedTick).toBe(-1);
  });

  it('wastes the time but spawns nothing for a measure with no side effect', () => {
    const { key, anomaly } = missionContaining('cause_prop_leak');
    const state = stateWith([{ ...anomaly, applied: [] }]);
    const outcome = applyMeasure(
      state, graph, settings, 42, key, anomaly.id, 'measure_loads_off', anomaly.onsetTick + 5,
    );
    expect(outcome.resolved).toBe(false);
    expect(outcome.spawnedAnomalyId).toBeNull();
    expect(state.anomalies).toHaveLength(1);
  });

  it('records what was tried, for the post-mortem to show', () => {
    const { key, anomaly } = missionContaining('cause_prop_leak');
    const state = stateWith([{ ...anomaly, applied: [] }]);
    applyMeasure(state, graph, settings, 42, key, anomaly.id, 'measure_loads_off', anomaly.onsetTick + 5);
    applyMeasure(state, graph, settings, 42, key, anomaly.id, 'measure_iso_valve', anomaly.onsetTick + 20);

    expect(state.anomalies[0].applied.map((entry) => entry.measureId)).toEqual([
      'measure_loads_off',
      'measure_iso_valve',
    ]);
    expect(state.anomalies[0].applied[1].correct).toBe(true);
  });

  it('ignores a measure aimed at an anomaly that is over', () => {
    const { key, anomaly } = missionContaining('cause_prop_leak');
    const state = stateWith([{ ...anomaly, applied: [] }]);
    applyMeasure(state, graph, settings, 42, key, anomaly.id, 'measure_iso_valve', anomaly.onsetTick + 5);
    const second = applyMeasure(
      state, graph, settings, 42, key, anomaly.id, 'measure_iso_valve', anomaly.onsetTick + 6,
    );
    expect(second.resolved).toBe(false);
    expect(state.anomalies[0].applied).toHaveLength(1);
  });

  it('keeps two identical cascades distinguishable', () => {
    const { key, anomaly } = missionContaining('cause_prop_leak');
    const state = stateWith([
      { ...anomaly, id: 'a', applied: [] },
      { ...anomaly, id: 'b', applied: [] },
    ]);
    const first = applyMeasure(state, graph, settings, 42, key, 'a', 'measure_increase_pressure', anomaly.onsetTick + 1);
    const second = applyMeasure(state, graph, settings, 42, key, 'b', 'measure_increase_pressure', anomaly.onsetTick + 1);
    expect(first.spawnedAnomalyId).not.toBe(second.spawnedAnomalyId);
  });
});

describe('the cause chain the post-mortem shows', () => {
  it('returns the whole cascade, root first', () => {
    const { key, anomaly } = missionContaining('cause_prop_leak');
    const state = stateWith([{ ...anomaly, applied: [] }]);
    const outcome = applyMeasure(
      state, graph, settings, 42, key, anomaly.id, 'measure_increase_pressure', anomaly.onsetTick + 5,
    );

    const chain = causeChain(state, outcome.spawnedAnomalyId!);
    expect(chain.map((entry) => entry.causeId)).toEqual(['cause_prop_leak', 'chain_flameout']);
  });

  it('returns a single entry for an anomaly nobody caused', () => {
    const { anomaly } = missionContaining('cause_prop_leak');
    const state = stateWith([{ ...anomaly, applied: [] }]);
    expect(causeChain(state, anomaly.id)).toHaveLength(1);
  });
});
