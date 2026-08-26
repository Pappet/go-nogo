/**
 * The risk budget, live (concept §5.4).
 *
 * "Loss-of-mission estimate from bands, phase factors, redundancy, duration —
 * every line item with a price tag you can push on." Phase 1 shipped one
 * static number; this computes it from the vehicle actually configured.
 *
 * The important restraint: the budget is built from what the player can *see*.
 * §4 says the spread is visible and the exact value is not — so the estimate
 * is an interval derived from each unit's `visibleBand`, and buying QA narrows
 * it rather than moving it. A budget computed from `effectiveReliability`
 * would be a more accurate number that leaks the answer, and the game is about
 * deciding under a band.
 */
import type { BuiltSlot, BuiltVehicle } from './vehicle.js';

export interface PhaseExposure {
  /** Per system: how much of the mission actually stresses it. */
  readonly bySystem: Readonly<Record<string, number>>;
  /** Mission length the exposures are quoted for. */
  readonly referenceDuration_s: number;
}

export interface RiskLine {
  readonly slotId: string;
  readonly label: string;
  readonly system: string;
  readonly units: number;
  /** Failure probability for this slot, low and high end of the visible band. */
  readonly contribution: readonly [number, number];
  /** What is on the certificate, for the console to show next to the number. */
  readonly qaLevel: string;
  readonly mass_kg: number;
  readonly cost: number;
}

export interface RiskBudget {
  /** Loss of mission, low and high end. Collapses to a point under full QA. */
  readonly lossOfMission: readonly [number, number];
  readonly lines: readonly RiskLine[];
  readonly mass_kg: number;
  /** What redundancy adds to the vehicle, and the ascent has to lift (§4.2). */
  readonly redundancyMass_kg: number;
  readonly cost: number;
}

/** Probability that every unit in a slot fails — the slot's own failure (§4.2). */
function slotFailure(slot: BuiltSlot, exposure: number, end: 0 | 1): number {
  let all = 1;
  for (const unit of slot.units) {
    // A unit only gets to fail during the part of the mission that stresses it.
    all *= Math.min(1, (1 - unit.visibleBand[end]) * exposure);
  }
  return all;
}

/**
 * Prices a built vehicle.
 *
 * `duration_s` scales every exposure: the same hardware flown twice as long is
 * exposed twice as long, which is the "duration" term §5.4 asks for.
 *
 * `lethalityOf` is what keeps this a *loss-of-mission* estimate rather than an
 * anomaly counter. Occurrence and lethality were one number until they were
 * measured against each other, and while they were, §5.6's eventful mission
 * and §5.4's 11 % could not both be true.
 */
export function computeRiskBudget(
  vehicle: BuiltVehicle,
  exposure: PhaseExposure,
  duration_s: number,
  lethalityOf: (partId: string) => number = () => 1,
): RiskBudget {
  const scale = duration_s / exposure.referenceDuration_s;

  const lines = vehicle.slots.map((slot) => {
    const systemExposure = (exposure.bySystem[slot.system] ?? 1) * scale;
    return {
      slotId: slot.slotId,
      label: slot.title,
      system: slot.system,
      units: slot.units.length,
      // Band end 1 is the optimistic reliability, so it gives the low failure
      // end. Ordered here rather than left to the caller to sort out.
      // Weighted by lethality: the budget is a loss-of-mission estimate, not a
      // count of how often something will go wrong. A sensor that misbehaves
      // on one flight in three but rarely kills anyone belongs low on this
      // list and high on the ENGINEERING console's.
      contribution: [
        slotFailure(slot, systemExposure, 1) * lethalityOf(slot.partId),
        slotFailure(slot, systemExposure, 0) * lethalityOf(slot.partId),
      ] as readonly [number, number],
      qaLevel: slot.units[0]?.qaLevel ?? 'series',
      mass_kg: slot.mass_kg,
      cost: slot.cost,
    };
  });

  // The vehicle survives only if every slot does.
  const survives = (end: 0 | 1): number =>
    lines.reduce((product, line) => product * (1 - line.contribution[end]), 1);

  return {
    lossOfMission: [1 - survives(0), 1 - survives(1)],
    lines: [...lines].sort((a, b) => b.contribution[1] - a.contribution[1]),
    mass_kg: vehicle.mass_kg,
    redundancyMass_kg: vehicle.redundancyMass_kg,
    cost: vehicle.cost,
  };
}

/**
 * How likely each cause is to actually fire, given this vehicle.
 *
 * The counterpart to `computeRiskBudget`, and the one place that reads
 * `effectiveReliability` instead of the visible band: this is the world, not
 * the display. The player is shown an estimate; the mission gets the truth.
 *
 * A part maps its failure onto the causes it can produce (§4). When a slot is
 * redundant, the cause only fires if every unit fails — the same product the
 * budget prices, which is what makes the budget an honest forecast of this.
 */
export function causeProbabilities(
  vehicle: BuiltVehicle,
  parts: (partId: string) => { readonly failureCauses: readonly string[] },
  exposure: PhaseExposure,
  duration_s: number,
): Record<string, number> {
  const scale = duration_s / exposure.referenceDuration_s;
  const byCause: Record<string, number> = {};

  for (const slot of vehicle.slots) {
    const systemExposure = (exposure.bySystem[slot.system] ?? 1) * scale;
    let allFail = 1;
    for (const unit of slot.units) {
      allFail *= Math.min(1, (1 - unit.effectiveReliability) * systemExposure);
    }
    // Two slots that can produce the same cause are two independent ways for
    // it to happen, so they combine rather than overwrite.
    for (const causeId of parts(slot.partId).failureCauses) {
      const already = byCause[causeId] ?? 0;
      byCause[causeId] = 1 - (1 - already) * (1 - allFail);
    }
  }
  return byCause;
}

/** The single number for the masthead, when there is only room for one. */
export function headlineRisk(budget: RiskBudget): number {
  return (budget.lossOfMission[0] + budget.lossOfMission[1]) / 2;
}

/**
 * How wide the estimate still is.
 *
 * This is the number QA actually buys, and worth showing on its own: a player
 * who pays for qualification is not buying a lower risk, they are buying a
 * smaller unknown.
 */
export function uncertainty(budget: RiskBudget): number {
  return budget.lossOfMission[1] - budget.lossOfMission[0];
}
