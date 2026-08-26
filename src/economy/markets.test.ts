/**
 * Markets and the weekly board (§6.2).
 *
 * The section's two protections against degeneration are the interesting part:
 * the minimum guarantee, so a bad week never becomes an unrecoverable
 * campaign, and the cross-market cooling, so "commercial spam prints money"
 * stops being the only strategy. Both are properties rather than numbers, and
 * both are what these tests are for.
 */
import { describe, expect, it } from 'vitest';

import { contracts, doctrineById } from '../missionConfig.js';
import { QA_LEVELS } from '../sim/parts/partInstance.js';

import { MARKETS, type CampaignState, createCampaign } from './campaign.js';
import { generateBoard, meetsRequirements, settleContract } from './markets.js';
import type { VehicleConfig } from './vehicle.js';

const vehicle: VehicleConfig = {
  slots: [{ slotId: 'a', partId: 'part_main_valve', qaLevel: 'series', units: 1 }],
};

const fresh = (doctrineId = 'doctrine_precision'): CampaignState =>
  createCampaign(doctrineById(doctrineId), 42, vehicle);

describe('the weekly board', () => {
  it('is the same board for the same campaign and week, on any machine', () => {
    expect(generateBoard(contracts, fresh(), 7)).toEqual(generateBoard(contracts, fresh(), 7));
  });

  it('is a different board next week, and in a different campaign', () => {
    const week7 = JSON.stringify(generateBoard(contracts, fresh(), 7));
    expect(JSON.stringify(generateBoard(contracts, fresh(), 8))).not.toBe(week7);

    const otherSeed = createCampaign(doctrineById('doctrine_precision'), 43, vehicle);
    expect(JSON.stringify(generateBoard(contracts, otherSeed, 7))).not.toBe(week7);
  });

  it('offers every market something takeable, however bad the standing', () => {
    // §6.2's minimum guarantee. The test drives reputation to the floor in
    // every market, which is the state a campaign has to be able to climb out
    // of rather than the state it gets stuck in.
    const ruined = fresh();
    for (const market of MARKETS) ruined.reputation[market] = -50;

    for (let week = 1; week <= 30; week += 1) {
      const board = generateBoard(contracts, ruined, week);
      for (const market of MARKETS) {
        expect(board.some((contract) => contract.market === market)).toBe(true);
      }
    }
  });

  it('pays a neglected market worse rather than closing it', () => {
    // Standing shows up as better terms, not as more entries: the guaranteed
    // offer is the one that stays reachable at the bottom.
    const ruined = fresh();
    for (const market of MARKETS) ruined.reputation[market] = -50;
    const trusted = fresh();
    for (const market of MARKETS) trusted.reputation[market] = 60;

    const worstGov = generateBoard(contracts, ruined, 4).filter((c) => c.market === 'government');
    const bestGov = generateBoard(contracts, trusted, 4).filter((c) => c.market === 'government');
    expect(Math.max(...bestGov.map((c) => c.fee))).toBeGreaterThan(
      Math.max(...worstGov.map((c) => c.fee)),
    );
  });

  it('never puts more on the board than the board holds', () => {
    const trusted = fresh();
    for (const market of MARKETS) trusted.reputation[market] = 100;
    for (let week = 1; week <= 20; week += 1) {
      expect(generateBoard(contracts, trusted, week).length).toBeLessThanOrEqual(
        contracts.boardSize,
      );
    }
  });

  it('never offers the same contract twice in one week', () => {
    const trusted = fresh();
    for (const market of MARKETS) trusted.reputation[market] = 100;
    for (let week = 1; week <= 20; week += 1) {
      const board = generateBoard(contracts, trusted, week);
      expect(new Set(board.map((c) => c.templateId)).size).toBe(board.length);
    }
  });
});

describe('settling a contract', () => {
  it('pays, lifts the market and cools the others', () => {
    const campaign = fresh();
    const before = { ...campaign.reputation };
    const contract = generateBoard(contracts, campaign, 1)[0];

    const outcome = settleContract(contracts, campaign, contract, true);
    expect(outcome.paid).toBe(contract.fee);
    expect(campaign.reputation[contract.market]).toBeGreaterThan(before[contract.market]);
    for (const market of MARKETS) {
      if (market !== contract.market) {
        expect(campaign.reputation[market]).toBeLessThan(before[market]);
      }
    }
  });

  it('costs the penalty on a failure, and costs standing more than success gained', () => {
    // A customer remembers a loss longer than a delivery.
    const won = fresh();
    const lost = fresh();
    const contract = generateBoard(contracts, won, 1)[0];
    const market = contracts.markets[contract.market];

    const gained = market.reputationOnSuccess;
    settleContract(contracts, won, contract, true);
    const outcome = settleContract(contracts, lost, contract, false);

    expect(outcome.paid).toBe(-contract.penalty);
    expect(lost.capital).toBeLessThan(won.capital);
    expect(Math.abs(market.reputationOnFailure)).toBeGreaterThan(gained);
  });

  it('pays research data only for a mission that arrived', () => {
    const won = fresh();
    const lost = fresh();
    const withData = generateBoard(contracts, won, 1).find((c) => c.researchData > 0);
    expect(withData).toBeDefined();
    if (withData === undefined) return;
    expect(settleContract(contracts, won, withData, true).researchData).toBe(withData.researchData);
    expect(settleContract(contracts, lost, withData, false).researchData).toBe(0);
  });

  it('advances the campaign exactly one mission and one week', () => {
    const campaign = fresh();
    const contract = generateBoard(contracts, campaign, 1)[0];
    settleContract(contracts, campaign, contract, true);
    expect(campaign.missionsFlown).toBe(1);
    expect(campaign.week).toBe(2);
  });
});

describe('what the customer asked for', () => {
  const contract = {
    templateId: 't',
    market: 'government' as const,
    title: 'T',
    fee: 1000,
    penalty: 400,
    requiredQaLevel: 'acceptance' as const,
    maxAcceptedRisk: 0.1,
    researchData: 0,
    guaranteed: false,
  };

  it('turns a shortfall into a sentence, not a locked button', () => {
    const result = meetsRequirements(contract, ['series'], QA_LEVELS, 0.3);
    expect(result.ok).toBe(false);
    expect(result.reasons).toHaveLength(2);
    expect(result.reasons.join(' ')).toContain('acceptance');
    expect(result.reasons.join(' ')).toContain('10 %');
  });

  it('accepts a vehicle that clears both bars', () => {
    expect(meetsRequirements(contract, ['acceptance', 'qualification'], QA_LEVELS, 0.05).ok).toBe(
      true,
    );
  });

  it('lets a flight-proven part clear a testing bar', () => {
    // It sits last in the cost ordering because it is cheap, but the value is
    // on the certificate — which is what the customer was asking for.
    expect(meetsRequirements(contract, ['flightProven'], QA_LEVELS, 0.05).ok).toBe(true);
  });

  it('fails one bar without inventing the other', () => {
    expect(meetsRequirements(contract, ['qualification'], QA_LEVELS, 0.3).reasons).toHaveLength(1);
    expect(meetsRequirements(contract, ['series'], QA_LEVELS, 0.05).reasons).toHaveLength(1);
  });
});
