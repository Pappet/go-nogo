/**
 * Doctrines (concept §6.1).
 *
 * Chosen once per campaign and never changed. A doctrine is not a difficulty
 * setting: it makes some vehicles cheap and forbids others outright, so two
 * campaigns reach the same orbit having built genuinely different hardware.
 * That divergence is Phase 2's whole Definition of Done, and it has to live in
 * the prices rather than in the flavour text.
 */
import type { QaLevel } from '../sim/parts/partInstance.js';

export type MarketId = 'government' | 'commercial' | 'science';

export interface DoctrineDef {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly naturalPath: string;
  readonly startingCapital: number;
  /** Multiplier on a part's base cost, by the system it belongs to. */
  readonly costBySystem: Readonly<Record<string, number>>;
  /** Multiplier on what the QA level itself adds. */
  readonly qaCostMultiplier: number;
  /** QA levels this doctrine cannot buy at all, and why. */
  readonly lockedQaLevels: readonly QaLevel[];
  readonly lockedQaReason: string;
  readonly startingReputation: Readonly<Record<MarketId, number>>;
  /** How much precision bonuses on contracts are worth (§6.1). */
  readonly precisionBonusFactor: number;
}

/**
 * What one unit costs under a doctrine.
 *
 * The system multiplier and the QA multiplier are deliberately separate. A
 * doctrine that makes avionics cheap should make a *qualified* avionics unit
 * cheap too, but a doctrine that makes testing cheap should not thereby
 * discount the hardware — otherwise every doctrine collapses into "things cost
 * less" and the choice stops being a shape.
 */
export function unitCost(
  doctrine: DoctrineDef,
  baseCost: number,
  system: string,
  qaMultiplier: number,
): number {
  const hardware = baseCost * (doctrine.costBySystem[system] ?? 1);
  const testing = hardware * (qaMultiplier - 1) * doctrine.qaCostMultiplier;
  return Math.round(hardware + testing);
}

/** True when the doctrine forbids this level outright (§6.1). */
export function qaLocked(doctrine: DoctrineDef, level: QaLevel): boolean {
  return doctrine.lockedQaLevels.includes(level);
}

/**
 * The level a slot falls back to when its doctrine forbids the current one.
 *
 * Needed because a campaign can be started on a saved vehicle: rather than
 * refusing to load, the planner moves the slot to the cheapest level the
 * doctrine does allow and shows it as changed.
 */
export function nearestAllowedQa(
  doctrine: DoctrineDef,
  level: QaLevel,
  order: readonly QaLevel[],
): QaLevel {
  if (!qaLocked(doctrine, level)) return level;
  const allowed = order.filter((entry) => !qaLocked(doctrine, entry));
  if (allowed.length === 0) throw new Error(`Doctrine '${doctrine.id}' forbids every QA level.`);
  const wanted = order.indexOf(level);
  return allowed.reduce((best, entry) =>
    Math.abs(order.indexOf(entry) - wanted) < Math.abs(order.indexOf(best) - wanted) ? entry : best,
  );
}
