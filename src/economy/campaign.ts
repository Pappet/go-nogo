/**
 * Campaign state (concept §6).
 *
 * What survives between missions: the doctrine, the money, the standing in
 * each market, the week. Not simulation state — no ticks here — but it is
 * saved, so it is written as plain data with no behaviour hidden inside it.
 *
 * The campaign seed is what makes a campaign a campaign: every part serial in
 * it is drawn against this one number, so re-planning a vehicle mid-campaign
 * rebuilds only what was changed (§5.4), and a what-if in mission 9 can still
 * ask what mission 3's valve would have done.
 */
import type { DoctrineDef, MarketId } from './doctrine.js';
import type { VehicleConfig } from './vehicle.js';

export const MARKETS: readonly MarketId[] = ['government', 'commercial', 'science'];

export interface CampaignState {
  readonly doctrineId: string;
  /** Fixed for the life of the campaign. Every serial hangs off it. */
  readonly seed: number;
  capital: number;
  reputation: Record<MarketId, number>;
  /** Weeks elapsed. The board regenerates on this (§6.2). */
  week: number;
  /** Missions flown, in order. The mission key is derived from the count. */
  missionsFlown: number;
  /** The last vehicle the planner built, so a campaign resumes where it was. */
  vehicle: VehicleConfig;
}

export function createCampaign(
  doctrine: DoctrineDef,
  seed: number,
  vehicle: VehicleConfig,
): CampaignState {
  return {
    doctrineId: doctrine.id,
    seed,
    capital: doctrine.startingCapital,
    reputation: { ...doctrine.startingReputation },
    week: 1,
    missionsFlown: 0,
    vehicle,
  };
}

/**
 * The key that names the next mission.
 *
 * Derived rather than stored: a campaign that flew four missions is on
 * mission 5, and nothing else can be true. Storing it separately would let the
 * two drift, and a drifted mission key silently re-rolls a crisis.
 */
export function nextMissionKey(campaign: CampaignState): string {
  return `${campaign.doctrineId}/mission-${campaign.missionsFlown + 1}`;
}

/** Reputation is bounded: no market ever becomes free money or a dead end. */
export const REPUTATION_RANGE = { min: -50, max: 100 } as const;

export function adjustReputation(
  campaign: CampaignState,
  market: MarketId,
  delta: number,
): void {
  campaign.reputation[market] = Math.max(
    REPUTATION_RANGE.min,
    Math.min(REPUTATION_RANGE.max, campaign.reputation[market] + delta),
  );
}
