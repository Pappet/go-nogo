/**
 * The resource scheduler.
 *
 * The load-bearing test is the last one: the projection the command timeline
 * draws must agree with what actually happens. A preview that lies about
 * landing times would be worse than no preview, because the whole point of
 * §5.7 is that the player plans against it.
 */
import { describe, expect, it } from 'vitest';

import causesData from '../../data/causes.json' with { type: 'json' };
import { TICKS_PER_SECOND } from '../engine.js';

import {
  type MeasureSpec,
  type ResourceCapacities,
  type ScheduleState,
  advanceSchedule,
  createScheduleState,
  durationTicks,
  enqueueMeasure,
  makespanTicks,
  projectSchedule,
} from './measures.js';

const seconds = (value: number): number => Math.round(value * TICKS_PER_SECOND);

/** The two measures from the concept's own parallelism example (§5.2). */
const CROSS_CHECK: MeasureSpec = {
  id: 'crosscheck',
  duration_s: 10,
  occupies: ['channel:any'],
};
const ASK_TEAM: MeasureSpec = {
  id: 'team',
  duration_s: 45,
  occupies: ['engineer:prop'],
};
const TEST_PULSE: MeasureSpec = {
  id: 'pulse',
  duration_s: 20,
  occupies: ['channel:any'],
};

function specsOf(...measures: MeasureSpec[]): ReadonlyMap<string, MeasureSpec> {
  return new Map(measures.map((measure) => [measure.id, measure]));
}

/** Runs the schedule tick by tick and reports when each measure finished. */
function runToCompletion(
  state: ScheduleState,
  specs: ReadonlyMap<string, MeasureSpec>,
  capacities: ResourceCapacities,
  fromTick = 0,
  limit = 10000,
): Map<string, { start: number; end: number }> {
  const landings = new Map<string, { start: number; end: number }>();
  const starts = new Map<string, number>();

  for (let tick = fromTick; tick < fromTick + limit; tick++) {
    const before = new Set(state.running.map((active) => active.measureId));
    const finished = advanceSchedule(state, tick, specs, capacities);
    for (const active of state.running) {
      if (!before.has(active.measureId) && !starts.has(active.measureId)) {
        starts.set(active.measureId, active.startTick);
      }
    }
    for (const done of finished) {
      landings.set(done.measureId, {
        start: starts.get(done.measureId) ?? done.startTick,
        end: done.endTick,
      });
    }
    if (state.pending.length === 0 && state.running.length === 0) break;
  }
  return landings;
}

describe('a single measure', () => {
  it('runs for its declared duration', () => {
    const specs = specsOf(CROSS_CHECK);
    const state = createScheduleState();
    enqueueMeasure(state, 'crosscheck', 0);

    const landings = runToCompletion(state, specs, {});
    expect(landings.get('crosscheck')).toEqual({ start: 0, end: seconds(10) });
  });

  it('converts seconds to whole ticks', () => {
    expect(durationTicks(CROSS_CHECK)).toBe(200);
    expect(durationTicks(ASK_TEAM)).toBe(900);
  });

  it('cannot start before it was queued', () => {
    const specs = specsOf(CROSS_CHECK);
    const state = createScheduleState();
    enqueueMeasure(state, 'crosscheck', 100);

    advanceSchedule(state, 50, specs, {});
    expect(state.running).toHaveLength(0);
    advanceSchedule(state, 100, specs, {});
    expect(state.running).toHaveLength(1);
  });
});

