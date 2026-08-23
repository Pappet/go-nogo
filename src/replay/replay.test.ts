/**
 * The three determinism tests CLAUDE.md requires.
 *
 * They are the reason the whole engine is shaped the way it is: no clock in
 * the simulation, tick-stamped commands, canonical binary hashing. If any of
 * them fails, a replay no longer reproduces the session it recorded.
 *
 * The reference run is checked in at fixtures/seed42.json. Regenerate it
 * deliberately — `REGENERATE_FIXTURES=1 npm test` — and justify the change in
 * the commit, as CLAUDE.md requires: a moved hash means the simulation now
 * computes something different.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import pitchData from '../data/pitchProgram.json' with { type: 'json' };
import rocketData from '../data/rocket.json' with { type: 'json' };
import type { Command } from '../sim/engine.js';
import { createFlightState } from '../sim/flight.js';
import type { PitchProgram } from '../sim/physics/ascentProgram.js';
import type { RocketDef } from '../sim/physics/thrust.js';

import { HASH_INTERVAL_TICKS, play, playRun, verifyRun } from './playback.js';
import {
  GAME_VERSION,
  type Run,
  computeDataVersion,
  deserializeRun,
  serializeRun,
  sliceRun,
} from './run.js';

const config = {
  rocket: rocketData as RocketDef,
  pitchProgram: pitchData as PitchProgram,
};

/** Seed 42 and a fixed command log, exactly as CLAUDE.md specifies. */
const SEED = 42;
const IGNITION_TICK = 100;
const RUN_LENGTH_TICKS = 12000; // 10 minutes: ascent, cutoff and a long coast.
const COMMANDS: Command[] = [{ tick: IGNITION_TICK, type: 'ignite', payload: null }];

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'seed42.json');

function recordRun(): Run {
  const result = play(config, COMMANDS, RUN_LENGTH_TICKS);
  return {
    gameVersion: GAME_VERSION,
    dataVersion: computeDataVersion(config.rocket, config.pitchProgram),
    seed: SEED,
    configuration: { rocketName: config.rocket.name },
    commands: COMMANDS,
    stateHashes: result.hashes,
  };
}

if (process.env.REGENERATE_FIXTURES === '1') {
  writeFileSync(FIXTURE_PATH, `${serializeRun(recordRun())}\n`);
}

describe('replay fixture (seed 42)', () => {
  it('has a checked-in reference to compare against', () => {
    expect(existsSync(FIXTURE_PATH)).toBe(true);
  });

  const fixture = deserializeRun(readFileSync(FIXTURE_PATH, 'utf-8'));

  it('was flown against the current data files', () => {
    // A change to rocket.json or pitchProgram.json invalidates the run before
    // a single tick is simulated (concept §8.2 rule 7).
    expect(fixture.dataVersion).toBe(computeDataVersion(config.rocket, config.pitchProgram));
    expect(fixture.gameVersion).toBe(GAME_VERSION);
  });

  it('reproduces every recorded state hash', () => {
    const result = verifyRun(fixture, config);
    expect(result.firstMismatchTick).toBe(-1);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(RUN_LENGTH_TICKS / HASH_INTERVAL_TICKS + 1);
  });

  it('reproduces the final state hash', () => {
    const result = playRun(fixture, config, RUN_LENGTH_TICKS);
    const recorded = fixture.stateHashes[fixture.stateHashes.length - 1];
    expect(`${result.finalTick}:${result.finalHash}`).toBe(`${recorded.tick}:${recorded.sha256}`);
  });

  it('reaches orbit — the run is a real flight, not an empty one', () => {
    const result = playRun(fixture, config, RUN_LENGTH_TICKS);
    expect(result.state.ignited).toBe(true);
    expect(result.state.separated).toBe(true);
    expect(result.state.cutoff).toBe(true);
  });

  it('detects a tampered hash and localises it to its 30-second window', () => {
    const tampered: Run = {
      ...fixture,
      stateHashes: fixture.stateHashes.map((entry, index) =>
        index === 4 ? { ...entry, sha256: 'deadbeef' } : entry,
      ),
    };
    const result = verifyRun(tampered, config);
    expect(result.ok).toBe(false);
    expect(result.firstMismatchTick).toBe(fixture.stateHashes[4].tick);
  });

  it('rejects a run flown against different data', () => {
    const otherData: Run = { ...fixture, dataVersion: 'f'.repeat(64) };
    expect(verifyRun(otherData, config).ok).toBe(false);
  });
});

describe('save and resume', () => {
  // CLAUDE.md: save at T+90 s, resume, keep running — the final hash must match
  // the run that was never interrupted.
  const SAVE_TICK = IGNITION_TICK + 90 * 20; // T+90 s at 20 ticks per second.

  it('resumes to the same final state as an uninterrupted run', () => {
    const uninterrupted = play(config, COMMANDS, RUN_LENGTH_TICKS);

    const full = recordRun();
    const saved = sliceRun(full, SAVE_TICK);

    // Resuming is replaying the prefix (concept §8.2 rule 9): the save stores
    // inputs, not a snapshot of the world.
    const restored = play(config, saved.commands, SAVE_TICK);
    expect(restored.finalTick).toBe(SAVE_TICK);

    const continued = play(config, full.commands, RUN_LENGTH_TICKS, restored.state);

    expect(continued.finalTick).toBe(uninterrupted.finalTick);
    expect(continued.finalHash).toBe(uninterrupted.finalHash);
  });

  it('saves mid-ascent, while the vehicle is still under thrust', () => {
    // A save during coast would be the easy case; this one has to reproduce a
    // burning stage with a partially drained tank.
    const atSave = play(config, COMMANDS, SAVE_TICK);
    expect(atSave.state.ignited).toBe(true);
    expect(atSave.state.cutoff).toBe(false);
    expect(atSave.state.propellantRemaining_kg).toBeGreaterThan(0);
    expect(atSave.state.propellantRemaining_kg).toBeLessThan(
      config.rocket.stages[0].propellantMass_kg,
    );
  });

  it('keeps only the commands up to the save point', () => {
    const full = recordRun();
    const saved = sliceRun(full, IGNITION_TICK - 1);
    expect(saved.commands).toHaveLength(0);
    const late = sliceRun(full, RUN_LENGTH_TICKS);
    expect(late.commands).toHaveLength(COMMANDS.length);
  });
});

describe('double playback', () => {
  it('produces an identical hash series both times', () => {
    const first = play(config, COMMANDS, RUN_LENGTH_TICKS);
    const second = play(config, COMMANDS, RUN_LENGTH_TICKS);

    expect(second.hashes.map((entry) => `${entry.tick}:${entry.sha256}`)).toEqual(
      first.hashes.map((entry) => `${entry.tick}:${entry.sha256}`),
    );
    expect(second.finalHash).toBe(first.finalHash);
  });

  it('samples every 600 ticks, as the desync detector expects', () => {
    const result = play(config, COMMANDS, RUN_LENGTH_TICKS);
    const ticks = result.hashes.map((entry) => entry.tick);
    expect(ticks[0]).toBe(0);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i] - ticks[i - 1]).toBe(HASH_INTERVAL_TICKS);
    }
  });

  it('is unaffected by a fresh state object', () => {
    // Guards against state leaking through module scope between runs.
    const first = play(config, COMMANDS, 3000, createFlightState());
    const second = play(config, COMMANDS, 3000, createFlightState());
    expect(second.finalHash).toBe(first.finalHash);
  });
});
