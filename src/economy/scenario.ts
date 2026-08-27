/**
 * Starting scenarios and the sandbox (concept §9, §6.7).
 *
 * Two scenarios crossed with three doctrines are the six campaign openings
 * §6.1 wants before the first fork. A scenario is a *situation*, not a
 * difficulty slider: "Series Zero" starts you with nothing and owing nothing,
 * "Inherited Hardware" with parts somebody else already flew and a debt that
 * starts on Monday. Neither is the easy one.
 *
 * The sandbox (§6.7) unlocks on the first stable orbit and costs almost
 * nothing to provide, because it is the same simulation with the economy hooks
 * switched off. That is the whole implementation and deliberately so.
 */
import type { QaLevel } from '../sim/parts/partInstance.js';

import type { CampaignState } from './campaign.js';
import type { DoctrineDef, MarketId } from './doctrine.js';
import { adjustReputation } from './campaign.js';
import type { VehicleConfig } from './vehicle.js';

export interface ScenarioDef {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** One line of situation, shown where the campaign is chosen. */
  readonly opening: string;
  readonly capitalDelta: number;
  /** Fixed weekly repayment, on top of any payroll (§6.6 feeds on this). */
  readonly weeklyDebt: number;
  readonly reputationDelta: Readonly<Record<MarketId, number>>;
  /** QA level the inherited stock arrives at, if any. */
  readonly startingQaLevel: QaLevel | null;
  readonly startingWear: number;
}

export interface SandboxDef {
  readonly title: string;
  readonly summary: string;
  readonly unlockedBy: string;
}

export interface ScenarioData {
  readonly scenarios: readonly ScenarioDef[];
  readonly sandbox: SandboxDef;
}

/**
 * Applies a scenario to a campaign that has already had its doctrine applied.
 *
 * Order matters and is worth stating: the doctrine decides what kind of
 * company this is, the scenario decides what it is standing in. Applying the
 * scenario second means "Inherited Hardware" dents a Science company's already
 * negative commercial standing rather than replacing it.
 */
export function applyScenario(campaign: CampaignState, scenario: ScenarioDef): void {
  campaign.capital += scenario.capitalDelta;
  for (const [market, delta] of Object.entries(scenario.reputationDelta)) {
    adjustReputation(campaign, market as MarketId, delta);
  }
}

/** The vehicle a scenario hands you, if it hands you one. */
export function startingVehicle(
  scenario: ScenarioDef,
  base: VehicleConfig,
): VehicleConfig {
  if (scenario.startingQaLevel === null) return base;
  return {
    slots: base.slots.map((slot) => ({ ...slot, qaLevel: scenario.startingQaLevel as QaLevel })),
  };
}

/**
 * Fixed costs due at the end of a week.
 *
 * The sandbox has none — §6.7 says "no fixed costs", and that is the single
 * line that makes it a different mode rather than a different balance.
 */
export function weeklyFixedCosts(
  scenario: ScenarioDef,
  salaries: number,
  sandbox: boolean,
): number {
  return sandbox ? 0 : scenario.weeklyDebt + salaries;
}

export interface SandboxState {
  /** True once the campaign has reached a stable orbit (§6.7). */
  unlocked: boolean;
  /** True while the player is actually in it. */
  active: boolean;
}

export function createSandboxState(): SandboxState {
  return { unlocked: false, active: false };
}

/**
 * Records a mission outcome against the unlock condition.
 *
 * "First stable orbit" is read literally: the vehicle has to still exist and
 * the orbit has to close. A suborbital arc that came down intact is not it,
 * and neither is an orbit reached by a vehicle that then broke up.
 */
export function noteOrbitReached(state: SandboxState, stableOrbit: boolean): void {
  if (stableOrbit) state.unlocked = true;
}

export function enterSandbox(state: SandboxState): boolean {
  if (!state.unlocked) return false;
  state.active = true;
  return true;
}

export function leaveSandbox(state: SandboxState): void {
  state.active = false;
}

/** What a doctrine and a scenario together are worth at the start. */
export function openingSummary(doctrine: DoctrineDef, scenario: ScenarioDef): string {
  return `${doctrine.title} · ${scenario.title}`;
}
