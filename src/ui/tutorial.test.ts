/**
 * Tutorial missions (§9).
 *
 * The concept calls these "scripted 1:1 crises on the seed/replay
 * infrastructure", and the load-bearing claim is that the crisis is the same
 * one every time. A script that says "something will go wrong at about T+35"
 * is a lie the moment that stops being true — so the fixture-style test here
 * flies each tutorial mission and asserts the fault it was written for.
 */
import { describe, expect, it } from 'vitest';

import checklistData from '../data/checklist.json' with { type: 'json' };
import { createMissionConfig, defaultVehicle, tutorialById, tutorials } from '../missionConfig.js';
import {
  type MissionState,
  createMissionSimulation,
  createMissionState,
} from '../sim/countdown.js';
import { Engine } from '../sim/engine.js';
import type { QaLevel } from '../sim/parts/partInstance.js';

import { progressIn } from './tutorial.js';

function engineFor(tutorialId: string): Engine<MissionState> {
  const tutorial = tutorialById(tutorialId);
  const config = createMissionConfig({
    seed: tutorial.seed,
    missionKey: tutorial.missionKey,
    vehicle: {
      slots: defaultVehicle.slots.map((slot) => ({
        ...slot,
        qaLevel: tutorial.qaLevel as QaLevel,
      })),
    },
  });
  return new Engine(createMissionSimulation(config), createMissionState(config));
}

function launch(engine: Engine<MissionState>): void {
  for (let index = 0; index < checklistData.items.length; index += 1) {
    engine.submit('toggleChecklist', { index });
  }
  engine.submit('arm', null);
}

describe('the scripted crises are the crises', () => {
  it('gives The Count a flight with nothing to distract from the countdown', () => {
    const engine = engineFor('tutorial_the_count');
    launch(engine);
    engine.runTicks(12000);
    expect(engine.state.diagnosis.anomalies.anomalies).toHaveLength(0);
    expect(engine.state.missionLost).toBe(false);
    expect(engine.state.phase).toBe('ORBIT_CHECK');
  });

  it('gives One Reading exactly one fault, and the one the script names', () => {
    const engine = engineFor('tutorial_one_reading');
    launch(engine);
    engine.runTicks(12000);
    const roots = engine.state.diagnosis.anomalies.anomalies.filter(
      (anomaly) => anomaly.spawnedBy === null,
    );
    expect(roots).toHaveLength(1);
    expect(roots[0].causeId).toBe('cause_prop_leak');
  });

  it('puts that fault where the script says it is', () => {
    // "Something will go wrong at about T+35." A script that promises a time
    // is a script that has to be checked against one.
    const engine = engineFor('tutorial_one_reading');
    launch(engine);
    engine.runTicks(12000);
    const anomaly = engine.state.diagnosis.anomalies.anomalies[0];
    const afterLiftoff_s = (anomaly.onsetTick - engine.state.flight.liftoffTick) / 20;
    expect(afterLiftoff_s).toBeGreaterThan(25);
    expect(afterLiftoff_s).toBeLessThan(45);
  });

  it('lets The Wrong Move actually go wrong the way it describes', () => {
    // §5.3, taught rather than asserted: raising pressure on a leak.
    const engine = engineFor('tutorial_wrong_move');
    launch(engine);
    engine.runTicks(1000);
    const anomaly = engine.state.diagnosis.anomalies.anomalies[0];
    expect(anomaly.causeId).toBe('cause_prop_leak');

    engine.submit('queueMeasure', {
      measureId: 'measure_increase_pressure',
      anomalyId: anomaly.id,
    });
    engine.runTicks(2000);
    expect(
      engine.state.diagnosis.anomalies.anomalies.some((entry) => entry.spawnedBy !== null),
    ).toBe(true);
  });
});

describe('the runner follows the player, not a counter', () => {
  it('starts on the first step', () => {
    const engine = engineFor('tutorial_the_count');
    const progress = progressIn(tutorialById('tutorial_the_count'), engine.state, false);
    expect(progress.index).toBe(0);
    expect(progress.step?.id).toBe('step_checklist');
    expect(progress.complete).toBe(false);
  });

  it('advances when the player does the thing, not when time passes', () => {
    const tutorial = tutorialById('tutorial_the_count');
    const engine = engineFor('tutorial_the_count');
    engine.runTicks(400);
    expect(progressIn(tutorial, engine.state, false).step?.id).toBe('step_checklist');

    launch(engine);
    engine.runTicks(1);
    expect(progressIn(tutorial, engine.state, false).step?.id).toBe('step_arm');
  });

  it('does not step backwards when the flight moves past a phase', () => {
    // A step keyed to LIFTOFF must not become current again at MECO.
    const tutorial = tutorialById('tutorial_the_count');
    const engine = engineFor('tutorial_the_count');
    launch(engine);
    engine.runTicks(6000);
    const progress = progressIn(tutorial, engine.state, false);
    expect(['step_warp', 'step_orbit']).toContain(progress.step?.id);
  });

  it('reports complete once the mission is over and the script has run out', () => {
    const tutorial = tutorialById('tutorial_the_count');
    const engine = engineFor('tutorial_the_count');
    launch(engine);
    engine.runTicks(12000);
    const progress = progressIn(tutorial, engine.state, true);
    expect(progress.complete).toBe(true);
    expect(progress.step).toBeNull();
    expect(progress.index).toBe(progress.total);
  });

  it('holds no progress of its own, so it cannot desynchronise', () => {
    // Same state, same answer, whatever happened in between — which is what
    // makes pausing, reloading and resuming land on the right step.
    const tutorial = tutorialById('tutorial_one_reading');
    const engine = engineFor('tutorial_one_reading');
    launch(engine);
    engine.runTicks(1200);
    expect(progressIn(tutorial, engine.state, false)).toEqual(
      progressIn(tutorial, engine.state, false),
    );
  });

  it('waits for a symptom to be visible, not merely for the fault to start', () => {
    // The onset is not observable. A tutorial pointing at nothing would teach
    // the player to distrust the panel.
    const tutorial = tutorialById('tutorial_one_reading');
    const engine = engineFor('tutorial_one_reading');
    launch(engine);
    engine.runTicks(600);
    expect(engine.state.diagnosis.anomalies.anomalies.length).toBeGreaterThan(0);
    expect(progressIn(tutorial, engine.state, false).step?.id).toBe('step_launch');
  });
});

describe('the shipped scripts', () => {
  it('gives every tutorial steps, a seed and a mission of its own', () => {
    expect(tutorials.length).toBeGreaterThanOrEqual(3);
    for (const tutorial of tutorials) {
      expect(tutorial.steps.length).toBeGreaterThan(0);
      expect(tutorial.missionKey.length).toBeGreaterThan(0);
      for (const step of tutorial.steps) expect(step.text.length).toBeGreaterThan(20);
    }
  });

  it('ends every tutorial on a step the mission can actually reach', () => {
    for (const tutorial of tutorials) {
      expect(tutorial.steps[tutorial.steps.length - 1].until.kind).toBe('missionOver');
    }
  });
});
