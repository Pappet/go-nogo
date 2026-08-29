/**
 * CLAUDE.md's save/resume test, on the path a player actually uses.
 *
 * There was already one at the replay layer, and it passed while the console
 * was broken: it handed `play` the full configuration explicitly, so it never
 * asked the question the console gets wrong — *where do the configuration
 * inputs come from when the page has been reloaded and nothing is in memory?*
 *
 * They come from the save, and this test flies a vehicle that has been
 * configured away from the default so that getting them from anywhere else
 * shows up. Redundancy adds dry mass, which moves the ascent; QA moves every
 * reliability draw, which moves the anomalies. A resume that quietly rebuilt
 * the default vehicle would reproduce neither, and the last test here proves
 * that this test would catch it.
 */
import { describe, expect, it } from 'vitest';

import { createMissionConfig, dataVersion } from '../missionConfig.js';
import { play } from '../replay/playback.js';
import { GAME_VERSION, type Run } from '../replay/run.js';
import type { Command } from '../sim/engine.js';
import type { VehicleConfig } from '../economy/vehicle.js';

import {
  SAVE_SCHEMA_VERSION,
  type SavedGame,
  missionIsFlyable,
  parseSave,
  savedMissionInputs,
  serializeSave,
} from './campaignSave.js';

const SEED = 7_314;
const MISSION_KEY = 'doctrine_iron/mission-4';
const ARM_TICK = 120;
const IGNITION_TICK = ARM_TICK + 200;
/** CLAUDE.md: save at T+90 s. 20 ticks per second. */
const SAVE_TICK = IGNITION_TICK + 90 * 20;
const RUN_LENGTH_TICKS = 9_000;

const COMMANDS: Command[] = [
  { tick: 20, type: 'toggleChecklist', payload: { index: 0 } },
  { tick: 40, type: 'toggleChecklist', payload: { index: 1 } },
  { tick: 60, type: 'toggleChecklist', payload: { index: 2 } },
  { tick: 80, type: 'toggleChecklist', payload: { index: 3 } },
  { tick: 100, type: 'toggleChecklist', payload: { index: 4 } },
  { tick: ARM_TICK, type: 'arm', payload: null },
];

/**
 * A vehicle nobody would get by accident: two units on the propellant line,
 * three on the power bus, and QA bought on two more slots. The mass and the
 * draws are both away from the default, which is the entire point.
 */
const FLOWN_VEHICLE: VehicleConfig = {
  slots: [
    { slotId: 'slot_main_valve', partId: 'part_main_valve', qaLevel: 'qualification', units: 1 },
    { slotId: 'slot_feed_line', partId: 'part_feed_line', qaLevel: 'acceptance', units: 2 },
    { slotId: 'slot_pressure_sensor', partId: 'part_pressure_sensor', qaLevel: 'series', units: 1 },
    { slotId: 'slot_power_bus', partId: 'part_power_bus', qaLevel: 'series', units: 3 },
    { slotId: 'slot_telemetry_tx', partId: 'part_telemetry_tx', qaLevel: 'acceptance', units: 1 },
  ],
};

/** Payroll shortens a team query (§6.5), so the durations are off catalogue. */
const MEASURE_DURATIONS = { measure_diag_team_prop: 9 };
const TECH = { levels: { propulsion: 1 }, forks: {}, data: 3 };
const RESEARCH_DATA = 14;

const inputs = {
  seed: SEED,
  missionKey: MISSION_KEY,
  vehicle: FLOWN_VEHICLE,
  tech: TECH,
  measureDurations: MEASURE_DURATIONS,
  researchData: RESEARCH_DATA,
};

const flownConfig = createMissionConfig(inputs);

