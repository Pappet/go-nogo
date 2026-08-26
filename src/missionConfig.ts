/**
 * Assembles the mission configuration from the data files.
 *
 * Composition, not simulation: `src/sim` stays free of data imports and takes
 * everything it needs as an argument, which is what lets a test fly a
 * different graph without touching the shipped one.
 */
import anomalyData from './data/anomalies.json' with { type: 'json' };
import causesData from './data/causes.json' with { type: 'json' };
import checklistData from './data/checklist.json' with { type: 'json' };
import partsData from './data/parts.json' with { type: 'json' };
import pitchData from './data/pitchProgram.json' with { type: 'json' };
import priorData from './data/priors.json' with { type: 'json' };
import riskData from './data/riskBudget.json' with { type: 'json' };
import rocketData from './data/rocket.json' with { type: 'json' };
import { type ChecklistDef, type MissionConfigInput } from './sim/countdown.js';
import { type CauseGraphData, loadCauseGraph } from './sim/diagnosis/causeGraph.js';
import type { PriorSettings } from './sim/diagnosis/priors.js';
import type { PitchProgram } from './sim/physics/ascentProgram.js';
import type { RocketDef } from './sim/physics/thrust.js';
import type { PartDef, QaLevelTable } from './sim/parts/partInstance.js';
import type { AnomalySettings } from './sim/systems/anomaly.js';

export const rocket = rocketData as RocketDef;
export const pitchProgram = pitchData as PitchProgram;
export const checklist = checklistData as ChecklistDef;
export const anomalySettings = anomalyData as AnomalySettings;
export const priorSettings = priorData as PriorSettings;

/** The static Phase 1 risk budget (§5.4). Phase 2 makes it respond to a config. */
export interface RiskBudget {
  readonly lossOfMission: number;
  readonly lines: readonly { readonly label: string; readonly contribution: number }[];
}
export const riskBudget = riskData as RiskBudget;
export const causeGraphData = causesData as unknown as CauseGraphData;

/** The component catalogue and the QA table (§4, §4.1). */
export const qaLevels = partsData.qaLevels as QaLevelTable;
export const partCatalogue = partsData.parts as unknown as readonly PartDef[];

/** Lookup by id, so nothing downstream has to scan the catalogue. */
export function partDef(partId: string): PartDef {
  const found = partCatalogue.find((part) => part.id === partId);
  if (found === undefined) throw new Error(`Unknown part '${partId}'.`);
  return found;
}

/** The default mission. `overrides` is for tests and for the replay fixtures. */
export function createMissionConfig(
  overrides: Partial<MissionConfigInput> = {},
): MissionConfigInput {
  return {
    rocket,
    pitchProgram,
    checklist,
    causeGraph: loadCauseGraph(causeGraphData),
    anomalySettings,
    priorSettings,
    seed: 42,
    missionKey: 'mission-1',
    ...overrides,
  };
}
