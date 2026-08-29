/**
 * What the campaign seed is for (concept §6, §8.2 rule 5).
 *
 * `campaign.ts` claims the seed "is what makes a campaign a campaign", and for
 * a while that was only true on paper: the console started every campaign on
 * 42, so three doctrines drew the same hardware, were offered the same work at
 * the same prices and could hire the same people. They were one company in
 * three paint jobs, which is precisely what Phase 2's first done-criterion
 * asks them not to be.
 *
 * These tests hold both halves of the claim at once: two seeds diverge, and
 * one seed does not — because a campaign that re-rolled its own hardware on
 * reload would break §5.4's surgical re-roll just as thoroughly.
 */
import { describe, expect, it } from 'vitest';

import { contracts, defaultVehicle, doctrines, qaLevels, staffTable } from '../missionConfig.js';

import { createCampaign } from './campaign.js';
import { generateBoard } from './markets.js';
import { offerPool } from './staff.js';
import { buildVehicle } from './vehicle.js';

const WEEKS = [1, 2, 3, 4, 5, 6, 7, 8];

function boardFees(seed: number): number[] {
  const campaign = createCampaign(doctrines[0], seed, defaultVehicle);
  return WEEKS.flatMap((week) =>
    generateBoard(contracts, campaign, week).map((contract) => contract.fee),
  );
}

function reliabilities(seed: number): number[] {
  return buildVehicle(defaultVehicle, qaLevels, seed).slots.flatMap((slot) =>
    slot.units.map((unit) => unit.effectiveReliability),
  );
}

/**
 * Who is on offer, not what the slots are called: an engineer's id is their
 * position in the month's pool and is the same in every campaign by
 * construction. The person standing in the slot is the seed's doing.
 */
function hiringOffers(seed: number): string[] {
  const campaign = createCampaign(doctrines[0], seed, defaultVehicle);
  return WEEKS.flatMap((week) =>
    offerPool(staffTable, campaign, week).map(
      (engineer) => `${engineer.name}/${engineer.specialty}/${engineer.salary}`,
    ),
  );
}

describe('two campaigns on different seeds', () => {
  const a = 1_001;
  const b = 8_675_309;

  it('are offered the same work at different prices', () => {
    // The board's shape is reputation (§6.2's minimum guarantee keeps a market
    // reachable however it is neglected); what it pays is the seed.
    expect(boardFees(a)).not.toEqual(boardFees(b));
  });

  it('draw different hardware from the same catalogue (§4)', () => {
    expect(reliabilities(a)).not.toEqual(reliabilities(b));
  });

  it('have different people to hire (§6.5)', () => {
    expect(hiringOffers(a)).not.toEqual(hiringOffers(b));
  });
});

describe('one campaign, asked twice', () => {
  const seed = 4_242;

  it('is the same company every time it is rebuilt', () => {
    // Which is what a resumed save is: the campaign rebuilt from its seed.
    expect(boardFees(seed)).toEqual(boardFees(seed));
    expect(reliabilities(seed)).toEqual(reliabilities(seed));
    expect(hiringOffers(seed)).toEqual(hiringOffers(seed));
  });

  it('keeps its seed across everything the campaign does to itself', () => {
    const campaign = createCampaign(doctrines[0], seed, defaultVehicle);
    const before = reliabilities(campaign.seed);

    campaign.capital -= 30_000;
    campaign.week += 5;
    campaign.missionsFlown += 4;
    campaign.reputation.government = 40;

    // §5.4 stands on this: a part is the same part in every what-if, whatever
    // the books did in between.
    expect(reliabilities(campaign.seed)).toEqual(before);
  });
});