function saveAt(tick: number): SavedGame {
  const run: Run = {
    gameVersion: GAME_VERSION,
    dataVersion: dataVersion(),
    seed: SEED,
    configuration: { rocketName: flownConfig.rocket.name, missionKey: MISSION_KEY },
    commands: COMMANDS.filter((command) => command.tick <= tick),
    stateHashes: [],
  };

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    gameVersion: GAME_VERSION,
    dataVersion: dataVersion(),
    campaign: {
      state: {
        doctrineId: 'doctrine_iron',
        seed: SEED,
        capital: 50_000,
        reputation: { government: 0, commercial: 0, science: 0 },
        week: 4,
        missionsFlown: 3,
        vehicle: FLOWN_VEHICLE,
      },
      scenarioId: 'scenario_series_zero',
      vehicle: FLOWN_VEHICLE,
      contract: null,
      tech: TECH,
      staff: { hired: [] },
      finances: {
        weeksInDebt: 0,
        takeovers: 0,
        frozenBranchId: null,
        dictatedRemaining: 0,
        ended: false,
      },
      sandbox: { unlocked: false, active: false },
    },
    mission: {
      run,
      tick,
      vehicle: FLOWN_VEHICLE,
      tech: TECH,
      measureDurations: MEASURE_DURATIONS,
      researchData: RESEARCH_DATA,
      settled: false,
      tutorialId: null,
    },
  };
}

/** Exactly what the console does on load: read the text, rebuild from it. */
function resumedConfig(text: string) {
  const save = parseSave(text);
  expect(save).not.toBeNull();
  expect(missionIsFlyable(save!, GAME_VERSION, dataVersion())).toBe(true);
  return createMissionConfig(savedMissionInputs(save!.mission!));
}

describe('resuming a configured vehicle from storage', () => {
  it('rebuilds the mission the save was written for', () => {
    const config = resumedConfig(serializeSave(saveAt(SAVE_TICK)));

    // Mass first: redundancy rides on stage 1's dry mass (§4.2), and getting
    // it from the default vehicle is a silently different ascent.
    expect(config.rocket.stages[0].dryMass_kg).toBe(flownConfig.rocket.stages[0].dryMass_kg);
    expect(config.occurrenceByCause).toEqual(flownConfig.occurrenceByCause);
    expect(config.missionKey).toBe(MISSION_KEY);
    expect(config.seed).toBe(SEED);
    // The payroll's shortened team query survived (§6.5): 22 s off catalogue.
    expect(config.causeGraph.measure('measure_diag_team_prop').duration_s).toBe(9);
  });

  it('resumes to the same final state as an uninterrupted run', () => {
    const uninterrupted = play(flownConfig, COMMANDS, RUN_LENGTH_TICKS);

    const config = resumedConfig(serializeSave(saveAt(SAVE_TICK)));
    const restored = play(config, COMMANDS.filter((c) => c.tick <= SAVE_TICK), SAVE_TICK);
    expect(restored.finalTick).toBe(SAVE_TICK);

    const continued = play(config, COMMANDS, RUN_LENGTH_TICKS, restored.state);

    expect(continued.finalTick).toBe(uninterrupted.finalTick);
    expect(continued.finalHash).toBe(uninterrupted.finalHash);
  });

  it('saved mid-ascent, with a stage burning and a tank part drained', () => {
    const atSave = play(flownConfig, COMMANDS, SAVE_TICK);
    expect(atSave.state.flight.ignited).toBe(true);
    expect(atSave.state.flight.cutoff).toBe(false);
    expect(atSave.state.flight.propellantRemaining_kg).toBeLessThan(
      flownConfig.rocket.stages[0].propellantMass_kg,
    );
  });

  it('would have caught a resume that rebuilt the default vehicle', () => {
    // The regression this test exists for: a resume that knows the seed and
    // the mission key but not the configuration. It reproduces neither the
    // mass nor the anomalies, and it does it without any error to notice.
    const bare = createMissionConfig({ seed: SEED, missionKey: MISSION_KEY });

    expect(bare.rocket.stages[0].dryMass_kg).not.toBe(flownConfig.rocket.stages[0].dryMass_kg);
    expect(bare.occurrenceByCause).not.toEqual(flownConfig.occurrenceByCause);

    const wrong = play(bare, COMMANDS, RUN_LENGTH_TICKS);
    const right = play(flownConfig, COMMANDS, RUN_LENGTH_TICKS);
    expect(wrong.finalHash).not.toBe(right.finalHash);
  });
});
