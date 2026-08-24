/**
 * The diagnosis runtime.
 *
 * The properties worth pinning are the ones that decide whether a crisis is a
 * puzzle: a measure pays out when it *completes*, information actually
 * narrows the field, and a fix landing on the last possible tick still counts.
 */
import { describe, expect, it } from 'vitest';

import anomalyData from '../../data/anomalies.json' with { type: 'json' };
import causesData from '../../data/causes.json' with { type: 'json' };
import priorData from '../../data/priors.json' with { type: 'json' };
import { TICKS_PER_SECOND } from '../engine.js';
import { createPauseState } from '../pauseModel.js';
import {
  type Anomaly,
  type AnomalySettings,
  planAnomalies,
  stepAnomalies,
} from '../systems/anomaly.js';

import { type CauseGraphData, loadCauseGraph } from './causeGraph.js';
import {
  type DiagnosisState,
  candidateBars,
  candidatesFor,
  createDiagnosisState,
  observedSymptoms,
  openAnomalies,
  queueMeasure,
  readDiagnosis,
  stepDiagnosis,
} from './diagnosis.js';
import type { PriorSettings } from './priors.js';

const graph = loadCauseGraph(causesData as unknown as CauseGraphData);
const anomalySettings = anomalyData as AnomalySettings;
const priorSettings = priorData as PriorSettings;
const seconds = (value: number): number => Math.round(value * TICKS_PER_SECOND);

function missionContaining(causeId: string): { key: string; anomaly: Anomaly } {
  for (let attempt = 0; attempt < 500; attempt++) {
    const key = `mission-${attempt}`;
    const found = planAnomalies(graph, anomalySettings, 42, key, 0).find(
      (anomaly) => anomaly.causeId === causeId,
    );
    if (found !== undefined) return { key, anomaly: found };
  }
  throw new Error(`no mission produced ${causeId}`);
}

/**
 * A runtime holding exactly one anomaly, starting at tick 0.
 *
 * `symptomDelays` pins the onset delays where a test depends on which symptoms
 * are on screen; leaving it out keeps the drawn values.
 */
function runtimeWith(
  causeId: string,
  symptomDelays?: Record<string, number>,
): { state: DiagnosisState; anomaly: Anomaly; key: string } {
  const { key, anomaly } = missionContaining(causeId);
  const state = createDiagnosisState(createPauseState('standard'), []);
  const placed: Anomaly = {
    ...anomaly,
    onsetTick: 0,
    escalationTick: seconds(graph.escalationWindow_s(causeId)),
    applied: [],
    symptoms:
      symptomDelays === undefined
        ? anomaly.symptoms
        : anomaly.symptoms.map((symptom) => ({
            ...symptom,
            delay_s: symptomDelays[symptom.symptomId] ?? symptom.delay_s,
          })),
  };
  state.anomalies.anomalies = [placed];
  return { state, anomaly: placed, key };
}

function step(state: DiagnosisState, key: string, tick: number) {
  return stepDiagnosis(state, graph, anomalySettings, 42, key, tick, stepAnomalies);
}

describe('reading a diagnosis', () => {
  it('names the cause when the measure covers it', () => {
    const result = readDiagnosis(graph, 'measure_diag_crosscheck', 'cause_sensor_defective', 'a', 100);
    expect(result.confirmed).toBe('cause_sensor_defective');
    expect(result.excluded).toEqual([]);
  });

  it('rules the set out when it does not', () => {
    const result = readDiagnosis(graph, 'measure_diag_crosscheck', 'cause_prop_leak', 'a', 100);
    expect(result.confirmed).toBeNull();
    expect(result.excluded).toEqual(['cause_sensor_defective']);
  });

  it('never rules out the real cause', () => {
    // The fairness rule (§5.5) depends on this: information may cost, but it
    // must never mislead.
    for (const causeId of graph.causeIds) {
      for (const measureId of graph.measureIds) {
        if (graph.measure(measureId).type !== 'diagnosis') continue;
        const result = readDiagnosis(graph, measureId, causeId, 'a', 0);
        expect(result.excluded).not.toContain(causeId);
      }
    }
  });
});

