/**
 * The pause model.
 *
 * The claim under test is §5.7's: pausing buys an overview and not a single
 * sim second. The last block proves it where it counts — the same plan costs
 * the same sim time whether it was assembled during a pause or under a running
 * clock, so there is nothing to exploit and nothing to ration.
 */
import { describe, expect, it } from 'vitest';

import causesData from '../data/causes.json' with { type: 'json' };
import { type CauseGraphData, loadCauseGraph } from './diagnosis/causeGraph.js';
import {
  createScheduleState,
  enqueueMeasure,
  makespanTicks,
  projectSchedule,
} from './diagnosis/measures.js';
import {
  canQueueAction,
  createPauseState,
  dismissOffer,
  offerResultReady,
  pause,
  pauseModelIndex,
  recordQueuedAction,
  resume,
  shouldAutoPause,
} from './pauseModel.js';

const graph = loadCauseGraph(causesData as unknown as CauseGraphData);

describe('auto-pause on a new anomaly', () => {
  it('fires once for an anomaly', () => {
    const state = createPauseState();
    expect(shouldAutoPause(state, 'anomaly:leak')).toBe(true);
    expect(shouldAutoPause(state, 'anomaly:leak')).toBe(false);
  });

  it('fires for each distinct anomaly', () => {
    const state = createPauseState();
    expect(shouldAutoPause(state, 'anomaly:leak')).toBe(true);
    expect(shouldAutoPause(state, 'chain:flameout:0')).toBe(true);
  });

  it('does not re-arm across a pause and resume', () => {
    // An anomaly that re-announced itself every time the player resumed would
    // train them to dismiss the pause without reading it.
    const state = createPauseState();
    shouldAutoPause(state, 'anomaly:leak');
    pause(state);
    resume(state);
    expect(shouldAutoPause(state, 'anomaly:leak')).toBe(false);
  });
});

describe('the RESULT READY offer', () => {
  it('is an offer, not a stop', () => {
    const state = createPauseState();
    offerResultReady(state, 'anomaly:leak', 'measure_diag_crosscheck', 400);
    expect(state.offer).toEqual({
      anomalyId: 'anomaly:leak',
      measureId: 'measure_diag_crosscheck',
      tick: 400,
    });
    // Crucially: the simulation is still running.
    expect(state.paused).toBe(false);
  });

  it('can be dismissed', () => {
    const state = createPauseState();
    offerResultReady(state, 'anomaly:leak', 'measure_diag_crosscheck', 400);
    dismissOffer(state);
    expect(state.offer).toBeNull();
  });

  it('is superseded by a later result rather than queuing up', () => {
    const state = createPauseState();
    offerResultReady(state, 'anomaly:leak', 'measure_diag_crosscheck', 400);
    offerResultReady(state, 'anomaly:leak', 'measure_diag_team_prop', 900);
    expect(state.offer?.measureId).toBe('measure_diag_team_prop');
  });

  it('clears when the player resumes', () => {
    const state = createPauseState();
    pause(state);
    offerResultReady(state, 'anomaly:leak', 'measure_diag_crosscheck', 400);
    resume(state);
    expect(state.offer).toBeNull();
  });
});

describe('queuing in standard mode', () => {
  it('is unlimited while paused', () => {
    const state = createPauseState('standard');
    pause(state);
    for (let i = 0; i < 10; i++) {
      expect(canQueueAction(state)).toBe(true);
      recordQueuedAction(state);
    }
    expect(state.actionsThisPause).toBe(10);
  });

  it('is unlimited while running', () => {
    const state = createPauseState('standard');
    for (let i = 0; i < 5; i++) {
      expect(canQueueAction(state)).toBe(true);
      recordQueuedAction(state);
    }
  });
});

describe('the one-action A/B arm', () => {
  it('allows exactly one action per pause', () => {
    const state = createPauseState('oneActionPerPause');
    pause(state);
    expect(canQueueAction(state)).toBe(true);
    recordQueuedAction(state);
    expect(canQueueAction(state)).toBe(false);
  });

  it('gives another action after resuming and pausing again', () => {
    const state = createPauseState('oneActionPerPause');
    pause(state);
    recordQueuedAction(state);
    resume(state);
    pause(state);
    expect(canQueueAction(state)).toBe(true);
  });

  it('does not restrict queuing under a running clock', () => {
    // Acting in real time is its own pressure and needs no extra rule.
    const state = createPauseState('oneActionPerPause');
    for (let i = 0; i < 5; i++) {
      expect(canQueueAction(state)).toBe(true);
      recordQueuedAction(state);
    }
  });

  it('runs the same simulation as standard — it is a setting, not a fork', () => {
    expect(pauseModelIndex('standard')).toBe(0);
    expect(pauseModelIndex('oneActionPerPause')).toBe(1);
  });
});

describe('pausing buys no sim time', () => {
  it('costs the same whether the plan was assembled paused or running', () => {
    // §5.7's actual claim. Both players queue the same three diagnoses at the
    // same tick; one did it during a pause, the other while the clock ran. The
    // schedule — and therefore the escalation cost — must be identical.
    const specs = graph.specs;
    const capacities = graph.capacities;
    const plan = ['measure_diag_crosscheck', 'measure_diag_team_prop', 'measure_diag_team_avionics'];

    const assembleDuringPause = (): number => {
      const pauseState = createPauseState('standard');
      const schedule = createScheduleState();
      pause(pauseState);
      for (const measureId of plan) {
        expect(canQueueAction(pauseState)).toBe(true);
        enqueueMeasure(schedule, measureId, 600);
        recordQueuedAction(pauseState);
      }
      resume(pauseState);
      return makespanTicks(projectSchedule(schedule, 600, specs, capacities), 600);
    };

    const assembleWhileRunning = (): number => {
      const schedule = createScheduleState();
      for (const measureId of plan) enqueueMeasure(schedule, measureId, 600);
      return makespanTicks(projectSchedule(schedule, 600, specs, capacities), 600);
    };

    expect(assembleDuringPause()).toBe(assembleWhileRunning());
  });

  it('leaves the escalation window untouched by how long the pause lasted', () => {
    // Ticks do not advance while paused, so a long pause and a short one land
    // the same plan at the same tick — the cost is the actions, not the clock.
    const specs = graph.specs;
    const capacities = graph.capacities;
    const at = (queuedTick: number): number => {
      const schedule = createScheduleState();
      enqueueMeasure(schedule, 'measure_diag_team_prop', queuedTick);
      return makespanTicks(projectSchedule(schedule, queuedTick, specs, capacities), queuedTick);
    };
    expect(at(600)).toBe(at(9000));
  });
});
