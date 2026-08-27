/**
 * Engineers and the soft fail (§6.5, §6.6).
 *
 * §6.5 is a section about restraint — the test that matters is that hiring
 * does one thing and does not become the game. §6.6 is a section about not
 * suffocating a player who is already losing, and every clause in it exists
 * because the obvious implementation would.
 */
import { describe, expect, it } from 'vitest';

import {
  baseMeasureDuration,
  contracts,
  createMissionConfig,
  doctrineById,
  staffTable,
  techTree,
} from '../missionConfig.js';

import { createBankruptcyState, branchToFreeze, isDictating, isFrozen, recordContractFlown, reviewFinances } from './bankruptcy.js';
import { type CampaignState, createCampaign } from './campaign.js';
import {
  createStaffState,
  dismiss,
  hasSpecialty,
  hire,
  measureDurationOverrides,
  offerPool,
  poolGeneration,
  weeklySalaries,
} from './staff.js';
import { createTechState, researchLevel, takeFork } from './techTree.js';
import type { VehicleConfig } from './vehicle.js';

const vehicle: VehicleConfig = {
  slots: [{ slotId: 'a', partId: 'part_main_valve', qaLevel: 'series', units: 1 }],
};
const fresh = (): CampaignState => createCampaign(doctrineById('doctrine_science'), 42, vehicle);
const baseDuration = (measureId: string): number =>
  measureId === 'measure_diag_team_prop' ? 22 : 22;

describe('hiring does one thing', () => {
  it('offers the same people for the same campaign and month', () => {
    expect(offerPool(staffTable, fresh(), 1)).toEqual(offerPool(staffTable, fresh(), 1));
    // Same month, different week: still the same pool.
    expect(offerPool(staffTable, fresh(), 2)).toEqual(offerPool(staffTable, fresh(), 1));
  });

  it('refreshes the pool monthly and differs between campaigns', () => {
    const later = poolGeneration(staffTable, 1 + staffTable.weeksPerPoolRefresh);
    expect(later).toBeGreaterThan(poolGeneration(staffTable, 1));
    expect(offerPool(staffTable, fresh(), 1 + staffTable.weeksPerPoolRefresh)).not.toEqual(
      offerPool(staffTable, fresh(), 1),
    );

    const other = createCampaign(doctrineById('doctrine_science'), 99, vehicle);
    expect(offerPool(staffTable, other, 1)).not.toEqual(offerPool(staffTable, fresh(), 1));
  });

  it('shortens the team query in the specialty that was hired, and only there', () => {
    const staff = createStaffState();
    hire(staffTable, staff, {
      id: 'e1',
      name: 'Chen',
      specialty: 'prop',
      salary: 50,
    });

    const overrides = measureDurationOverrides(staffTable, staff, baseDuration);
    expect(overrides.measure_diag_team_prop).toBeLessThan(baseDuration('measure_diag_team_prop'));
    expect(overrides.measure_diag_team_avionics).toBeUndefined();
  });

  it('does not stack two engineers in one specialty', () => {
    // §6.5 buys coverage, not a stacking discount. Stacking would make hiring
    // the only decision in the game.
    const one = createStaffState();
    const two = createStaffState();
    hire(staffTable, one, { id: 'a', name: 'A', specialty: 'prop', salary: 50 });
    hire(staffTable, two, { id: 'a', name: 'A', specialty: 'prop', salary: 50 });
    hire(staffTable, two, { id: 'b', name: 'B', specialty: 'prop', salary: 50 });

    expect(measureDurationOverrides(staffTable, two, baseDuration)).toEqual(
      measureDurationOverrides(staffTable, one, baseDuration),
    );
    // But the second one is still on the payroll.
    expect(weeklySalaries(two)).toBeGreaterThan(weeklySalaries(one));
  });

  it('will not hire the same person twice, or more than the office holds', () => {
    const staff = createStaffState();
    const engineer = { id: 'a', name: 'A', specialty: 'prop' as const, salary: 50 };
    expect(hire(staffTable, staff, engineer)).toBe(true);
    expect(hire(staffTable, staff, engineer)).toBe(false);

    for (let index = 0; index < staffTable.maxEngineers + 3; index += 1) {
      hire(staffTable, staff, { ...engineer, id: `x${index}` });
    }
    expect(staff.hired.length).toBe(staffTable.maxEngineers);
  });

  it('stops costing money and stops helping once dismissed', () => {
    const staff = createStaffState();
    hire(staffTable, staff, { id: 'a', name: 'A', specialty: 'prop', salary: 50 });
    dismiss(staff, 'a');
    expect(weeklySalaries(staff)).toBe(0);
    expect(hasSpecialty(staff, 'prop')).toBe(false);
    expect(measureDurationOverrides(staffTable, staff, baseDuration)).toEqual({});
  });
});

