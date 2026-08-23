/**
 * Thrust, mass flow and staging (concept §3: Tsiolkovsky).
 *
 * Engine performance is interpolated between the sea-level and vacuum figures
 * by ambient pressure, so the first stage genuinely gains thrust as it climbs.
 * Ambient pressure arrives as an argument rather than being looked up here —
 * that keeps this module free of any atmosphere model.
 */
import { log } from '../math.js';

import { SEA_LEVEL_PRESSURE, STANDARD_GRAVITY } from './constants.js';

export interface StageDef {
  readonly name: string;
  readonly dryMass_kg: number;
  readonly propellantMass_kg: number;
  readonly thrustSeaLevel_N: number;
  readonly thrustVacuum_N: number;
  readonly ispSeaLevel_s: number;
  readonly ispVacuum_s: number;
}

export interface TargetOrbit {
  readonly periapsisAltitude_m: number;
  readonly apoapsisAltitude_m: number;
}

export interface RocketDef {
  readonly name: string;
  readonly payloadMass_kg: number;
  readonly referenceArea_m2: number;
  readonly dragCoefficient: number;
  readonly maxDynamicPressure_Pa: number;
  readonly stages: readonly StageDef[];
  readonly targetOrbit: TargetOrbit;
}

/** Fraction of sea-level pressure, clamped — the interpolation weight. */
function pressureRatio(ambientPressure_Pa: number): number {
  const ratio = ambientPressure_Pa / SEA_LEVEL_PRESSURE;
  if (ratio <= 0) return 0;
  return ratio >= 1 ? 1 : ratio;
}

export function thrustAt(stage: StageDef, ambientPressure_Pa: number): number {
  const ratio = pressureRatio(ambientPressure_Pa);
  return stage.thrustVacuum_N + (stage.thrustSeaLevel_N - stage.thrustVacuum_N) * ratio;
}

export function ispAt(stage: StageDef, ambientPressure_Pa: number): number {
  const ratio = pressureRatio(ambientPressure_Pa);
  return stage.ispVacuum_s + (stage.ispSeaLevel_s - stage.ispVacuum_s) * ratio;
}

/** Propellant burned per second at the given thrust and Isp. */
export function massFlowRate(thrust_N: number, isp_s: number): number {
  return thrust_N / (isp_s * STANDARD_GRAVITY);
}

/**
 * Total vehicle mass with `stageIndex` burning and `propellantRemaining_kg`
 * left in it. Spent stages are gone; stages above still ride along full.
 */
export function vehicleMass_kg(
  rocket: RocketDef,
  stageIndex: number,
  propellantRemaining_kg: number,
): number {
  let mass = rocket.payloadMass_kg;
  for (let i = stageIndex; i < rocket.stages.length; i++) {
    const stage = rocket.stages[i];
    mass += stage.dryMass_kg;
    mass += i === stageIndex ? propellantRemaining_kg : stage.propellantMass_kg;
  }
  return mass;
}

/** Tsiolkovsky: the ideal velocity change between two masses. */
export function deltaV_ms(isp_s: number, massStart_kg: number, massEnd_kg: number): number {
  return isp_s * STANDARD_GRAVITY * log(massStart_kg / massEnd_kg);
}

/**
 * Ideal Δv of one stage burned to depletion, at the given ambient pressure.
 * Used for the pre-launch budget, not by the integrator.
 */
export function stageDeltaV_ms(
  rocket: RocketDef,
  stageIndex: number,
  ambientPressure_Pa: number,
): number {
  const stage = rocket.stages[stageIndex];
  const start = vehicleMass_kg(rocket, stageIndex, stage.propellantMass_kg);
  const end = vehicleMass_kg(rocket, stageIndex, 0);
  return deltaV_ms(ispAt(stage, ambientPressure_Pa), start, end);
}

/** Burn time of a stage at constant thrust, in seconds. */
export function stageBurnTime_s(stage: StageDef, ambientPressure_Pa: number): number {
  const flow = massFlowRate(thrustAt(stage, ambientPressure_Pa), ispAt(stage, ambientPressure_Pa));
  return stage.propellantMass_kg / flow;
}

/** Validates a rocket loaded from JSON. */
export function validateRocket(rocket: RocketDef): void {
  if (rocket.stages.length === 0) {
    throw new Error('Rocket has no stages');
  }
  rocket.stages.forEach((stage, index) => {
    if (stage.dryMass_kg <= 0 || stage.propellantMass_kg <= 0) {
      throw new Error(`Stage ${index} (${stage.name}) has a non-positive mass`);
    }
    if (stage.ispSeaLevel_s <= 0 || stage.ispVacuum_s <= 0) {
      throw new Error(`Stage ${index} (${stage.name}) has a non-positive Isp`);
    }
  });
}
