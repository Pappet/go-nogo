/**
 * Assembles the mission configuration from the data files.
 *
 * Composition, not simulation: `src/sim` stays free of data imports and takes
 * everything it needs as an argument, which is what lets a test fly a
 * different graph without touching the shipped one.
 */
import anomalyData from './data/anomalies.json' with { type: 'json' };
import causesData from './data/causes.json' with { type: 'json' };
import doctrineData from './data/doctrines.json' with { type: 'json' };
import checklistData from './data/checklist.json' with { type: 'json' };
import partsData from './data/parts.json' with { type: 'json' };
import pitchData from './data/pitchProgram.json' with { type: 'json' };
import priorData from './data/priors.json' with { type: 'json' };
import riskData from './data/riskBudget.json' with { type: 'json' };
import vehicleData from './data/vehicle.json' with { type: 'json' };
import rocketData from './data/rocket.json' with { type: 'json' };
import { type ChecklistDef, type MissionConfigInput } from './sim/countdown.js';
import { type CauseGraphData, loadCauseGraph } from './sim/diagnosis/causeGraph.js';
import type { PriorSettings } from './sim/diagnosis/priors.js';
import type { PitchProgram } from './sim/physics/ascentProgram.js';
import type { RocketDef } from './sim/physics/thrust.js';
import { type PhaseExposure, causeProbabilities } from './economy/riskBudget.js';
import type { DoctrineDef } from './economy/doctrine.js';
import { type VehicleConfig, buildVehicle } from './economy/vehicle.js';
import type { PartDef, QaLevelTable } from './sim/parts/partInstance.js';
import type { AnomalySettings } from './sim/systems/anomaly.js';

export const rocket = rocketData as RocketDef;
export const pitchProgram = pitchData as PitchProgram;
export const checklist = checklistData as ChecklistDef;
export const anomalySettings = anomalyData as AnomalySettings;
export const priorSettings = priorData as PriorSettings;

/** Exposure factors for the live risk budget (§5.4). */
export const phaseExposure = riskData as PhaseExposure;

/** The planner's starting vehicle. A campaign keeps its own from here on. */
export const defaultVehicle = vehicleData as unknown as VehicleConfig;
export const causeGraphData = causesData as unknown as CauseGraphData;

/** One loaded graph for the lookups that do not want to rebuild it each call. */
const sharedGraph = loadCauseGraph(causeGraphData);

/** The three doctrines (§6.1). */
export const doctrines = doctrineData.doctrines as unknown as readonly DoctrineDef[];

export function doctrineById(doctrineId: string): DoctrineDef {
  const found = doctrines.find((entry) => entry.id === doctrineId);
  if (found === undefined) throw new Error(`Unknown doctrine '${doctrineId}'.`);
  return found;
}

/** The component catalogue and the QA table (§4, §4.1). */
export const qaLevels = partsData.qaLevels as QaLevelTable;
export const partCatalogue = partsData.parts as unknown as readonly PartDef[];

/** Lookup by id, so nothing downstream has to scan the catalogue. */
export function partDef(partId: string): PartDef {
  const found = partCatalogue.find((part) => part.id === partId);
  if (found === undefined) throw new Error(`Unknown part '${partId}'.`);
  return found;
}

/**
 * The launcher, carrying whatever redundancy the configuration added (§4.2).
 *
 * Backup hardware is not free: it goes on stage 1's dry mass, the ascent has
 * to lift it, and the Δv it eats shows up in the orbit. That is the trade the
 * planner exists for — lighter and riskier, or heavier and safer. The baseline
 * hull already carries one of everything, so only the second and third unit
 * are charged; counting the whole catalogue would tax a vehicle twice.
 */
export function withRedundancyMass(vehicle: VehicleConfig, seed: number): RocketDef {
  const extra = buildVehicle(vehicle, qaLevels, seed).redundancyMass_kg;
  if (extra === 0) return rocket;
  return {
    ...rocket,
    stages: rocket.stages.map((stage, index) =>
      index === 0 ? { ...stage, dryMass_kg: stage.dryMass_kg + extra } : stage,
    ),
  };
}

/**
 * How lethal a part's worst failure mode is (§5.4).
 *
 * The risk budget weights by this, and it is deliberately not the occurrence
 * rate: a sensor that misbehaves on one flight in three but rarely kills
 * anyone belongs low on the risk budget and high on the ENGINEERING console.
 * A part is as dangerous as the worst thing it can cause.
 */
export function partLethality(partId: string): number {
  return partDef(partId).failureCauses.reduce(
    (worst, causeId) => Math.max(worst, sharedGraph.lethality(causeId)),
    0,
  );
}

/**
 * How likely each cause is on a given vehicle. Composition, not simulation:
 * `src/sim` takes the table and never learns what hardware produced it.
 */
export function occurrenceFor(vehicle: VehicleConfig, seed: number): Record<string, number> {
  return causeProbabilities(
    buildVehicle(vehicle, qaLevels, seed),
    partDef,
    phaseExposure,
    rocket.nominalMissionDuration_s,
  );
}

/**
 * The default mission. `overrides` is for tests and for the replay fixtures.
 *
 * `vehicle` is consumed here rather than carried into the config: `src/sim`
 * must not depend on the economy layer, so it receives the occurrence table
 * the vehicle produces and never learns what hardware produced it.
 */
export function createMissionConfig(
  overrides: Partial<MissionConfigInput> & { readonly vehicle?: VehicleConfig } = {},
): MissionConfigInput {
  const { vehicle = defaultVehicle, ...rest } = overrides;
  const seed = rest.seed ?? 42;
  return {
    rocket: withRedundancyMass(vehicle, seed),
    pitchProgram,
    checklist,
    causeGraph: loadCauseGraph(causeGraphData),
    anomalySettings,
    priorSettings,
    seed,
    missionKey: 'mission-1',
    occurrenceByCause: occurrenceFor(vehicle, seed),
    ...rest,
  };
}
