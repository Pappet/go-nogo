/**
 * The countdown state machine.
 *
 * Two things are worth asserting beyond "it works": that the sequence cannot
 * be entered out of order (arming with a NO GO item, changing a switch during
 * the count), and that every milestone lands on the tick the physics produced
 * it rather than on a scheduled tick.
 */
import { describe, expect, it } from 'vitest';

import checklistData from '../data/checklist.json' with { type: 'json' };
import { createMissionConfig } from '../missionConfig.js';

import {
  COUNTDOWN_PHASES,
  type ChecklistDef,
  type CountdownPhase,
  type MissionState,
  allChecklistItemsGo,
  countdownDisplay_s,
  createMissionSimulation,
  createMissionState,
  phaseIndex,
} from './countdown.js';
import { Engine } from './engine.js';
import { missionTime_s } from './flight.js';

const checklist = checklistData as ChecklistDef;
/**
 * A mission with no anomalies. These tests are about the countdown machine,
 * and an unattended anomaly now cascades into a lost vehicle — which would
 * cut the ascent short and tell us nothing about the sequence.
 */
const config = createMissionConfig({ missionKey: 'mission-78' });

function createEngine(): Engine<MissionState> {
  return new Engine(createMissionSimulation(config), createMissionState(config));
}

function completeChecklist(engine: Engine<MissionState>): void {
  for (let index = 0; index < checklist.items.length; index++) {
    engine.submit('toggleChecklist', { index });
    engine.runTicks(1);
  }
}

/** Runs a whole nominal mission and returns the final state. */
function flyNominalMission(ticks = 12000): MissionState {
  const engine = createEngine();
  completeChecklist(engine);
  engine.submit('arm', null);
  engine.runTicks(ticks);
  return engine.state;
}

describe('hold', () => {
  it('starts in HOLD with every switch at NO GO', () => {
    const state = createMissionState(config);
    expect(state.phase).toBe('HOLD');
    expect(state.checklist).toHaveLength(checklist.items.length);
    expect(allChecklistItemsGo(state)).toBe(false);
  });

  it('toggles a switch both ways and logs each flip', () => {
    const engine = createEngine();
    engine.submit('toggleChecklist', { index: 2 });
    engine.runTicks(1);
    expect(engine.state.checklist[2]).toBe(true);

    engine.submit('toggleChecklist', { index: 2 });
    engine.runTicks(1);
    expect(engine.state.checklist[2]).toBe(false);
    expect(engine.state.events.filter((event) => event.type === 'CHECKLIST')).toHaveLength(2);
  });

  it('ignores a switch index that does not exist', () => {
    const engine = createEngine();
    engine.submit('toggleChecklist', { index: 99 });
    engine.submit('toggleChecklist', { index: -1 });
    engine.runTicks(2);
    expect(engine.state.checklist.some((item) => item)).toBe(false);
    expect(engine.state.events).toHaveLength(0);
  });

  it('refuses to arm while any item reads NO GO', () => {
    const engine = createEngine();
    for (let index = 0; index < checklist.items.length - 1; index++) {
      engine.submit('toggleChecklist', { index });
    }
    engine.runTicks(2);
    engine.submit('arm', null);
    engine.runTicks(1);

    expect(engine.state.phase).toBe('HOLD');
    expect(engine.state.ignitionTick).toBe(-1);
  });

  it('arms once every item reads GO', () => {
    const engine = createEngine();
    completeChecklist(engine);
    engine.submit('arm', null);
    engine.runTicks(1);
    expect(engine.state.phase).toBe('ARMED');
  });

  it('holds the clock at zero while holding', () => {
    expect(countdownDisplay_s(createMissionState(config))).toBe(0);
  });
});

describe('terminal count', () => {
  it('lights the engines exactly countdownSeconds after arming', () => {
    const engine = createEngine();
    completeChecklist(engine);
    const armTick = engine.tick;
    engine.submit('arm', null);

    // Arming lands at armTick, so the engines light on the tick exactly
    // countdownSeconds later — the tick before it must still be holding.
    const countTicks = checklist.countdownSeconds * 20;
    engine.runTo(armTick + countTicks);
    expect(engine.state.phase).toBe('ARMED');
    expect(engine.state.flight.ignited).toBe(false);

    engine.runTicks(1);
    expect(engine.state.phase).toBe('IGNITION');
    expect(engine.state.flight.ignited).toBe(true);
  });

  it('counts down through negative numbers and up after liftoff', () => {
    const engine = createEngine();
    completeChecklist(engine);
    engine.submit('arm', null);
    engine.runTicks(20); // one second into the count

    const duringCount = countdownDisplay_s(engine.state);
    expect(duringCount).toBeLessThan(0);
    expect(duringCount).toBeCloseTo(-(checklist.countdownSeconds - 1), 6);

    engine.runTicks(400);
    expect(countdownDisplay_s(engine.state)).toBeGreaterThan(0);
  });

  it('freezes the switches once the count is running', () => {
    // No changing your mind at T-2.
    const engine = createEngine();
    completeChecklist(engine);
    engine.submit('arm', null);
    engine.runTicks(10);

    engine.submit('toggleChecklist', { index: 0 });
    engine.runTicks(1);
    expect(engine.state.checklist[0]).toBe(true);
  });

  it('ignores a second arm command', () => {
    const engine = createEngine();
    completeChecklist(engine);
    engine.submit('arm', null);
    engine.runTicks(10);
    const ignitionTick = engine.state.ignitionTick;

    engine.submit('arm', null);
    engine.runTicks(1);
    expect(engine.state.ignitionTick).toBe(ignitionTick);
  });
});

