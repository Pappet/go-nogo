import { describe, expect, it } from 'vitest';

import rocketData from '../../data/rocket.json' with { type: 'json' };

import { SEA_LEVEL_PRESSURE, STANDARD_GRAVITY } from './constants.js';
import {
  type RocketDef,
  deltaV_ms,
  ispAt,
  massFlowRate,
  stageBurnTime_s,
  stageDeltaV_ms,
  thrustAt,
  validateRocket,
  vehicleMass_kg,
} from './thrust.js';

const rocket = rocketData as RocketDef;
const stage1 = rocket.stages[0];
const stage2 = rocket.stages[1];

describe('engine performance', () => {
  it('gives the sea-level figures at sea level and the vacuum figures in vacuum', () => {
    expect(thrustAt(stage1, SEA_LEVEL_PRESSURE)).toBe(stage1.thrustSeaLevel_N);
    expect(thrustAt(stage1, 0)).toBe(stage1.thrustVacuum_N);
    expect(ispAt(stage1, SEA_LEVEL_PRESSURE)).toBe(stage1.ispSeaLevel_s);
    expect(ispAt(stage1, 0)).toBe(stage1.ispVacuum_s);
  });

  it('interpolates in between, so the first stage gains thrust as it climbs', () => {
    const half = thrustAt(stage1, SEA_LEVEL_PRESSURE / 2);
    expect(half).toBeGreaterThan(stage1.thrustSeaLevel_N);
    expect(half).toBeLessThan(stage1.thrustVacuum_N);
    expect(half).toBeCloseTo((stage1.thrustSeaLevel_N + stage1.thrustVacuum_N) / 2, 6);
  });

  it('clamps above sea-level pressure instead of extrapolating', () => {
    expect(thrustAt(stage1, SEA_LEVEL_PRESSURE * 5)).toBe(stage1.thrustSeaLevel_N);
  });

  it('derives mass flow from thrust and Isp', () => {
    const flow = massFlowRate(1000000, 300);
    expect(flow).toBeCloseTo(1000000 / (300 * STANDARD_GRAVITY), 9);
  });
});

describe('vehicle mass', () => {
  it('counts every stage still attached', () => {
    const full = vehicleMass_kg(rocket, 0, stage1.propellantMass_kg);
    const expected =
      rocket.payloadMass_kg +
      stage1.dryMass_kg +
      stage1.propellantMass_kg +
      stage2.dryMass_kg +
      stage2.propellantMass_kg;
    expect(full).toBe(expected);
  });

  it('drops the spent stage after separation', () => {
    const beforeSeparation = vehicleMass_kg(rocket, 0, 0);
    const afterSeparation = vehicleMass_kg(rocket, 1, stage2.propellantMass_kg);
    expect(beforeSeparation - afterSeparation).toBe(stage1.dryMass_kg);
  });

  it('ends at payload plus the last dry stage', () => {
    expect(vehicleMass_kg(rocket, 1, 0)).toBe(rocket.payloadMass_kg + stage2.dryMass_kg);
  });
});

describe('Tsiolkovsky', () => {
  it('matches the textbook figure for a mass ratio of e', () => {
    // ln(e) = 1, so Δv is exactly the exhaust velocity.
    const isp = 300;
    expect(deltaV_ms(isp, Math.E, 1)).toBeCloseTo(isp * STANDARD_GRAVITY, 9);
  });

  it('gives zero for a burn that consumes nothing', () => {
    expect(deltaV_ms(300, 1000, 1000)).toBe(0);
  });
});

describe('the shipped vehicle', () => {
  it('passes validation', () => {
    expect(() => validateRocket(rocket)).not.toThrow();
  });

  it('carries the Δv budget the concept calls for', () => {
    // Concept §3: 9.3–9.5 km/s to LEO. Stage 1 is evaluated at a representative
    // mid-atmosphere pressure rather than at sea level, where it never spends
    // its whole burn.
    const stage1DeltaV = stageDeltaV_ms(rocket, 0, SEA_LEVEL_PRESSURE * 0.35);
    const stage2DeltaV = stageDeltaV_ms(rocket, 1, 0);
    const total = stage1DeltaV + stage2DeltaV;

    expect(total / 1000).toBeGreaterThan(9.3);
    expect(total / 1000).toBeLessThan(9.5);
  });

  it('lifts off — thrust to weight above one', () => {
    const liftoffMass = vehicleMass_kg(rocket, 0, stage1.propellantMass_kg);
    const twr = stage1.thrustSeaLevel_N / (liftoffMass * STANDARD_GRAVITY);
    expect(twr).toBeGreaterThan(1.2);
    expect(twr).toBeLessThan(1.6);
  });

  it('burns for a plausible time', () => {
    expect(stageBurnTime_s(stage1, SEA_LEVEL_PRESSURE)).toBeGreaterThan(120);
    expect(stageBurnTime_s(stage1, SEA_LEVEL_PRESSURE)).toBeLessThan(200);
    expect(stageBurnTime_s(stage2, 0)).toBeGreaterThan(200);
    expect(stageBurnTime_s(stage2, 0)).toBeLessThan(400);
  });
});

describe('validation', () => {
  it('rejects a rocket with no stages', () => {
    expect(() => validateRocket({ ...rocket, stages: [] })).toThrow(/no stages/);
  });

  it('rejects non-positive masses and Isp', () => {
    expect(() =>
      validateRocket({ ...rocket, stages: [{ ...stage1, dryMass_kg: 0 }] }),
    ).toThrow(/non-positive mass/);
    expect(() =>
      validateRocket({ ...rocket, stages: [{ ...stage1, ispVacuum_s: -1 }] }),
    ).toThrow(/non-positive Isp/);
  });
});