describe('what the player knows', () => {
  it('shows only symptoms past their delay', () => {
    const { state, anomaly, key } = runtimeWith('cause_prop_leak');
    const slowest = anomaly.symptoms.reduce((a, b) => (a.delay_s > b.delay_s ? a : b));
    step(state, key, 0);

    expect(observedSymptoms(state, anomaly.id, seconds(slowest.delay_s) - 1)).not.toContain(
      slowest.symptomId,
    );
    expect(observedSymptoms(state, anomaly.id, seconds(slowest.delay_s))).toContain(
      slowest.symptomId,
    );
  });

  it('narrows the candidates when a diagnosis rules something out', () => {
    // Only the pressure drop is on screen; the other two readings are still
    // ahead, so three causes are live and the diagnosis has work to do.
    const { state, anomaly, key } = runtimeWith('cause_prop_leak', {
      sym_pressure_drop: 0,
      sym_telemetry_gaps: 40,
      sym_wobble: 40,
    });
    const before = candidatesFor(state, graph, anomaly.id, seconds(11));
    expect(before).toHaveLength(3);

    queueMeasure(state, 'measure_diag_crosscheck', anomaly.id, 0);
    for (let tick = 0; tick <= seconds(10); tick++) step(state, key, tick);

    const after = candidatesFor(state, graph, anomaly.id, seconds(11));
    expect(after.length).toBeLessThan(before.length);
    expect(after).not.toContain('cause_sensor_defective');
    expect(after).toContain('cause_prop_leak');
  });

  it('collapses to one when a diagnosis confirms', () => {
    const { state, anomaly, key } = runtimeWith('cause_sensor_defective');
    queueMeasure(state, 'measure_diag_crosscheck', anomaly.id, 0);
    for (let tick = 0; tick <= seconds(10); tick++) step(state, key, tick);

    expect(candidatesFor(state, graph, anomaly.id, seconds(20))).toEqual(['cause_sensor_defective']);
  });

  it('weights the surviving candidates by context', () => {
    const { state, anomaly, key } = runtimeWith('cause_prop_leak', {
      sym_pressure_drop: 0,
      sym_telemetry_gaps: 40,
      sym_wobble: 40,
    });
    step(state, key, 0);
    const bars = candidateBars(state, graph, priorSettings, anomaly.id, 'MAX_Q', seconds(11));
    expect(bars.length).toBeGreaterThan(1);
    expect(bars.reduce((sum, bar) => sum + bar.probability, 0)).toBeCloseTo(1, 12);
    expect(bars[0].causeId).toBe('cause_prop_leak');
  });

  it('records how much the symptom set gives away for free', () => {
    // A measurement, not an approval. Three of the four root causes are the
    // only cause explaining their full symptom set, and every symptom is
    // visible within 12 s against windows of 45–60 s — so waiting beats paying
    // for a diagnosis. §9 calls this out as the thing to fix by densifying the
    // graph; the linter's rule 2 checks single symptoms and cannot see it.
    // When the graph is densified this number drops, and this test says so.
    const selfIdentifying = graph.causeIds.filter((causeId) => {
      if (graph.cause(causeId).is_chain) return false;
      const needed = graph.cause(causeId).symptoms;
      return (
        graph.causeIds.filter((other) =>
          needed.every((symptomId) => graph.cause(other).symptoms.includes(symptomId)),
        ).length === 1
      );
    });
    expect(selfIdentifying).toEqual([
      'cause_prop_leak',
      'cause_sensor_defective',
      'cause_bus_short',
    ]);
  });
});

describe('measures pay out when they complete', () => {
  it('gives nothing while the measure is still running', () => {
    const { state, anomaly, key } = runtimeWith('cause_sensor_defective');
    queueMeasure(state, 'measure_diag_crosscheck', anomaly.id, 0);
    for (let tick = 0; tick < seconds(10); tick++) step(state, key, tick);
    expect(state.results).toHaveLength(0);
  });

  it('delivers the result on the tick it lands, with a RESULT READY offer', () => {
    const { state, anomaly, key } = runtimeWith('cause_sensor_defective');
    queueMeasure(state, 'measure_diag_crosscheck', anomaly.id, 0);

    let landed: number | null = null;
    for (let tick = 0; tick <= seconds(12); tick++) {
      if (step(state, key, tick).results.length > 0) landed = tick;
    }
    expect(landed).toBe(seconds(10));
    expect(state.pause.offer?.measureId).toBe('measure_diag_crosscheck');
  });

  it('applies a resolution only when it finishes, not when it is queued', () => {
    const { state, anomaly, key } = runtimeWith('cause_prop_leak');
    queueMeasure(state, 'measure_iso_valve', anomaly.id, 0);

    for (let tick = 0; tick < seconds(5); tick++) step(state, key, tick);
    expect(state.anomalies.anomalies[0].resolvedTick).toBe(-1);

    step(state, key, seconds(5));
    expect(state.anomalies.anomalies[0].resolvedTick).toBe(seconds(5));
  });

  it('lets a fix landing on the last tick still count', () => {
    // A player who planned to the second deserves the second: payouts are
    // processed before the escalation check.
    const { state, anomaly, key } = runtimeWith('cause_prop_leak');
    const queueAt = anomaly.escalationTick - seconds(5);
    queueMeasure(state, 'measure_iso_valve', anomaly.id, queueAt);

    for (let tick = 0; tick <= anomaly.escalationTick; tick++) step(state, key, tick);

    expect(state.anomalies.anomalies[0].resolvedTick).toBe(anomaly.escalationTick);
    expect(state.anomalies.anomalies[0].escalatedTick).toBe(-1);
  });

  it('escalates when the fix lands one tick too late', () => {
    const { state, anomaly, key } = runtimeWith('cause_prop_leak');
    queueMeasure(state, 'measure_iso_valve', anomaly.id, anomaly.escalationTick - seconds(5) + 1);
    for (let tick = 0; tick <= anomaly.escalationTick + 10; tick++) step(state, key, tick);

    expect(state.anomalies.anomalies[0].escalatedTick).toBe(anomaly.escalationTick);
    expect(state.anomalies.anomalies[0].resolvedTick).toBe(-1);
  });

  it('sets off the chain when the wrong fix completes', () => {
    const { state, anomaly, key } = runtimeWith('cause_prop_leak');
    queueMeasure(state, 'measure_increase_pressure', anomaly.id, 0);
    for (let tick = 0; tick <= seconds(5); tick++) step(state, key, tick);

    expect(state.anomalies.anomalies).toHaveLength(2);
    expect(state.anomalies.anomalies[1].causeId).toBe('chain_flameout');
  });
});

