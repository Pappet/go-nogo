/**
 * The run format (concept §8.2 rule 3) and the save that falls out of it.
 *
 * A run is not a recording of what happened — it is the *inputs* that made it
 * happen: seed, configuration and tick-stamped commands. Replaying them
 * reproduces the session exactly, which is why a mid-mission save is just a
 * run truncated at a tick (rule 9) rather than a system of its own.
 */
import type { Command } from '../sim/engine.js';
import type { ChecklistDef } from '../sim/countdown.js';
import type { PitchProgram } from '../sim/physics/ascentProgram.js';
import type { RocketDef } from '../sim/physics/thrust.js';

import { CanonicalWriter } from './hash.js';
import { sha256 } from './sha256.js';

/** Bumped by hand when the simulation changes in a way that moves hashes. */
export const GAME_VERSION = '0.1.0';

export interface StateHash {
  readonly tick: number;
  readonly sha256: string;
}

/**
 * Phase 1 flies one hard-wired vehicle, so the configuration names it — plus
 * the mission key, which decides every anomaly draw (§8.2 rule 5). Without the
 * key the same seed replays a different crisis, so it belongs in the run.
 */
export interface MissionConfig {
  readonly rocketName: string;
  readonly missionKey: string;
}

export interface Run {
  readonly gameVersion: string;
  /** Hash over the data files the run was flown against. */
  readonly dataVersion: string;
  readonly seed: number;
  readonly configuration: MissionConfig;
  readonly commands: readonly Command[];
  readonly stateHashes: readonly StateHash[];
}

/**
 * Hash over the tuning data, in a fixed field order.
 *
 * A run pins this: replaying against different numbers would silently produce
 * a different flight, so the mismatch is caught instead (concept §8.2 rule 7).
 * The fields are walked explicitly rather than via `JSON.stringify`, for the
 * same reason the state hash is.
 */
export function computeDataVersion(
  rocket: RocketDef,
  pitchProgram: PitchProgram,
  checklist: ChecklistDef,
): string {
  const writer = new CanonicalWriter();

  writer.string(rocket.name);
  writer.float64(rocket.payloadMass_kg, 'payloadMass_kg');
  writer.float64(rocket.referenceArea_m2, 'referenceArea_m2');
  writer.float64(rocket.dragCoefficient, 'dragCoefficient');
  writer.float64(rocket.maxDynamicPressure_Pa, 'maxDynamicPressure_Pa');
  writer.float64(rocket.stageSeparationDelay_s, 'stageSeparationDelay_s');
  writer.float64(rocket.targetOrbit.periapsisAltitude_m, 'targetOrbit.periapsisAltitude_m');
  writer.float64(rocket.targetOrbit.apoapsisAltitude_m, 'targetOrbit.apoapsisAltitude_m');

  writer.int32(rocket.stages.length, 'stages.length');
  for (const stage of rocket.stages) {
    writer.string(stage.name);
    writer.float64(stage.dryMass_kg, 'dryMass_kg');
    writer.float64(stage.propellantMass_kg, 'propellantMass_kg');
    writer.float64(stage.thrustSeaLevel_N, 'thrustSeaLevel_N');
    writer.float64(stage.thrustVacuum_N, 'thrustVacuum_N');
    writer.float64(stage.ispSeaLevel_s, 'ispSeaLevel_s');
    writer.float64(stage.ispVacuum_s, 'ispVacuum_s');
  }

  writer.int32(pitchProgram.nodes.length, 'nodes.length');
  for (const node of pitchProgram.nodes) {
    writer.float64(node.time_s, 'time_s');
    writer.float64(node.pitch_deg, 'pitch_deg');
  }

  // The checklist is data too: its length gates arming and its countdown sets
  // the terminal count, so both change how a run unfolds.
  writer.int32(checklist.items.length, 'checklist.items.length');
  writer.float64(checklist.countdownSeconds, 'countdownSeconds');

  return sha256(writer.toBytes());
}

/**
 * Truncates a run at `tick`: the mid-mission save.
 *
 * Commands after the cut are dropped, and so are the state hashes — resuming
 * re-derives them. Nothing else is stored, because nothing else is needed.
 */
export function sliceRun(run: Run, tick: number): Run {
  return {
    ...run,
    commands: run.commands.filter((command) => command.tick <= tick),
    stateHashes: run.stateHashes.filter((entry) => entry.tick <= tick),
  };
}

/** The last tick any command in the run is stamped at. */
export function lastCommandTick(run: Run): number {
  let last = 0;
  for (const command of run.commands) {
    if (command.tick > last) last = command.tick;
  }
  return last;
}

export function serializeRun(run: Run): string {
  // JSON is fine for the file on disk — it is the *hash* that must never go
  // through it. The hashes inside were computed from canonical bytes.
  return JSON.stringify(run, null, 2);
}

export function deserializeRun(text: string): Run {
  return JSON.parse(text) as Run;
}
