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
import type { CauseGraphData } from '../sim/diagnosis/causeGraph.js';
import type { PriorSettings } from '../sim/diagnosis/priors.js';
import type { PartDef, QaLevel, QaLevelTable } from '../sim/parts/partInstance.js';
import type { PitchProgram } from '../sim/physics/ascentProgram.js';
import type { RocketDef } from '../sim/physics/thrust.js';
import type { AnomalySettings } from '../sim/systems/anomaly.js';
import type { CommsData } from '../sim/systems/comms.js';

import { CanonicalWriter } from './hash.js';
import { sha256 } from './sha256.js';

/** Bumped by hand when the simulation changes in a way that moves hashes. */
export const GAME_VERSION = '0.1.0';

export interface StateHash {
  readonly tick: number;
  readonly sha256: string;
}

/**
 * What a run needs to name the flight it recorded.
 *
 * The mission key decides every anomaly draw (§8.2 rule 5) — without it the
 * same seed replays a different crisis — and the rocket name says which
 * launcher the log belongs to. What is deliberately *not* here is the
 * configuration behind that launcher: QA levels, redundancy, research and
 * payroll are campaign decisions, and they are stored beside the run in the
 * campaign save (`src/save/`) rather than inside it, so this layer keeps
 * knowing nothing about an economy.
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
 * The data files a mission is flown against.
 *
 * Phase 0 pinned three of them, because three were all a flight depended on.
 * By Phase 2 that is no longer true: the parts catalogue sets every
 * reliability draw, the cause graph decides which crisis a mission has and how
 * long its measures take, the exposure table weights them, and the ground
 * stations decide what the vehicle can say. A save resumed across a change to
 * any of these resumes into a different mission while claiming to be the same
 * one — which is exactly what the data version exists to prevent.
 *
 * `rocket` is the *shipped* launcher, not the one a configuration produced:
 * redundancy mass is a decision the player made, and a decision belongs in the
 * save next to the vehicle that carries it, not in the hash over the data.
 *
 * `exposure` is spelled out structurally rather than imported as
 * `PhaseExposure`: the risk budget lives in `src/economy`, and the replay layer
 * has no business depending on the between-missions layer to hash two numbers
 * it was handed.
 */
export interface MissionDataFiles {
  readonly rocket: RocketDef;
  readonly pitchProgram: PitchProgram;
  readonly checklist: ChecklistDef;
  readonly qaLevels: QaLevelTable;
  readonly parts: readonly PartDef[];
  readonly causes: CauseGraphData;
  readonly anomalies: AnomalySettings;
  readonly priors: PriorSettings;
  readonly exposure: {
    readonly bySystem: Readonly<Record<string, number>>;
    readonly referenceDuration_s: number;
  };
  readonly comms: CommsData;
}

/** Record keys in a fixed order, so a reordered JSON file hashes the same. */
function sortedKeys(record: Readonly<Record<string, unknown>>): readonly string[] {
  return Object.keys(record).sort();
}