describe('parallel work under scarcity', () => {
  it('runs three diagnoses at once and lands them on their own schedule', () => {
    const { state, anomaly, key } = runtimeWith('cause_prop_leak');
    for (const measureId of [
      'measure_diag_crosscheck',
      'measure_diag_team_prop',
      'measure_diag_team_avionics',
    ]) {
      queueMeasure(state, measureId, anomaly.id, 0);
    }

    const landings = new Map<string, number>();
    for (let tick = 0; tick <= seconds(50); tick++) {
      for (const result of step(state, key, tick).results) landings.set(result.measureId, tick);
    }
    expect(landings.get('measure_diag_crosscheck')).toBe(seconds(10));
    expect(landings.get('measure_diag_team_prop')).toBe(seconds(45));
    expect(landings.get('measure_diag_team_avionics')).toBe(seconds(45));
  });

  it('makes a fourth action wait for bandwidth', () => {
    const { state, anomaly, key } = runtimeWith('cause_prop_leak');
    for (const measureId of [
      'measure_diag_crosscheck',
      'measure_diag_team_prop',
      'measure_diag_team_avionics',
      'measure_iso_valve',
    ]) {
      queueMeasure(state, measureId, anomaly.id, 0);
    }
    // All four channels are busy until the cross-check releases two at +10 s.
    for (let tick = 0; tick < seconds(10); tick++) step(state, key, tick);
    expect(state.anomalies.anomalies[0].resolvedTick).toBe(-1);

    for (let tick = seconds(10); tick <= seconds(16); tick++) step(state, key, tick);
    expect(state.anomalies.anomalies[0].resolvedTick).toBe(seconds(15));
  });
});

describe('auto-pause', () => {
  it('asks to stop when the first symptom becomes visible, not at onset', () => {
    // Pausing at onset would hand the player an empty panel: no symptom, no
    // candidates, nothing to decide.
    const { state, anomaly, key } = runtimeWith('cause_prop_leak', {
      sym_pressure_drop: 6,
      sym_telemetry_gaps: 40,
      sym_wobble: 40,
    });
    expect(step(state, key, anomaly.onsetTick).autoPause).toBe(false);

    let paused: number | null = null;
    for (let tick = anomaly.onsetTick + 1; tick <= seconds(8); tick++) {
      if (step(state, key, tick).autoPause) paused = tick;
    }
    expect(paused).toBe(seconds(6));
  });

  it('has something to show by the time it stops the clock', () => {
    const { state, anomaly, key } = runtimeWith('cause_prop_leak', {
      sym_pressure_drop: 3,
      sym_telemetry_gaps: 40,
      sym_wobble: 40,
    });
    for (let tick = anomaly.onsetTick; tick <= seconds(3); tick++) {
      if (step(state, key, tick).autoPause) {
        expect(observedSymptoms(state, anomaly.id, tick).length).toBeGreaterThan(0);
        expect(candidatesFor(state, graph, anomaly.id, tick).length).toBeGreaterThan(0);
      }
    }
  });

  it('asks again for a chain the player caused', () => {
    const { state, anomaly, key } = runtimeWith('cause_prop_leak');
    step(state, key, 0);
    queueMeasure(state, 'measure_increase_pressure', anomaly.id, 1);

    let asked = false;
    for (let tick = 1; tick <= seconds(6); tick++) {
      if (step(state, key, tick).autoPause) asked = true;
    }
    expect(asked).toBe(true);
  });
});

describe('open anomalies', () => {
  it('lists what still needs attention', () => {
    const { state, anomaly, key } = runtimeWith('cause_prop_leak');
    step(state, key, 0);
    expect(openAnomalies(state, 10)).toEqual([anomaly.id]);

    queueMeasure(state, 'measure_iso_valve', anomaly.id, 10);
    for (let tick = 10; tick <= seconds(16); tick++) step(state, key, tick);
    expect(openAnomalies(state, seconds(16))).toEqual([]);
  });
});
