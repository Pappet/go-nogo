/**
 * The live risk budget (§5.4).
 *
 * Phase 2's whole promise is that the configurator's dials move this number.
 * The tests are written as the questions a player asks at the planner: does
 * paying for QA change anything, does a second unit help, what does it cost.
 */
import { describe, expect, it } from 'vitest';

import { phaseExposure, qaLevels } from '../missionConfig.js';

import { computeRiskBudget, headlineRisk, uncertainty } from './riskBudget.js';
import { type VehicleConfig, buildDays, buildVehicle, changedSlots } from './vehicle.js';

const DURATION_S = 600;

function vehicle(...slots: VehicleConfig['slots']): VehicleConfig {
  return { slots };
}

const oneValve = vehicle({
  slotId: 'slot_main_valve',
  partId: 'part_main_valve',
  qaLevel: 'series',
  units: 1,
});

const priceOf = (config: VehicleConfig, seed = 42): ReturnType<typeof computeRiskBudget> =>
  computeRiskBudget(buildVehicle(config, qaLevels, seed), phaseExposure, DURATION_S);

describe('the budget answers the planner', () => {
  it('reports a range, because the exact value was not paid for', () => {
    const budget = priceOf(oneValve);
    expect(budget.lossOfMission[0]).toBeLessThan(budget.lossOfMission[1]);
    expect(uncertainty(budget)).toBeGreaterThan(0);
  });

  it('collapses the range once the value is certificated', () => {
    // This is what qualification actually buys: not a lower risk, a smaller
    // unknown. If this ever stops holding, the QA table has no meaning.
    const qualified = priceOf(
      vehicle({ ...oneValve.slots[0], qaLevel: 'qualification' }),
    );
    expect(uncertainty(qualified)).toBeLessThan(1e-9);
  });

  it('narrows the range on an acceptance test without pretending to know', () => {
    const series = priceOf(oneValve);
    const accepted = priceOf(vehicle({ ...oneValve.slots[0], qaLevel: 'acceptance' }));
    expect(uncertainty(accepted)).toBeLessThan(uncertainty(series));
    expect(uncertainty(accepted)).toBeGreaterThan(0);
  });

  it('lowers the risk for a second unit, and charges its mass', () => {
    const single = priceOf(oneValve);
    const redundant = priceOf(vehicle({ ...oneValve.slots[0], units: 2 }));

    expect(headlineRisk(redundant)).toBeLessThan(headlineRisk(single));
    expect(redundant.mass_kg).toBe(single.mass_kg * 2);
    expect(redundant.cost).toBe(single.cost * 2);
  });

  it('gives a redundant pair two different parts, not the same draw twice', () => {
    // Redundancy that duplicated one unit's reliability would be worth nothing
    // and would look like it was worth something.
    const built = buildVehicle(vehicle({ ...oneValve.slots[0], units: 2 }), qaLevels, 42);
    const [first, second] = built.slots[0].units;
    expect(first.serialNo).not.toBe(second.serialNo);
    expect(first.effectiveReliability).not.toBe(second.effectiveReliability);
  });

  it('prices a longer mission higher on the same hardware', () => {
    const short = computeRiskBudget(buildVehicle(oneValve, qaLevels, 42), phaseExposure, 300);
    const long = computeRiskBudget(buildVehicle(oneValve, qaLevels, 42), phaseExposure, 900);
    expect(headlineRisk(long)).toBeGreaterThan(headlineRisk(short));
  });

  it('weights a system by how much of the mission stresses it', () => {
    // Propulsion is under load for the whole ascent; the transmitter is not.
    // Same band, different exposure, so the lines must differ.
    const prop = priceOf(
      vehicle({ slotId: 's', partId: 'part_feed_line', qaLevel: 'series', units: 1 }),
    );
    const comms = priceOf(
      vehicle({ slotId: 's', partId: 'part_telemetry_tx', qaLevel: 'series', units: 1 }),
    );
    expect(headlineRisk(prop)).toBeGreaterThan(headlineRisk(comms));
  });

  it('sorts the lines worst first, so the thing to fix is on top', () => {
    const budget = priceOf(
      vehicle(
        { slotId: 'a', partId: 'part_telemetry_tx', qaLevel: 'series', units: 1 },
        { slotId: 'b', partId: 'part_feed_line', qaLevel: 'series', units: 1 },
      ),
    );
    expect(budget.lines[0].contribution[1]).toBeGreaterThanOrEqual(budget.lines[1].contribution[1]);
  });

  it('never reports a probability outside zero and one', () => {
    const everything = priceOf(
      vehicle(
        { slotId: 'a', partId: 'part_main_valve', qaLevel: 'series', units: 1 },
        { slotId: 'b', partId: 'part_feed_line', qaLevel: 'series', units: 1 },
        { slotId: 'c', partId: 'part_pressure_sensor', qaLevel: 'series', units: 1 },
        { slotId: 'd', partId: 'part_power_bus', qaLevel: 'series', units: 1 },
        { slotId: 'e', partId: 'part_telemetry_tx', qaLevel: 'series', units: 1 },
      ),
    );
    for (const end of everything.lossOfMission) {
      expect(end).toBeGreaterThanOrEqual(0);
      expect(end).toBeLessThanOrEqual(1);
    }
    expect(everything.lossOfMission[0]).toBeLessThanOrEqual(everything.lossOfMission[1]);
  });

  it('does not leak the value it is not showing', () => {
    // The budget is computed from the visible band. Two campaigns whose parts
    // draw differently but are bought the same way must price the same, or the
    // number is telling the player something they did not pay for.
    expect(priceOf(oneValve, 42).lossOfMission).toEqual(priceOf(oneValve, 43).lossOfMission);
  });
});

describe('the vehicle the configurator edits', () => {
  it('charges the longest build on the critical path, not the sum', () => {
    const mixed = vehicle(
      { slotId: 'a', partId: 'part_main_valve', qaLevel: 'qualification', units: 1 },
      { slotId: 'b', partId: 'part_feed_line', qaLevel: 'acceptance', units: 1 },
    );
    expect(buildDays(mixed, qaLevels)).toBe(qaLevels.qualification.buildDays);
  });

  it('names exactly the slots a re-plan touched', () => {
    // §5.4's surgical re-roll depends on this and nothing else.
    const before = vehicle(
      { slotId: 'a', partId: 'part_main_valve', qaLevel: 'series', units: 1 },
      { slotId: 'b', partId: 'part_feed_line', qaLevel: 'series', units: 1 },
    );
    expect(changedSlots(before, before)).toEqual([]);

    const qaChanged = vehicle({ ...before.slots[0], qaLevel: 'acceptance' }, before.slots[1]);
    expect(changedSlots(before, qaChanged)).toEqual(['a']);

    const redundancyChanged = vehicle(before.slots[0], { ...before.slots[1], units: 2 });
    expect(changedSlots(before, redundancyChanged)).toEqual(['b']);

    const dropped = vehicle(before.slots[0]);
    expect(changedSlots(before, dropped)).toEqual(['b']);

    const added = vehicle(...before.slots, {
      slotId: 'c',
      partId: 'part_power_bus',
      qaLevel: 'series',
      units: 1,
    });
    expect(changedSlots(before, added)).toEqual(['c']);
  });
});
