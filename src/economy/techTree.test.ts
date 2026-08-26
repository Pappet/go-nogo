/**
 * The tech tree (§6.4).
 *
 * The section's own constraint is the thing worth testing: "different risk
 * profiles instead of better/worse". That is a claim about the data, and it
 * is exactly the claim a designer breaks by accident when tuning — so it is
 * asserted here rather than trusted.
 */
import { describe, expect, it } from 'vitest';

import { techTree } from '../missionConfig.js';

import {
  type TechState,
  activeEffects,
  combineEffects,
  createTechState,
  levelOf,
  nextStep,
  researchLevel,
  shiftedBand,
  takeFork,
} from './techTree.js';

const propulsion = techTree.branches.find((b) => b.id === 'branch_propulsion')!;
const avionics = techTree.branches.find((b) => b.id === 'branch_avionics')!;

const withData = (data: number): TechState => ({ ...createTechState(), data });

describe('research is spent, not just accumulated', () => {
  it('refuses a level it cannot pay for, and leaves the data alone', () => {
    const tech = withData(1);
    expect(researchLevel(propulsion, tech)).toBe(false);
    expect(tech.data).toBe(1);
    expect(levelOf(tech, propulsion.id)).toBe(0);
  });

  it('buys levels in order and cannot skip one', () => {
    const tech = withData(9);
    expect(researchLevel(propulsion, tech)).toBe(true);
    expect(levelOf(tech, propulsion.id)).toBe(1);
    expect(researchLevel(propulsion, tech)).toBe(true);
    expect(levelOf(tech, propulsion.id)).toBe(2);
    expect(tech.data).toBe(0);
    // Level 3 is a fork, not a level.
    expect(nextStep(propulsion, tech)?.kind).toBe('fork');
    expect(researchLevel(propulsion, tech)).toBe(false);
  });

  it('will not sell a fork before the levels under it', () => {
    const tech = withData(99);
    expect(takeFork(propulsion, tech, 'tech_cryogenic')).toBe(false);
    expect(tech.data).toBe(99);
  });

  it('takes a fork once and never again', () => {
    // §6.6: a fork already taken is never changed retroactively — and an
    // exclusive choice the player can undo is not exclusive.
    const tech = withData(99);
    researchLevel(propulsion, tech);
    researchLevel(propulsion, tech);
    expect(takeFork(propulsion, tech, 'tech_cryogenic')).toBe(true);
    expect(takeFork(propulsion, tech, 'tech_hypergolic')).toBe(false);
    expect(tech.forks[propulsion.id]).toBe('tech_cryogenic');
    expect(nextStep(propulsion, tech)).toBeNull();
  });

  it('keeps the branches independent', () => {
    const tech = withData(99);
    researchLevel(propulsion, tech);
    expect(levelOf(tech, avionics.id)).toBe(0);
  });
});

describe('the forks move risk rather than removing it', () => {
  const forkEffects = (branchId: string, optionId: string): ReturnType<typeof combineEffects> => {
    const branch = techTree.branches.find((b) => b.id === branchId)!;
    const option = branch.fork.options.find((o) => o.id === optionId)!;
    return combineEffects([option.effects]);
  };

  it('trades propulsion performance against propulsion quiet', () => {
    // Cryogenic buys Δv with anomalies; hypergolic buys quiet with margin.
    // If either were better on both counts the choice would not be one.
    const cryo = forkEffects('branch_propulsion', 'tech_cryogenic');
    const hyper = forkEffects('branch_propulsion', 'tech_hypergolic');

    expect(cryo.ispMultiplier).toBeGreaterThan(hyper.ispMultiplier);
    expect(cryo.reliabilityShift.prop[0]).toBeLessThan(hyper.reliabilityShift.prop[0]);
  });

  it('moves exposure between avionics and comms rather than lowering both', () => {
    const onboard = forkEffects('branch_avionics', 'tech_flight_computer');
    const ground = forkEffects('branch_avionics', 'tech_ground_guidance');

    expect(onboard.exposureBySystem.avionics).toBeGreaterThan(1);
    expect(onboard.exposureBySystem.comms).toBeLessThan(1);
    expect(ground.exposureBySystem.avionics).toBeLessThan(1);
    expect(ground.exposureBySystem.comms).toBeGreaterThan(1);
  });

  it('has no option that is better than its sibling on every axis', () => {
    // The property §6.4 actually asks for, checked across the whole tree so a
    // future branch cannot quietly ship a strictly dominant option.
    for (const branch of techTree.branches) {
      for (const option of branch.fork.options) {
        for (const other of branch.fork.options) {
          if (option.id === other.id) continue;
          const a = combineEffects([option.effects]);
          const b = combineEffects([other.effects]);
          const axes = [
            a.ispMultiplier - b.ispMultiplier,
            (a.reliabilityShift.prop?.[0] ?? 0) - (b.reliabilityShift.prop?.[0] ?? 0),
            (b.exposureBySystem.avionics ?? 1) - (a.exposureBySystem.avionics ?? 1),
            (b.exposureBySystem.comms ?? 1) - (a.exposureBySystem.comms ?? 1),
            (b.costBySystem.avionics ?? 1) - (a.costBySystem.avionics ?? 1),
          ];
          expect(axes.some((axis) => axis > 0)).toBe(true);
          expect(axes.some((axis) => axis < 0)).toBe(true);
        }
      }
    }
  });

  it('gives every fork option a sentence saying what it costs', () => {
    for (const branch of techTree.branches) {
      for (const option of branch.fork.options) {
        expect(option.risk.length).toBeGreaterThan(10);
      }
    }
  });
});

describe('effects fold without either half knowing about the other', () => {
  it('adds band shifts and multiplies multipliers', () => {
    const combined = combineEffects([
      { reliabilityShift: { prop: [0.03, 0.02] }, ispMultiplier: 1.02 },
      { reliabilityShift: { prop: [-0.06, -0.02] }, ispMultiplier: 1.09 },
    ]);
    expect(combined.reliabilityShift.prop[0]).toBeCloseTo(-0.03, 10);
    expect(combined.ispMultiplier).toBeCloseTo(1.02 * 1.09, 10);
  });

  it('collects everything a campaign has actually bought', () => {
    const tech = withData(99);
    researchLevel(propulsion, tech);
    researchLevel(propulsion, tech);
    takeFork(propulsion, tech, 'tech_hypergolic');
    const combined = combineEffects(activeEffects(techTree, tech));

    // Level 2's +0.03 and the hypergolic fork's +0.07 both landed.
    expect(combined.reliabilityShift.prop[0]).toBeCloseTo(0.1, 10);
    expect(combined.unlocksQa).toContain('qualification');
  });

  it('keeps a shifted band a probability, however hard it is pushed', () => {
    const brutal = combineEffects([{ reliabilityShift: { prop: [-5, 5] } }]);
    const [low, high] = shiftedBand([0.7, 0.9], 'prop', brutal);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(high).toBeGreaterThan(low);

    const other = shiftedBand([0.7, 0.9], 'prop', combineEffects([{ reliabilityShift: { prop: [5, -5] } }]));
    expect(other[1]).toBeGreaterThan(other[0]);
  });

  it('leaves an unresearched system alone', () => {
    const combined = combineEffects(activeEffects(techTree, createTechState()));
    expect(shiftedBand([0.7, 0.9], 'comms', combined)).toEqual([0.7, 0.9]);
    expect(combined.ispMultiplier).toBe(1);
  });
});
