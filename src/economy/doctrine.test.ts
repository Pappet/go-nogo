/**
 * Doctrines (§6.1).
 *
 * Phase 2's Definition of Done is that two campaigns feel different after
 * three hours rather than being repainted. That is not a thing a test can
 * check — but "the same vehicle costs different money and some of it is
 * forbidden outright" is, and it is the mechanism the feeling has to come
 * from. If these pass and the campaigns still feel identical, the numbers are
 * too timid; if they fail, no amount of flavour text will save it.
 */
import { describe, expect, it } from 'vitest';

import { doctrineById, doctrines, partDef, qaLevels } from '../missionConfig.js';
import { QA_LEVELS } from '../sim/parts/partInstance.js';

import { MARKETS, adjustReputation, createCampaign, nextMissionKey } from './campaign.js';
import { type DoctrineDef, nearestAllowedQa, qaLocked, unitCost } from './doctrine.js';
import { type VehicleConfig, buildVehicle } from './vehicle.js';

const vehicle: VehicleConfig = {
  slots: [
    { slotId: 'a', partId: 'part_main_valve', qaLevel: 'acceptance', units: 1 },
    { slotId: 'b', partId: 'part_pressure_sensor', qaLevel: 'acceptance', units: 1 },
  ],
};

const costUnder = (doctrineId: string): number =>
  buildVehicle(vehicle, qaLevels, 42, doctrineById(doctrineId)).cost;

describe('a doctrine is a shape, not a discount', () => {
  it('prices the same vehicle differently under each doctrine', () => {
    const prices = doctrines.map((doctrine) => costUnder(doctrine.id));
    expect(new Set(prices).size).toBe(doctrines.length);
  });

  it('makes mass-and-volume cheap on propulsion and precision cheap on avionics', () => {
    const mass = doctrineById('doctrine_mass_volume');
    const precision = doctrineById('doctrine_precision');
    const valve = partDef('part_main_valve');
    const sensor = partDef('part_pressure_sensor');

    expect(unitCost(mass, valve.cost, valve.system, 1)).toBeLessThan(
      unitCost(precision, valve.cost, valve.system, 1),
    );
    expect(unitCost(precision, sensor.cost, sensor.system, 1)).toBeLessThan(
      unitCost(mass, sensor.cost, sensor.system, 1),
    );
  });

  it('keeps the hardware discount and the testing discount separate', () => {
    // A doctrine that makes testing cheap must not thereby discount the
    // hardware, or every doctrine collapses into "things cost less" and the
    // choice stops being a shape. Two doctrines differing only in what testing
    // costs must price an untested part identically and a tested one apart.
    const base = doctrineById('doctrine_science');
    const cheapTesting: DoctrineDef = { ...base, qaCostMultiplier: 0.5 };
    const dearTesting: DoctrineDef = { ...base, qaCostMultiplier: 1.5 };

    expect(unitCost(cheapTesting, 100, 'prop', 1)).toBe(unitCost(dearTesting, 100, 'prop', 1));
    expect(unitCost(cheapTesting, 100, 'prop', 1.8)).toBeLessThan(
      unitCost(dearTesting, 100, 'prop', 1.8),
    );
  });

  it('charges more for more testing, under every doctrine', () => {
    for (const doctrine of doctrines) {
      const series = unitCost(doctrine, 100, 'prop', qaLevels.series.costMultiplier);
      const accepted = unitCost(doctrine, 100, 'prop', qaLevels.acceptance.costMultiplier);
      const qualified = unitCost(doctrine, 100, 'prop', qaLevels.qualification.costMultiplier);
      expect(accepted).toBeGreaterThan(series);
      expect(qualified).toBeGreaterThan(accepted);
    }
  });

  it('forbids a level outright rather than pricing it out of reach', () => {
    // §6.1: precision locks series production, mass-and-volume locks hot fire.
    expect(qaLocked(doctrineById('doctrine_precision'), 'series')).toBe(true);
    expect(qaLocked(doctrineById('doctrine_mass_volume'), 'qualification')).toBe(true);
    expect(qaLocked(doctrineById('doctrine_science'), 'series')).toBe(false);
  });

  it('gives every doctrine somewhere to go when a level is locked', () => {
    for (const doctrine of doctrines) {
      for (const level of QA_LEVELS) {
        const fallback = nearestAllowedQa(doctrine, level, QA_LEVELS);
        expect(qaLocked(doctrine, fallback)).toBe(false);
        if (!qaLocked(doctrine, level)) expect(fallback).toBe(level);
      }
    }
  });

  it('starts each doctrine somewhere different, in money and in standing', () => {
    const capitals = doctrines.map((doctrine) => doctrine.startingCapital);
    expect(new Set(capitals).size).toBe(doctrines.length);
    // §6.1: science starts with commercial reputation in the red.
    expect(doctrineById('doctrine_science').startingReputation.commercial).toBeLessThan(0);
    expect(doctrineById('doctrine_science').startingCapital).toBeLessThan(
      doctrineById('doctrine_mass_volume').startingCapital,
    );
  });
});

describe('a campaign carries what survives a mission', () => {
  const campaign = createCampaign(doctrineById('doctrine_precision'), 42, vehicle);

  it('derives the mission key from what has been flown', () => {
    // Stored separately, the two could drift — and a drifted key silently
    // re-rolls a crisis.
    expect(nextMissionKey(campaign)).toBe('doctrine_precision/mission-1');
    expect(nextMissionKey({ ...campaign, missionsFlown: 4 })).toBe(
      'doctrine_precision/mission-5',
    );
  });

  it('keeps reputation inside its bounds in both directions', () => {
    const fresh = createCampaign(doctrineById('doctrine_science'), 42, vehicle);
    for (const market of MARKETS) {
      adjustReputation(fresh, market, 1000);
      expect(fresh.reputation[market]).toBe(100);
      adjustReputation(fresh, market, -1000);
      expect(fresh.reputation[market]).toBe(-50);
    }
  });

  it('does not share reputation between markets', () => {
    const fresh = createCampaign(doctrineById('doctrine_precision'), 42, vehicle);
    const before = fresh.reputation.science;
    adjustReputation(fresh, 'government', 10);
    expect(fresh.reputation.science).toBe(before);
  });
});
