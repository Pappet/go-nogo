/**
 * The post-mortem.
 *
 * Its job is to explain rather than to score, so the tests are about whether
 * the account is *true*: the chain is shown root-first, a wrong measure is
 * named along with what it set off, and nothing is invented for a mission
 * where nothing happened.
 */
import { describe, expect, it } from 'vitest';

import anomalyData from '../../data/anomalies.json' with { type: 'json' };
import causesData from '../../data/causes.json' with { type: 'json' };
import { TICKS_PER_SECOND } from '../engine.js';
import { createPauseState } from '../pauseModel.js';
import {
  type Anomaly,
  type AnomalySettings,
  applyMeasure,
  createAnomalyState,
  planAnomalies,
  stepAnomalies,
} from '../systems/anomaly.js';

import { type CauseGraphData, loadCauseGraph } from './causeGraph.js';
import { createDiagnosisState, readDiagnosis } from './diagnosis.js';
import { buildMissionReport, verdictLine } from './postMortem.js';

const graph = loadCauseGraph(causesData as unknown as CauseGraphData);
const settings = anomalyData as AnomalySettings;
const seconds = (value: number): number => Math.round(value * TICKS_PER_SECOND);

function anomalyOf(causeId: string): { key: string; anomaly: Anomaly } {
  for (let attempt = 0; attempt < 500; attempt++) {
    const key = `mission-${attempt}`;
    const found = planAnomalies(graph, settings, 42, key, 0).find((a) => a.causeId === causeId);
    if (found !== undefined) {
      return { key, anomaly: { ...found, onsetTick: 0, escalationTick: seconds(55), applied: [] } };
    }
  }
  throw new Error(`no mission produced ${causeId}`);
}

const report = (state = createAnomalyState(), results: never[] = [], lost = false) =>
  buildMissionReport(graph, state, results, lost, 0.11, TICKS_PER_SECOND);

describe('a mission where nothing happened', () => {
  it('invents nothing', () => {
    const empty = report();
    expect(empty.anomalies).toEqual([]);
    expect(empty.untouched).toBe(0);
    expect(empty.wrongMeasures).toBe(0);
    expect(verdictLine(empty)).toContain('Nothing materialised');
  });

  it('still names the risk that was accepted', () => {
    expect(verdictLine(report())).toContain('11 %');
  });
});

describe('an anomaly the player fixed', () => {
  it('records the verdict, the measure and the time it took', () => {
    const { key, anomaly } = anomalyOf('cause_prop_leak');
    const state = createAnomalyState();
    state.anomalies = [anomaly];
    applyMeasure(state, graph, settings, 42, key, anomaly.id, 'measure_iso_valve', seconds(20));

    const built = report(state);
    const entry = built.anomalies[0];
    expect(entry.verdict).toBe('resolved');
    expect(entry.attempts.map((a) => a.title)).toEqual(['Close isolation valve']);
    expect(entry.attempts[0].correct).toBe(true);
    expect(entry.secondsUsed).toBeCloseTo(20, 6);
    expect(entry.windowSeconds).toBe(55);
    expect(built.wrongMeasures).toBe(0);
  });

  it('lists the diagnoses that were bought and what they said', () => {
    const { anomaly } = anomalyOf('cause_prop_leak');
    const state = createAnomalyState();
    state.anomalies = [anomaly];
    const results = [
      readDiagnosis(graph, 'measure_diag_crosscheck', anomaly.causeId, anomaly.id, seconds(10)),
    ];

    const built = buildMissionReport(graph, state, results, false, 0.11, TICKS_PER_SECOND);
    const diagnosis = built.anomalies[0].diagnoses[0];
    expect(diagnosis.title).toBe('Sensor cross-check');
    expect(diagnosis.confirmed).toBeNull();
    expect(diagnosis.excluded).toEqual(['Pressure sensor defective / Measurement error']);
    expect(built.diagnosesBought).toBe(1);
  });
});

describe('an anomaly the player made worse', () => {
  it('names the wrong measure and what it set off', () => {
    // §5.3 in one line: this is the sentence the post-mortem exists to print.
    const { key, anomaly } = anomalyOf('cause_prop_leak');
    const state = createAnomalyState();
    state.anomalies = [anomaly];
    applyMeasure(state, graph, settings, 42, key, anomaly.id, 'measure_increase_pressure', seconds(10));

    const built = report(state, [], true);
    const attempt = built.anomalies[0].attempts[0];
    expect(attempt.correct).toBe(false);
    expect(attempt.title).toBe('Increase tank pressure');
    expect(attempt.causedChain).toBe('Cascading failure: Catastrophic engine failure');
    expect(built.wrongMeasures).toBe(1);
  });

  it('shows the cascade root first', () => {
    const { key, anomaly } = anomalyOf('cause_prop_leak');
    const state = createAnomalyState();
    state.anomalies = [anomaly];
    applyMeasure(state, graph, settings, 42, key, anomaly.id, 'measure_increase_pressure', seconds(10));

    const chain = report(state).anomalies[1].chain.map((entry) => entry.title);
    expect(chain).toEqual([
      'Propellant leak (Cryo)',
      'Cascading failure: Catastrophic engine failure',
    ]);
  });
});

describe('an anomaly nobody touched', () => {
  it('counts it, because that is the expensive kind of mistake', () => {
    const { anomaly } = anomalyOf('cause_bus_short');
    const state = createAnomalyState();
    state.anomalies = [anomaly];
    stepAnomalies(state, graph, anomaly.escalationTick, settings, 42, 'mission-1');

    const built = report(state);
    expect(built.anomalies[0].verdict).toBe('escalated');
    expect(built.untouched).toBeGreaterThan(0);
    expect(built.anomalies[0].secondsUsed).toBeCloseTo(55, 6);
  });

  it('says what materialised, and that the vehicle was lost', () => {
    const { anomaly } = anomalyOf('cause_bus_short');
    const state = createAnomalyState();
    state.anomalies = [anomaly];
    stepAnomalies(state, graph, anomaly.escalationTick, settings, 42, 'mission-1');

    const line = verdictLine(report(state, [], true));
    expect(line).toContain('Risk accepted: 11 %');
    expect(line).toContain('Short circuit in power bus');
    expect(line).toContain('Vehicle lost');
  });
});

describe('the report is derived, not recorded', () => {
  it('reads the same state twice to the same report', () => {
    // Nothing is written for the post-mortem's benefit, so it cannot drift
    // from what actually happened.
    const { key, anomaly } = anomalyOf('cause_prop_leak');
    const state = createAnomalyState();
    state.anomalies = [anomaly];
    applyMeasure(state, graph, settings, 42, key, anomaly.id, 'measure_loads_off', seconds(5));

    expect(JSON.stringify(report(state))).toBe(JSON.stringify(report(state)));
  });

  it('covers every anomaly the mission produced, chains included', () => {
    const { key, anomaly } = anomalyOf('cause_prop_leak');
    const state = createAnomalyState();
    state.anomalies = [anomaly];
    applyMeasure(state, graph, settings, 42, key, anomaly.id, 'measure_increase_pressure', seconds(10));

    expect(report(state).anomalies).toHaveLength(state.anomalies.length);
  });

  it('is built from a diagnosis state without extra bookkeeping', () => {
    const diagnosis = createDiagnosisState(createPauseState('standard'), []);
    const built = buildMissionReport(
      graph,
      diagnosis.anomalies,
      diagnosis.results,
      false,
      0.11,
      TICKS_PER_SECOND,
    );
    expect(built.anomalies).toEqual([]);
  });
});