describe('parallelism', () => {
  it('runs conflict-free measures at once — 45 s makespan, not 55', () => {
    // The concept's own example (§5.2), and the reason the resource model
    // exists at all: summing the durations would be the wrong arithmetic.
    const specs = specsOf(CROSS_CHECK, ASK_TEAM);
    const state = createScheduleState();
    enqueueMeasure(state, 'crosscheck', 0);
    enqueueMeasure(state, 'team', 0);

    const landings = runToCompletion(state, specs, {});
    expect(landings.get('crosscheck')?.start).toBe(0);
    expect(landings.get('team')?.start).toBe(0);

    const finish = Math.max(landings.get('crosscheck')!.end, landings.get('team')!.end);
    expect(finish).toBe(seconds(45));
    expect(finish).not.toBe(seconds(55));
  });

  it('serialises measures that want the same resource', () => {
    const specs = specsOf(CROSS_CHECK, TEST_PULSE);
    const state = createScheduleState();
    enqueueMeasure(state, 'crosscheck', 0);
    enqueueMeasure(state, 'pulse', 0);

    const landings = runToCompletion(state, specs, {});
    // One channel: the pulse waits for the cross-check to release it.
    expect(landings.get('crosscheck')?.start).toBe(0);
    expect(landings.get('pulse')?.start).toBe(seconds(10));
    expect(landings.get('pulse')?.end).toBe(seconds(30));
  });

  it('gives a contested resource to whoever queued first', () => {
    const specs = specsOf(CROSS_CHECK, TEST_PULSE);
    const state = createScheduleState();
    enqueueMeasure(state, 'pulse', 0);
    enqueueMeasure(state, 'crosscheck', 0);

    const landings = runToCompletion(state, specs, {});
    expect(landings.get('pulse')?.start).toBe(0);
    expect(landings.get('crosscheck')?.start).toBe(seconds(20));
  });

  it('does not let a blocked measure hold up a conflict-free one', () => {
    // This is the §5.7 timeline: the test pulse waits for a channel while the
    // team answer runs on regardless of being queued behind it.
    const specs = specsOf(CROSS_CHECK, TEST_PULSE, ASK_TEAM);
    const state = createScheduleState();
    enqueueMeasure(state, 'crosscheck', 0);
    enqueueMeasure(state, 'pulse', 0);
    enqueueMeasure(state, 'team', 0);

    const landings = runToCompletion(state, specs, {});
    expect(landings.get('crosscheck')?.end).toBe(seconds(10));
    expect(landings.get('pulse')?.start).toBe(seconds(10));
    expect(landings.get('team')?.start).toBe(0);
    expect(landings.get('team')?.end).toBe(seconds(45));
  });

  it('honours a capacity above one', () => {
    const specs = specsOf(CROSS_CHECK, TEST_PULSE);
    const state = createScheduleState();
    enqueueMeasure(state, 'crosscheck', 0);
    enqueueMeasure(state, 'pulse', 0);

    const landings = runToCompletion(state, specs, { 'channel:any': 2 });
    expect(landings.get('crosscheck')?.start).toBe(0);
    expect(landings.get('pulse')?.start).toBe(0);
  });
});

describe('the command timeline projection', () => {
  it('agrees with what actually happens', () => {
    // If these ever disagree, the preview is lying to the player about the one
    // thing it exists to show.
    const specs = specsOf(CROSS_CHECK, TEST_PULSE, ASK_TEAM);

    const projected = createScheduleState();
    enqueueMeasure(projected, 'crosscheck', 0);
    enqueueMeasure(projected, 'pulse', 0);
    enqueueMeasure(projected, 'team', 0);
    const projection = projectSchedule(projected, 0, specs, {});

    const actual = createScheduleState();
    enqueueMeasure(actual, 'crosscheck', 0);
    enqueueMeasure(actual, 'pulse', 0);
    enqueueMeasure(actual, 'team', 0);
    const landings = runToCompletion(actual, specs, {});

    for (const entry of projection) {
      expect(`${entry.measureId} ${entry.startTick}..${entry.endTick}`).toBe(
        `${entry.measureId} ${landings.get(entry.measureId)?.start}..${landings.get(entry.measureId)?.end}`,
      );
    }
    expect(projection).toHaveLength(3);
  });

  it('marks the measures that are still waiting for a resource', () => {
    const specs = specsOf(CROSS_CHECK, TEST_PULSE);
    const state = createScheduleState();
    enqueueMeasure(state, 'crosscheck', 0);
    enqueueMeasure(state, 'pulse', 0);

    const projection = projectSchedule(state, 0, specs, {});
    expect(projection[0]).toMatchObject({ measureId: 'crosscheck', waiting: false });
    expect(projection[1]).toMatchObject({ measureId: 'pulse', waiting: true });
  });

  it('reports the makespan the escalation window has to accommodate', () => {
    const specs = specsOf(CROSS_CHECK, ASK_TEAM);
    const state = createScheduleState();
    enqueueMeasure(state, 'crosscheck', 0);
    enqueueMeasure(state, 'team', 0);

    const projection = projectSchedule(state, 0, specs, {});
    expect(makespanTicks(projection, 0)).toBe(seconds(45));
  });

  it('projects from mid-flight, with measures already running', () => {
    const specs = specsOf(CROSS_CHECK, TEST_PULSE);
    const state = createScheduleState();
    enqueueMeasure(state, 'crosscheck', 0);
    advanceSchedule(state, 0, specs, {});
    expect(state.running).toHaveLength(1);

    // Queued five seconds in, with the channel already busy until +10 s.
    enqueueMeasure(state, 'pulse', seconds(5));
    const projection = projectSchedule(state, seconds(5), specs, {});
    const pulse = projection.find((entry) => entry.measureId === 'pulse');
    expect(pulse?.startTick).toBe(seconds(10));
    expect(pulse?.waiting).toBe(true);
  });

  it('leaves the live state untouched', () => {
    const specs = specsOf(CROSS_CHECK, TEST_PULSE);
    const state = createScheduleState();
    enqueueMeasure(state, 'crosscheck', 0);
    enqueueMeasure(state, 'pulse', 0);

    projectSchedule(state, 0, specs, {});
    expect(state.running).toHaveLength(0);
    expect(state.pending).toHaveLength(2);
  });
});