describe('the full sequence', () => {
  const state = flyNominalMission();

  it('reaches ORBIT_CHECK', () => {
    expect(state.phase).toBe('ORBIT_CHECK');
  });

  it('passes through every phase in order, exactly once', () => {
    const milestones = state.events
      .filter((event) => COUNTDOWN_PHASES.includes(event.type as CountdownPhase))
      .map((event) => event.type);
    expect(milestones).toEqual([
      'ARMED',
      'IGNITION',
      'LIFTOFF',
      'MAX_Q',
      'MECO',
      'SEP',
      'ORBIT_CHECK',
    ]);
  });

  it('never moves a phase backwards', () => {
    let highest = -1;
    for (const event of state.events) {
      if (!COUNTDOWN_PHASES.includes(event.type as CountdownPhase)) continue;
      const index = phaseIndex(event.type as CountdownPhase);
      expect(index).toBeGreaterThan(highest);
      highest = index;
    }
    expect(highest).toBe(COUNTDOWN_PHASES.length - 1);
  });

  it('lands each milestone at a plausible mission time', () => {
    const at = (type: string): number =>
      state.events.find((event) => event.type === type)?.missionTime_s ?? -1;

    expect(at('LIFTOFF')).toBeLessThan(2);
    expect(at('MAX_Q')).toBeGreaterThan(40);
    expect(at('MAX_Q')).toBeLessThan(110);
    expect(at('MECO')).toBeGreaterThan(120);
    expect(at('MECO')).toBeLessThan(200);
    // Separation follows MECO by the coast the data specifies.
    expect(at('SEP') - at('MECO')).toBeCloseTo(config.rocket.stageSeparationDelay_s, 1);
    expect(at('ORBIT_CHECK')).toBeGreaterThan(at('SEP'));
  });

  it('reports max-Q with the peak the flight actually saw', () => {
    const maxQ = state.events.find((event) => event.type === 'MAX_Q');
    const peak_kPa = Math.round(state.flight.maxDynamicPressure_Pa / 1000);
    expect(maxQ?.message).toContain(`${peak_kPa} kPa`);
  });

  it('declares the orbit nominal and names it', () => {
    const check = state.events.find((event) => event.type === 'ORBIT_CHECK');
    expect(check?.message).toContain('NOMINAL');
    expect(check?.message).toMatch(/\d+ × \d+ km/);
  });

  it('keeps mission time running after the sequence completes', () => {
    expect(missionTime_s(state.flight)).toBeGreaterThan(500);
  });
});

describe('milestones follow the physics, not a schedule', () => {
  it('fires MAX_Q on the tick after the peak, not at a fixed time', () => {
    const state = flyNominalMission();
    const maxQEvent = state.events.find((event) => event.type === 'MAX_Q');
    expect(maxQEvent).toBeDefined();

    // Re-fly and stop one tick before the recorded event: the peak must not
    // have been announced yet, which is only true if the trigger is the
    // pressure curve rather than a timer.
    const engine = createEngine();
    completeChecklist(engine);
    engine.submit('arm', null);
    engine.runTo((maxQEvent?.tick ?? 0) - 1);
    expect(engine.state.phase).toBe('LIFTOFF');
  });

  it('does not announce MECO before the tanks are dry', () => {
    const engine = createEngine();
    completeChecklist(engine);
    engine.submit('arm', null);
    engine.runTicks(2000);
    expect(engine.state.flight.propellantRemaining_kg).toBeGreaterThan(0);
    expect(engine.state.events.some((event) => event.type === 'MECO')).toBe(false);
  });
});

describe('a mission is pinned by its seed and its key', () => {
  /**
   * §5.4's first retry path promises the identical run, and §8.2 rule 5
   * promises that a re-roll is surgical. Both rest on one property: the seed
   * and the mission key decide the crisis, and nothing else does.
   *
   * This is asserted at the mission level rather than at `planAnomalies`,
   * because that is the level Phase 2's configurator will rebuild. A test on
   * the helper would keep passing while the mission it feeds changed shape.
   */
  function flyBriefly(overrides: Parameters<typeof createMissionConfig>[0]): MissionState {
    const missionConfig = createMissionConfig(overrides);
    const engine = new Engine(
      createMissionSimulation(missionConfig),
      createMissionState(missionConfig),
    );
    for (let index = 0; index < checklist.items.length; index += 1) {
      engine.submit('toggleChecklist', { index });
    }
    engine.submit('arm', null);
    engine.runTicks(6000);
    return engine.state;
  }

  /** The anomalies a run produced, in the order the world announced them. */
  const crisisOf = (state: MissionState): string[] =>
    state.diagnosis.anomalies.anomalies.map(
      (anomaly) => `${anomaly.causeId}@${anomaly.onsetTick}`,
    );

  // A mission that actually has a crisis to replay. Since the hardware decides
  // occurrence, a good few mission keys fly quietly — which is the point of the
  // configurator, and useless for asserting that a crisis reproduces.
  const EVENTFUL = 'mission-6';

  it('replays the same crisis for the same seed and key', () => {
    const first = flyBriefly({ seed: 42, missionKey: EVENTFUL });
    const second = flyBriefly({ seed: 42, missionKey: EVENTFUL });
    expect(crisisOf(second)).toEqual(crisisOf(first));
    expect(crisisOf(first).length).toBeGreaterThan(0);
  });

  it('rolls a different crisis for a different key, and for a different seed', () => {
    const base = crisisOf(flyBriefly({ seed: 42, missionKey: EVENTFUL }));
    expect(crisisOf(flyBriefly({ seed: 42, missionKey: 'mission-7' }))).not.toEqual(base);
    expect(crisisOf(flyBriefly({ seed: 43, missionKey: EVENTFUL }))).not.toEqual(base);
  });
});
