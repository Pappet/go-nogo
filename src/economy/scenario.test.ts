/**
 * Starting scenarios and the sandbox (§9, §6.7).
 *
 * The claim being tested is the one §6.1 needs: doctrine × scenario gives six
 * genuinely different openings. A scenario that only moved a number would give
 * six of the same opening at different volumes.
 */
import { describe, expect, it } from 'vitest';

import { defaultVehicle, doctrineById, doctrines, scenarioById, scenarioTable, scenarios } from '../missionConfig.js';

import { createCampaign } from './campaign.js';
import {
  applyScenario,
  createSandboxState,
  enterSandbox,
  leaveSandbox,
  noteOrbitReached,
  openingSummary,
  startingVehicle,
  weeklyFixedCosts,
} from './scenario.js';

const openingFor = (doctrineId: string, scenarioId: string) => {
  const doctrine = doctrineById(doctrineId);
  const campaign = createCampaign(doctrine, 42, defaultVehicle);
  applyScenario(campaign, scenarioById(scenarioId));
  return campaign;
};

describe('doctrine crossed with scenario', () => {
  it('gives six openings, no two of them the same', () => {
    const seen = new Set<string>();
    for (const doctrine of doctrines) {
      for (const scenario of scenarios) {
        const campaign = openingFor(doctrine.id, scenario.id);
        seen.add(
          JSON.stringify([campaign.capital, campaign.reputation, scenario.startingQaLevel]),
        );
      }
    }
    expect(seen.size).toBe(doctrines.length * scenarios.length);
  });

  it('lets the scenario dent what the doctrine set, not replace it', () => {
    // Science starts commercially in the red; inheriting a failed competitor
    // should make that worse rather than overwriting it with its own number.
    const clean = openingFor('doctrine_science', 'scenario_series_zero');
    const inherited = openingFor('doctrine_science', 'scenario_inherited');
    expect(clean.reputation.commercial).toBeLessThan(0);
    expect(inherited.reputation.commercial).toBeLessThan(clean.reputation.commercial);
  });

  it('pays for its own advantages', () => {
    // Inherited Hardware arrives with more money and flight-proven stock, and
    // a debt that starts on Monday. If it were only the upside it would be the
    // scenario everybody picks.
    const inherited = scenarioById('scenario_inherited');
    expect(inherited.capitalDelta).toBeGreaterThan(0);
    expect(inherited.weeklyDebt).toBeGreaterThan(0);
    expect(Object.values(inherited.reputationDelta).some((delta) => delta < 0)).toBe(true);
  });

  it('hands over the stock it says it hands over', () => {
    const inherited = startingVehicle(scenarioById('scenario_inherited'), defaultVehicle);
    expect(inherited.slots.every((slot) => slot.qaLevel === 'flightProven')).toBe(true);

    const fresh = startingVehicle(scenarioById('scenario_series_zero'), defaultVehicle);
    expect(fresh).toBe(defaultVehicle);
  });

  it('names the opening in one line', () => {
    expect(openingSummary(doctrineById('doctrine_precision'), scenarioById('scenario_inherited')))
      .toBe('Precision · Inherited Hardware');
  });
});

describe('the sandbox', () => {
  it('stays locked until a stable orbit, and cannot be talked into opening', () => {
    const state = createSandboxState();
    expect(enterSandbox(state)).toBe(false);

    // A vehicle that reached orbit and then broke up did not reach orbit.
    noteOrbitReached(state, false);
    expect(state.unlocked).toBe(false);
    expect(enterSandbox(state)).toBe(false);

    noteOrbitReached(state, true);
    expect(state.unlocked).toBe(true);
    expect(enterSandbox(state)).toBe(true);
    expect(state.active).toBe(true);
  });

  it('stays unlocked once it is unlocked', () => {
    const state = createSandboxState();
    noteOrbitReached(state, true);
    noteOrbitReached(state, false);
    expect(state.unlocked).toBe(true);
  });

  it('can be left again', () => {
    const state = createSandboxState();
    noteOrbitReached(state, true);
    enterSandbox(state);
    leaveSandbox(state);
    expect(state.active).toBe(false);
    expect(state.unlocked).toBe(true);
  });

  it('charges no fixed costs, which is the whole of what makes it a mode', () => {
    const inherited = scenarioById('scenario_inherited');
    expect(weeklyFixedCosts(inherited, 200, false)).toBe(inherited.weeklyDebt + 200);
    expect(weeklyFixedCosts(inherited, 200, true)).toBe(0);
  });

  it('says what unlocks it, where the player will look', () => {
    expect(scenarioTable.sandbox.unlockedBy.length).toBeGreaterThan(5);
  });
});