describe('determinism', () => {
  it('produces the same schedule from the same queue every time', () => {
    const specs = specsOf(CROSS_CHECK, TEST_PULSE, ASK_TEAM);
    const render = (): string => {
      const state = createScheduleState();
      enqueueMeasure(state, 'team', 0);
      enqueueMeasure(state, 'crosscheck', 0);
      enqueueMeasure(state, 'pulse', 0);
      return projectSchedule(state, 0, specs, {})
        .map((entry) => `${entry.measureId}@${entry.startTick}-${entry.endTick}`)
        .join('|');
    };
    expect(render()).toBe(render());
  });

  it('ignores an unknown measure rather than stalling the queue', () => {
    const specs = specsOf(CROSS_CHECK);
    const state = createScheduleState();
    enqueueMeasure(state, 'does-not-exist', 0);
    enqueueMeasure(state, 'crosscheck', 0);

    const landings = runToCompletion(state, specs, {});
    expect(landings.get('crosscheck')?.start).toBe(0);
  });
});

describe('against the shipped cause graph', () => {
  const graph = causesData as {
    measures: Record<string, { duration_s: number; occupies: string[]; type: string }>;
    _resources?: Record<string, number>;
  };

  const specs: ReadonlyMap<string, MeasureSpec> = new Map(
    Object.entries(graph.measures).map(([id, measure]) => [
      id,
      { id, duration_s: measure.duration_s, occupies: measure.occupies },
    ]),
  );
  const capacities = graph._resources ?? {};

  it('reproduces the parallel diagnosis plan the linter reports', () => {
    // The linter says cause_prop_leak needs all three diagnoses and lands at a
    // 45 s makespan. Executing them here must agree, or tool and runtime are
    // telling the player two different stories.
    const state = createScheduleState();
    enqueueMeasure(state, 'measure_diag_crosscheck', 0);
    enqueueMeasure(state, 'measure_diag_team_prop', 0);
    enqueueMeasure(state, 'measure_diag_team_avionics', 0);

    const projection = projectSchedule(state, 0, specs, capacities);
    expect(makespanTicks(projection, 0)).toBe(seconds(45));
  });

  it('needs every one of the four channels, and gains nothing from a fifth', () => {
    // The channel matrix is load-bearing, not decoration: take a channel away
    // and the hardest cause stops fitting its window; add one and nothing
    // improves. A graph edit that breaks either half of that breaks this test.
    const fullDiagnosis = () => {
      const fresh = createScheduleState();
      enqueueMeasure(fresh, 'measure_diag_crosscheck', 0);
      enqueueMeasure(fresh, 'measure_diag_team_prop', 0);
      enqueueMeasure(fresh, 'measure_diag_team_avionics', 0);
      return fresh;
    };
    const makespanWith = (channels: number): number =>
      makespanTicks(
        projectSchedule(fullDiagnosis(), 0, specs, { ...capacities, 'channel:any': channels }),
        0,
      );

    expect(makespanWith(4)).toBe(seconds(45));
    expect(makespanWith(3)).toBeGreaterThan(seconds(45));
    expect(makespanWith(5)).toBe(makespanWith(4));
  });

  it('saturates the bandwidth while all three diagnoses run', () => {
    // Two channels for the raw-telemetry cross-check plus one per team loop is
    // exactly four — the player can see the matrix full.
    const state = createScheduleState();
    for (const id of [
      'measure_diag_crosscheck',
      'measure_diag_team_prop',
      'measure_diag_team_avionics',
    ]) {
      enqueueMeasure(state, id, 0);
    }
    advanceSchedule(state, 0, specs, capacities);
    expect(state.running).toHaveLength(3);

    const channelsInUse = state.running
      .flatMap((active) => specs.get(active.measureId)?.occupies ?? [])
      .filter((resource) => resource === 'channel:any').length;
    expect(channelsInUse).toBe(4);
    expect(channelsInUse).toBe(capacities['channel:any']);
  });

  it('makes a fourth action wait until the cross-check releases its bandwidth', () => {
    // "Information costs bandwidth": you cannot act while you are still
    // measuring everything.
    const state = createScheduleState();
    for (const id of [
      'measure_diag_crosscheck',
      'measure_diag_team_prop',
      'measure_diag_team_avionics',
      'measure_iso_valve',
    ]) {
      enqueueMeasure(state, id, 0);
    }
    const projection = projectSchedule(state, 0, specs, capacities);
    const valve = projection.find((entry) => entry.measureId === 'measure_iso_valve');
    expect(valve?.startTick).toBe(seconds(10));
    expect(valve?.waiting).toBe(true);
  });
});
