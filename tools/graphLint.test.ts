/**
 * The graph linter's scheduler.
 *
 * Rule 4 (§8.4) is only as trustworthy as this function: it decides whether a
 * cause is solvable inside its escalation window. An optimistic scheduler
 * would pass a graph the game cannot actually solve, which is the one failure
 * mode a linter must not have.
 */
import { describe, expect, it } from 'vitest';

import anomalyData from '../src/data/anomalies.json' with { type: 'json' };
import causesData from '../src/data/causes.json' with { type: 'json' };

import {
  type GraphData,
  lintGraph,
  meanFreeIdentification,
  scheduleMakespan,
} from './graphLint.js';

/** A graph containing only what the scheduling tests need. */
function graphWith(
  measures: Record<string, { duration_s: number; occupies: string[] }>,
  resources: Record<string, number> = {},
): GraphData {
  return {
    _resources: resources,
    symptoms: {},
    causes: {},
    measures: Object.fromEntries(
      Object.entries(measures).map(([id, measure]) => [
        id,
        { title: id, type: 'diagnosis' as const, ...measure },
      ]),
    ),
  };
}

describe('scheduleMakespan', () => {
  it('runs conflict-free measures in parallel', () => {
    const data = graphWith({
      a: { duration_s: 10, occupies: ['channel:any'] },
      b: { duration_s: 45, occupies: ['engineer:prop'] },
    });
    // The concept's own example: 45 s makespan, not a 55 s sum.
    expect(scheduleMakespan(['a', 'b'], data)).toBe(45);
  });

  it('serialises measures competing for one slot', () => {
    const data = graphWith({
      a: { duration_s: 10, occupies: ['channel:any'] },
      b: { duration_s: 20, occupies: ['channel:any'] },
    });
    expect(scheduleMakespan(['a', 'b'], data)).toBe(30);
  });

  it('uses the capacity it is given', () => {
    const data = graphWith(
      {
        a: { duration_s: 10, occupies: ['channel:any'] },
        b: { duration_s: 20, occupies: ['channel:any'] },
      },
      { 'channel:any': 2 },
    );
    expect(scheduleMakespan(['a', 'b'], data)).toBe(20);
  });

  it('treats a repeated token as a request for that many slots', () => {
    // The bug this replaces: each occurrence was checked against the current
    // state separately, so a two-slot measure could start with one slot free.
    const data = graphWith(
      {
        wide: { duration_s: 10, occupies: ['channel:any', 'channel:any'] },
        narrow: { duration_s: 20, occupies: ['channel:any'] },
      },
      { 'channel:any': 2 },
    );
    // Only two channels: the wide measure needs both, so they cannot overlap.
    expect(scheduleMakespan(['wide', 'narrow'], data)).toBe(30);
  });

  it('lets a wide and a narrow measure overlap when the capacity allows', () => {
    const data = graphWith(
      {
        wide: { duration_s: 10, occupies: ['channel:any', 'channel:any'] },
        narrow: { duration_s: 20, occupies: ['channel:any'] },
      },
      { 'channel:any': 3 },
    );
    expect(scheduleMakespan(['wide', 'narrow'], data)).toBe(20);
  });

  it('reports an impossible demand rather than pretending it fits', () => {
    const data = graphWith(
      { greedy: { duration_s: 10, occupies: ['channel:any', 'channel:any'] } },
      { 'channel:any': 1 },
    );
    expect(scheduleMakespan(['greedy'], data)).toBe(Number.POSITIVE_INFINITY);
  });

  it('defaults an undeclared resource to a single slot', () => {
    const data = graphWith({
      a: { duration_s: 10, occupies: ['fuel_line:main'] },
      b: { duration_s: 20, occupies: ['fuel_line:main'] },
    });
    expect(scheduleMakespan(['a', 'b'], data)).toBe(30);
  });
});

describe('the shipped graph', () => {
  const graph = causesData as unknown as GraphData;

  it('passes every rule', () => {
    const result = lintGraph(graph);
    expect(result.errors).toEqual([]);
  });

  it('reports a solution plan for every cause', () => {
    const result = lintGraph(graph);
    expect(result.report).toHaveLength(Object.keys(graph.causes).length);
  });

  it('pays a real penalty when a channel is taken away', () => {
    // The four channels are a constraint, not a label on a widget. They stopped
    // being pass-or-fail when the team queries were shortened; what they cost
    // now is time, which is the currency the escalation window is priced in.
    const plan = ['measure_diag_crosscheck', 'measure_diag_team_prop', 'measure_diag_team_avionics'];
    const withChannels = (count: number): number =>
      scheduleMakespan(plan, { ...graph, _resources: { ...graph._resources, 'channel:any': count } });

    expect(withChannels(3)).toBeGreaterThan(withChannels(4));
    expect(withChannels(5)).toBe(withChannels(4));
  });
});

describe('rule 6 — waiting must not beat paying', () => {
  const graph = causesData as unknown as GraphData;
  const globalDelayBand = anomalyData.symptomDelay_s;

  it('measures the free path against the bought one on the shipped graph', () => {
    const result = lintGraph(graph, { globalDelayBand });
    expect(result.warnings.filter((entry) => entry.startsWith('Rule 6'))).toEqual([]);
    // Every cause the readings can name on their own is accounted for, with
    // the margin spelled out — that is the number a tuning pass moves.
    expect(result.report.filter((entry) => entry.includes('paying wins by'))).toHaveLength(3);
  });

  it('fires again the moment the late reading is made early', () => {
    // The guard on the balance: this is exactly the edit that reopened the
    // hole, and it must not pass quietly.
    const early: GraphData = {
      ...graph,
      symptoms: {
        ...graph.symptoms,
        sym_telemetry_gaps: { ...graph.symptoms.sym_telemetry_gaps, delay_s: undefined },
      },
    };
    const warnings = lintGraph(early, { globalDelayBand }).warnings.filter((entry) =>
      entry.startsWith('Rule 6'),
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join(' ')).toContain('waiting beats paying');
  });

  it('falls back to bare uniqueness when it is given no band to measure with', () => {
    // A mod loader may not pass one. Saying less is right; saying nothing is not.
    const warnings = lintGraph(graph).warnings.filter((entry) => entry.startsWith('Rule 6'));
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join(' ')).toContain('Timing not checked');
  });

  it('agrees with the shift-to-zero the runtime does', () => {
    // Two symptoms drawn from the same band: the mean gap between the first
    // and the second is a third of the band's width. The linter walks
    // quantiles rather than sampling, so it should land on 40/3 within a
    // rounding error — if it does not, it is not modelling the runtime.
    const measured = meanFreeIdentification('cause_sensor_defective', {
      ...graph,
      symptoms: {
        ...graph.symptoms,
        sym_pressure_drop: { title: 'a' },
        sym_voltage_drop: { title: 'b' },
      },
    }, { min: 0, max: 40 });
    expect(measured).toBeGreaterThan(40 / 3 - 0.5);
    expect(measured).toBeLessThan(40 / 3 + 0.5);
  });
});
