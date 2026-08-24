/**
 * Driving a run through the simulation and sampling its state hash.
 *
 * Playback never touches a clock: it advances the engine by ticks, so a replay
 * runs as fast as the machine allows and lands on exactly the same states as
 * the live session that produced it.
 */
import {
  type MissionConfigInput,
  type MissionState,
  createMissionSimulation,
  createMissionState,
} from '../sim/countdown.js';
import { Engine } from '../sim/engine.js';

import { hashMissionState } from './hash.js';
import { type Run, type StateHash, computeDataVersion, lastCommandTick } from './run.js';

/** Concept §8.2 rule 8: a hash every 600 ticks localises a desync to 30 s. */
export const HASH_INTERVAL_TICKS = 600;

export interface PlaybackResult {
  readonly state: MissionState;
  readonly hashes: readonly StateHash[];
  readonly finalHash: string;
  readonly finalTick: number;
}

/**
 * Runs `config` forward to `untilTick`, applying `commands` on the way and
 * sampling the state hash at every interval boundary.
 *
 * `startState` lets a resumed save carry on from where it stopped instead of
 * starting over.
 */
export function play(
  config: MissionConfigInput,
  commands: readonly { tick: number; type: string; payload: unknown }[],
  untilTick: number,
  startState?: MissionState,
): PlaybackResult {
  const state = startState ?? createMissionState(config);
  // A resumed state already carries the tick it is valid at; the engine has to
  // continue from there instead of counting from zero again.
  const engine = new Engine(createMissionSimulation(config), state, state.flight.tick);

  for (const command of commands) {
    if (command.tick >= state.flight.tick) engine.inject(command);
  }

  const hashes: StateHash[] = [];
  const sample = (): void => {
    if (engine.tick % HASH_INTERVAL_TICKS === 0) {
      hashes.push({ tick: engine.tick, sha256: hashMissionState(state) });
    }
  };

  sample();
  while (engine.tick < untilTick) {
    // Advance to the next hash boundary, or the end, whichever comes first.
    const boundary = Math.min(
      untilTick,
      engine.tick - (engine.tick % HASH_INTERVAL_TICKS) + HASH_INTERVAL_TICKS,
    );
    // coastTo evaluates analytically when it can and steps when it cannot; it
    // also stops early at a queued command, hence the loop.
    while (engine.tick < boundary) {
      engine.coastTo(boundary);
    }
    sample();
  }

  return {
    state,
    hashes,
    finalHash: hashMissionState(state),
    finalTick: engine.tick,
  };
}

/** Plays a stored run from tick 0. */
export function playRun(run: Run, config: MissionConfigInput, untilTick?: number): PlaybackResult {
  const target = untilTick ?? runLength(run);
  return play(config, run.commands, target);
}

/** How far a run was recorded: its last sampled hash, or its last command. */
export function runLength(run: Run): number {
  let last = lastCommandTick(run);
  for (const entry of run.stateHashes) {
    if (entry.tick > last) last = entry.tick;
  }
  return last;
}

export interface VerificationResult {
  readonly ok: boolean;
  /** Tick of the first hash that disagreed, or -1 when everything matched. */
  readonly firstMismatchTick: number;
  readonly checked: number;
}

/**
 * Replays a run and compares every sampled hash with the recorded one.
 *
 * Reporting the first disagreeing tick is the whole point of sampling: a
 * desync is localised to one 30-second window instead of "somewhere in the
 * flight" (concept §8.2 rule 8).
 */
export function verifyRun(run: Run, config: MissionConfigInput): VerificationResult {
  const expectedDataVersion = computeDataVersion(
    config.rocket,
    config.pitchProgram,
    config.checklist,
  );
  if (run.dataVersion !== expectedDataVersion) {
    return { ok: false, firstMismatchTick: 0, checked: 0 };
  }

  const result = playRun(run, config);
  const actual = new Map(result.hashes.map((entry) => [entry.tick, entry.sha256]));

  let checked = 0;
  for (const expected of run.stateHashes) {
    const got = actual.get(expected.tick);
    checked += 1;
    if (got !== expected.sha256) {
      return { ok: false, firstMismatchTick: expected.tick, checked };
    }
  }
  return { ok: true, firstMismatchTick: -1, checked };
}