describe('the investor takes over rather than ending it', () => {
  const branches = techTree.branches;

  it('waits out the grace period before stepping in', () => {
    const campaign = fresh();
    const state = createBankruptcyState();
    const tech = createTechState();
    campaign.capital = -100;

    expect(reviewFinances(state, campaign, branches, tech).happened).toBe(false);
    expect(reviewFinances(state, campaign, branches, tech).happened).toBe(true);
  });

  it('forgets a bad week that was followed by a good one', () => {
    // Two bad weeks separated by a good one are two bad weeks, not a crisis.
    const campaign = fresh();
    const state = createBankruptcyState();
    const tech = createTechState();

    campaign.capital = -100;
    reviewFinances(state, campaign, branches, tech);
    campaign.capital = 500;
    reviewFinances(state, campaign, branches, tech);
    campaign.capital = -100;
    expect(reviewFinances(state, campaign, branches, tech).happened).toBe(false);
  });

  it('clears the debt, freezes a branch and costs standing everywhere', () => {
    const campaign = fresh();
    const state = createBankruptcyState();
    const tech = createTechState();
    const before = { ...campaign.reputation };
    campaign.capital = -400;

    reviewFinances(state, campaign, branches, tech);
    const result = reviewFinances(state, campaign, branches, tech);

    expect(result.happened).toBe(true);
    expect(campaign.capital).toBe(0);
    expect(result.frozenBranchId).not.toBeNull();
    expect(isDictating(state)).toBe(true);
    for (const market of Object.keys(before) as (keyof typeof before)[]) {
      expect(campaign.reputation[market]).toBeLessThan(before[market]);
    }
  });

  it('freezes a branch that was never forked, in preference to one that was', () => {
    // §6.6: a fork already taken is never changed retroactively.
    const tech = { ...createTechState(), data: 99 };
    const propulsion = branches[0];
    researchLevel(propulsion, tech);
    researchLevel(propulsion, tech);
    takeFork(propulsion, tech, propulsion.fork.options[0].id);

    expect(branchToFreeze(branches, tech)).not.toBe(propulsion.id);
  });

  it('freezes nothing rather than rewriting a decision, once every branch is forked', () => {
    const tech = { ...createTechState(), data: 999 };
    for (const branch of branches) {
      researchLevel(branch, tech);
      researchLevel(branch, tech);
      takeFork(branch, tech, branch.fork.options[0].id);
    }
    expect(branchToFreeze(branches, tech)).toBeNull();
  });

  it('counts the dictated contracts down and then hands control back', () => {
    const campaign = fresh();
    const state = createBankruptcyState();
    const tech = createTechState();
    campaign.capital = -400;
    reviewFinances(state, campaign, branches, tech);
    reviewFinances(state, campaign, branches, tech);

    let guard = 0;
    while (isDictating(state) && guard < 10) {
      recordContractFlown(state);
      guard += 1;
    }
    expect(guard).toBe(3);
    expect(isDictating(state)).toBe(false);
  });

  it('ends the campaign on the second takeover, not the first', () => {
    const campaign = fresh();
    const state = createBankruptcyState();
    const tech = createTechState();

    campaign.capital = -400;
    reviewFinances(state, campaign, branches, tech);
    expect(reviewFinances(state, campaign, branches, tech).ended).toBe(false);

    campaign.capital = -400;
    reviewFinances(state, campaign, branches, tech);
    expect(reviewFinances(state, campaign, branches, tech).ended).toBe(true);
    expect(state.ended).toBe(true);
  });

  it('keeps the frozen branch frozen', () => {
    const campaign = fresh();
    const state = createBankruptcyState();
    const tech = createTechState();
    campaign.capital = -400;
    reviewFinances(state, campaign, branches, tech);
    const frozen = reviewFinances(state, campaign, branches, tech).frozenBranchId;
    expect(frozen).not.toBeNull();
    if (frozen !== null) expect(isFrozen(state, frozen)).toBe(true);
    expect(isFrozen(state, 'branch_that_does_not_exist')).toBe(false);
  });

  it('leaves a solvent campaign entirely alone', () => {
    const campaign = fresh();
    const state = createBankruptcyState();
    for (let week = 0; week < 20; week += 1) {
      expect(reviewFinances(state, campaign, techTree.branches, createTechState()).happened).toBe(
        false,
      );
    }
    expect(state.takeovers).toBe(0);
    expect(contracts.boardSize).toBeGreaterThan(0);
  });
});

describe('the payroll reaches the crisis', () => {
  it('shortens the team query the mission actually schedules', () => {
    // The integration that matters: hiring is only worth anything if the
    // number on the ENGINEERING button, the scheduler and the makespan all
    // move together. They read one duration, so they cannot disagree.
    const staff = createStaffState();
    hire(staffTable, staff, { id: 'e', name: 'E', specialty: 'avionics', salary: 60 });

    const before = createMissionConfig();
    const after = createMissionConfig({
      measureDurations: measureDurationOverrides(staffTable, staff, baseMeasureDuration),
    });

    const query = 'measure_diag_team_avionics';
    expect(after.causeGraph.measure(query).duration_s).toBeLessThan(
      before.causeGraph.measure(query).duration_s,
    );
    expect(after.causeGraph.specs.get(query)?.duration_s).toBe(
      after.causeGraph.measure(query).duration_s,
    );

    // And the propulsion team, who nobody hired, is untouched.
    expect(after.causeGraph.measure('measure_diag_team_prop').duration_s).toBe(
      before.causeGraph.measure('measure_diag_team_prop').duration_s,
    );
  });
});
