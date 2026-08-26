/**
 * Assembles the mission configuration from the data files.
 *
 * Composition, not simulation: `src/sim` stays free of data imports and takes
 * everything it needs as an argument, which is what lets a test fly a
 * different graph without touching the shipped one.
 */
import anomalyData from './data/anomalies.json' with { type: 'json' };
import causesData from './data/causes.json' with { type: 'json' };
import contractData from './data/contracts.json' with { type: 'json' };
import doctrineData from './data/doctrines.json' with { type: 'json' };
import groundStationData from './data/groundStations.json' with { type: 'json' };
import checklistData from './data/checklist.json' with { type: 'json' };
import partsData from './data/parts.json' with { type: 'json' };
import pitchData from './data/pitchProgram.json' with { type: 'json' };
import priorData from './data/priors.json' with { type: 'json' };
import riskData from './data/riskBudget.json' with { type: 'json' };
import vehicleData from './data/vehicle.json' with { type: 'json' };
import rocketData from './data/rocket.json' with { type: 'json' };
import staffData from './data/staff.json' with { type: 'json' };
import techTreeData from './data/techtree.json' with { type: 'json' };
import { type ChecklistDef, type MissionConfigInput } from './sim/countdown.js';
import { type CauseGraphData, loadCauseGraph } from './sim/diagnosis/causeGraph.js';
import type { PriorSettings } from './sim/diagnosis/priors.js';
import type { PitchProgram } from './sim/physics/ascentProgram.js';
import type { RocketDef } from './sim/physics/thrust.js';
import { type PhaseExposure, causeProbabilities } from './economy/riskBudget.js';
import type { DoctrineDef } from './economy/doctrine.js';
import type { ContractsData } from './economy/markets.js';
import type { StaffData } from './economy/staff.js';
import {
  type TechEffects,
  type TechState,
  type TechTreeData,
  activeEffects,
  combineEffects,
  createTechState,
  shiftedBand,
} from './economy/techTree.js';
import { type VehicleConfig, buildVehicle } from './economy/vehicle.js';
import type { PartDef, QaLevelTable } from './sim/parts/partInstance.js';
import type { AnomalySettings } from './sim/systems/anomaly.js';
import type { CommsData } from './sim/systems/comms.js';

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

/** A measure's catalogue duration, before any payroll shortens it (§6.5). */
export function baseMeasureDuration(measureId: string): number {
  return sharedGraph.measure(measureId).duration_s;
}

/** Ground stations and the link budget (§7 ③). */
export const groundStations = groundStationData as unknown as CommsData;

/** Engineers (§6.5). */
export const staffTable = staffData as unknown as StaffData;

/** The tech tree, propulsion and avionics (§6.4). */
export const techTree = techTreeData as unknown as TechTreeData;

/** Markets, contract templates and the board's own numbers (§6.2). */
export const contracts = contractData as unknown as ContractsData;

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

/** Everything a campaign has researched, folded into one effect (§6.4). */
export function techEffects(tech: TechState = createTechState()): Required<TechEffects> {
  return combineEffects(activeEffects(techTree, tech));
}

/**
 * A part as research has left it (§6.4).
 *
 * The band moves, the cost moves, the identity does not — the part id and the
 * slot are unchanged, so a campaign that researches mid-run keeps the same
 * serial numbers and the post-mortem can still ask what that unit would have
 * done untouched.
 */
export function effectivePartDef(partId: string, effects: Required<TechEffects>): PartDef {
  const def = partDef(partId);
  return {
    ...def,
    reliabilityBand: shiftedBand(def.reliabilityBand, def.system, effects),
    cost: Math.round(def.cost * (effects.costBySystem[def.system] ?? 1)),
  };
}

/** Phase exposure as research has left it (§5.4, §6.4). */
export function effectiveExposure(effects: Required<TechEffects>): PhaseExposure {
  const bySystem: Record<string, number> = { ...phaseExposure.bySystem };
  for (const [system, factor] of Object.entries(effects.exposureBySystem)) {
    bySystem[system] = (bySystem[system] ?? 1) * factor;
  }
  return { ...phaseExposure, bySystem };
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
export function withRedundancyMass(
  vehicle: VehicleConfig,
  seed: number,
  effects: Required<TechEffects> = techEffects(),
): RocketDef {
  const extra = buildVehicle(vehicle, qaLevels, seed).redundancyMass_kg;
  const isp = effects.ispMultiplier;
  if (extra === 0 && isp === 1) return rocket;
  return {
    ...rocket,
    stages: rocket.stages.map((stage, index) => ({
      ...stage,
      dryMass_kg: index === 0 ? stage.dryMass_kg + extra : stage.dryMass_kg,
      ispSeaLevel_s: stage.ispSeaLevel_s * isp,
      ispVacuum_s: stage.ispVacuum_s * isp,
    })),
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
export function occurrenceFor(
  vehicle: VehicleConfig,
  seed: number,
  effects: Required<TechEffects> = techEffects(),
): Record<string, number> {
  return causeProbabilities(
    buildVehicle(vehicle, qaLevels, seed, undefined, (id) => effectivePartDef(id, effects)),
    partDef,
    effectiveExposure(effects),
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
  overrides: Partial<MissionConfigInput> & {
    readonly vehicle?: VehicleConfig;
    readonly tech?: TechState;
    /** Team-query durations as the payroll has left them (§6.5). */
    readonly measureDurations?: Readonly<Record<string, number>>;
  } = {},
): MissionConfigInput {
  const { vehicle = defaultVehicle, tech, measureDurations, ...rest } = overrides;
  const seed = rest.seed ?? 42;
  const effects = techEffects(tech);
  return {
    rocket: withRedundancyMass(vehicle, seed, effects),
    pitchProgram,
    checklist,
    causeGraph: loadCauseGraph(causeGraphData, measureDurations),
    comms: groundStations,
    anomalySettings,
    priorSettings,
    seed,
    missionKey: 'mission-1',
    occurrenceByCause: occurrenceFor(vehicle, seed, effects),
    ...rest,
  };
}