/** Ids in a fixed order, for the data files that are arrays rather than maps. */
function byId<T extends { readonly id: string }>(entries: readonly T[]): readonly T[] {
  return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Absence is its own value.
 *
 * A cause with no `escalation_s` falls back to the graph's default, so "absent"
 * and "set to the default" are the same flight but different data — and a
 * sentinel would make them the same hash. The flag says which one it was.
 */
function optionalFloat(writer: CanonicalWriter, value: number | undefined, field: string): void {
  writer.boolean(value !== undefined);
  if (value !== undefined) writer.float64(value, field);
}

function optionalString(writer: CanonicalWriter, value: string | undefined): void {
  writer.boolean(value !== undefined);
  if (value !== undefined) writer.string(value);
}

function stringList(writer: CanonicalWriter, values: readonly string[], field: string): void {
  writer.int32(values.length, `${field}.length`);
  for (const value of values) writer.string(value);
}

function numbersByKey(
  writer: CanonicalWriter,
  record: Readonly<Record<string, number>>,
  field: string,
): void {
  const keys = sortedKeys(record);
  writer.int32(keys.length, `${field}.length`);
  for (const key of keys) {
    writer.string(key);
    writer.float64(record[key], `${field}.${key}`);
  }
}

function writeRocket(writer: CanonicalWriter, rocket: RocketDef): void {
  writer.string(rocket.name);
  writer.float64(rocket.payloadMass_kg, 'payloadMass_kg');
  writer.float64(rocket.referenceArea_m2, 'referenceArea_m2');
  writer.float64(rocket.dragCoefficient, 'dragCoefficient');
  writer.float64(rocket.maxDynamicPressure_Pa, 'maxDynamicPressure_Pa');
  writer.float64(rocket.stageSeparationDelay_s, 'stageSeparationDelay_s');
  writer.float64(rocket.nominalMissionDuration_s, 'nominalMissionDuration_s');
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
}

/**
 * The catalogue, minus what it costs.
 *
 * Money is deliberately left out — of the QA table and of the parts alike. A
 * price change does not move a single tick of a flight, and a run is a record
 * of a flight; pinning the prices here would refuse a perfectly reproducible
 * mid-mission save because someone re-balanced the shop.
 */
function writeParts(
  writer: CanonicalWriter,
  qaLevels: QaLevelTable,
  parts: readonly PartDef[],
): void {
  const levels = sortedKeys(qaLevels);
  writer.int32(levels.length, 'qaLevels.length');
  for (const level of levels) {
    const qa = qaLevels[level as QaLevel];
    writer.string(level);
    writer.float64(qa.bandFactor, `${level}.bandFactor`);
    writer.float64(qa.reliabilityBonus, `${level}.reliabilityBonus`);
    writer.float64(qa.wearAdded, `${level}.wearAdded`);
    writer.boolean(qa.revealsExactValue);
  }

  const catalogue = byId(parts);
  writer.int32(catalogue.length, 'parts.length');
  for (const part of catalogue) {
    writer.string(part.id);
    writer.string(part.system);
    writer.float64(part.mass_kg, `${part.id}.mass_kg`);
    writer.float64(part.reliabilityBand[0], `${part.id}.reliabilityBand[0]`);
    writer.float64(part.reliabilityBand[1], `${part.id}.reliabilityBand[1]`);
    stringList(writer, part.failureCauses, `${part.id}.failureCauses`);
  }
}

/**
 * The cause graph, in numbers and identifiers.
 *
 * Titles are left out on purpose: the same distinction the state hash draws
 * when it hashes an event's type and not its text (§8.2 rule 6). A cause's
 * lethality decides whether a mission ends; the words on the screen do not,
 * and hashing them would invalidate every save in the field over a typo fix.
 */
function writeCauseGraph(writer: CanonicalWriter, data: CauseGraphData): void {
  numbersByKey(writer, data._resources ?? {}, '_resources');

  const symptomIds = sortedKeys(data.symptoms);
  writer.int32(symptomIds.length, 'symptoms.length');
  for (const id of symptomIds) {
    const symptom = data.symptoms[id];
    writer.string(id);
    writer.boolean(symptom.delay_s !== undefined);
    if (symptom.delay_s !== undefined) {
      writer.float64(symptom.delay_s.min, `${id}.delay_s.min`);
      writer.float64(symptom.delay_s.max, `${id}.delay_s.max`);
    }
  }

  const causeIds = sortedKeys(data.causes);
  writer.int32(causeIds.length, 'causes.length');
  for (const id of causeIds) {
    const cause = data.causes[id];
    writer.string(id);
    stringList(writer, cause.symptoms, `${id}.symptoms`);
    optionalFloat(writer, cause.escalation_s, `${id}.escalation_s`);
    optionalFloat(writer, cause.lethality, `${id}.lethality`);
    stringList(writer, cause.context_priors ?? [], `${id}.context_priors`);
    optionalString(writer, cause.escalates_to);
    stringList(writer, cause.correct_measures, `${id}.correct_measures`);
    writer.int32(cause.incorrect_measures.length, `${id}.incorrect_measures.length`);
    for (const ref of cause.incorrect_measures) {
      writer.string(ref.measure);
      optionalString(writer, ref.side_effect);
    }
    writer.boolean(cause.is_chain === true);
  }

  const measureIds = sortedKeys(data.measures);
  writer.int32(measureIds.length, 'measures.length');
  for (const id of measureIds) {
    const measure = data.measures[id];
    writer.string(id);
    writer.string(measure.type);
    writer.float64(measure.duration_s, `${id}.duration_s`);
    stringList(writer, measure.occupies, `${id}.occupies`);
    stringList(writer, measure.discriminates ?? [], `${id}.discriminates`);
  }
}

function writeAnomalySettings(writer: CanonicalWriter, settings: AnomalySettings): void {
  writer.float64(settings.occurrenceProbability, 'occurrenceProbability');
  writer.float64(settings.onsetWindow_s.earliest, 'onsetWindow_s.earliest');
  writer.float64(settings.onsetWindow_s.latest, 'onsetWindow_s.latest');
  writer.float64(settings.symptomStrength.min, 'symptomStrength.min');
  writer.float64(settings.symptomStrength.max, 'symptomStrength.max');
  writer.float64(settings.symptomDelay_s.min, 'symptomDelay_s.min');
  writer.float64(settings.symptomDelay_s.max, 'symptomDelay_s.max');
}

function writePriorSettings(writer: CanonicalWriter, settings: PriorSettings): void {
  writer.float64(settings.matchBoost, 'matchBoost');

  const phases = sortedKeys(settings.phaseTags);
  writer.int32(phases.length, 'phaseTags.length');
  for (const phase of phases) {
    writer.string(phase);
    stringList(writer, settings.phaseTags[phase], `phaseTags.${phase}`);
  }

  const tags = byId(settings.missionTags);
  writer.int32(tags.length, 'missionTags.length');
  for (const tag of tags) {
    writer.string(tag.id);
    writer.float64(tag.probability, `${tag.id}.probability`);
  }
}

function writeComms(writer: CanonicalWriter, comms: CommsData): void {
  writer.float64(comms.earthRotationPeriod_s, 'earthRotationPeriod_s');
  writer.float64(comms.minElevation_deg, 'minElevation_deg');
  writer.float64(comms.referenceRange_m, 'referenceRange_m');

  const stations = byId(comms.stations);
  writer.int32(stations.length, 'stations.length');
  for (const station of stations) {
    writer.string(station.id);
    writer.float64(station.angle_deg, `${station.id}.angle_deg`);
    writer.float64(station.downlinkRate, `${station.id}.downlinkRate`);
    optionalFloat(writer, station.localRange_m, `${station.id}.localRange_m`);
  }
}

/**
 * Hash over the tuning data, in a fixed field order.
 *
 * A run pins this: replaying against different numbers would silently produce
 * a different flight, so the mismatch is caught instead (concept §8.2 rule 7).
 * The fields are walked explicitly rather than via `JSON.stringify`, for the
 * same reason the state hash is — insertion order is not a schema, and it
 * cannot tell 1 from "1".
 *
 * What is walked is every number and identifier that reaches the simulation,
 * and nothing else. Prose and prices are outside, because neither moves a
 * tick, and a data version that changes when nothing about the flight did is a
 * data version players learn to distrust.
 */
export function computeDataVersion(data: MissionDataFiles): string {
  const writer = new CanonicalWriter();

  writeRocket(writer, data.rocket);

  writer.int32(data.pitchProgram.nodes.length, 'nodes.length');
  for (const node of data.pitchProgram.nodes) {
    writer.float64(node.time_s, 'time_s');
    writer.float64(node.pitch_deg, 'pitch_deg');
  }

  // The checklist is data too: its length gates arming and its countdown sets
  // the terminal count, so both change how a run unfolds.
  writer.int32(data.checklist.items.length, 'checklist.items.length');
  writer.float64(data.checklist.countdownSeconds, 'countdownSeconds');

  writeParts(writer, data.qaLevels, data.parts);
  writeCauseGraph(writer, data.causes);
  writeAnomalySettings(writer, data.anomalies);
  writePriorSettings(writer, data.priors);

  numbersByKey(writer, data.exposure.bySystem, 'exposure.bySystem');
  writer.float64(data.exposure.referenceDuration_s, 'exposure.referenceDuration_s');

  writeComms(writer, data.comms);

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
