/**
 * Kepler mechanics.
 *
 * The load-bearing property is the round trip: state vector → elements →
 * state vector must return what it was given. If that holds, the coast phase
 * can be evaluated in closed form at any t without drifting away from the
 * numerically integrated ascent that produced the state.
 */
import { describe, expect, it } from 'vitest';

import { TAU, cos, sin } from '../math.js';

import { EARTH_RADIUS_M, MU_EARTH } from './constants.js';
import {
  apoapsisRadius_m,
  elementsToState,
  isElliptical,
  normalizeAngle,
  orbitalPeriod_s,
  periapsisRadius_m,
  propagate,
  solveEccentricAnomaly,
  stateToElements,
  type Vec2,
} from './kepler.js';

/** A circular orbit at the given altitude, moving counter-clockwise. */
function circularOrbit(altitude_m: number): { position: Vec2; velocity: Vec2 } {
  const r = EARTH_RADIUS_M + altitude_m;
  return { position: { x: r, y: 0 }, velocity: { x: 0, y: Math.sqrt(MU_EARTH / r) } };
}

describe('normalizeAngle', () => {
  it('wraps into [0, 2π)', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(TAU)).toBe(0);
    expect(normalizeAngle(-1)).toBeCloseTo(TAU - 1, 12);
    expect(normalizeAngle(TAU * 3 + 1)).toBeCloseTo(1, 12);
    for (const angle of [-100, -7.5, -0.001, 0, 0.001, 7.5, 100, 1e6]) {
      const wrapped = normalizeAngle(angle);
      expect(wrapped).toBeGreaterThanOrEqual(0);
      expect(wrapped).toBeLessThan(TAU);
    }
  });
});

describe("Kepler's equation", () => {
  it('inverts M = E - e·sin(E)', () => {
    for (const e of [0, 0.01, 0.1, 0.3, 0.6, 0.9]) {
      for (let i = 0; i < 32; i++) {
        const meanAnomaly = (TAU * i) / 32;
        const eccentric = solveEccentricAnomaly(meanAnomaly, e);
        const recovered = normalizeAngle(eccentric - e * sin(eccentric));
        expect(recovered).toBeCloseTo(normalizeAngle(meanAnomaly), 10);
      }
    }
  });

  it('is exact at the apsides for any eccentricity', () => {
    for (const e of [0, 0.2, 0.5, 0.85]) {
      expect(solveEccentricAnomaly(0, e)).toBeCloseTo(0, 12);
      expect(solveEccentricAnomaly(Math.PI, e)).toBeCloseTo(Math.PI, 10);
    }
  });
});

describe('state vector round trip', () => {
  it('returns a circular orbit unchanged', () => {
    const { position, velocity } = circularOrbit(300000);
    const elements = stateToElements(position, velocity, MU_EARTH);
    const back = elementsToState(elements, MU_EARTH);

    expect(back.position.x).toBeCloseTo(position.x, 5);
    expect(back.position.y).toBeCloseTo(position.y, 5);
    expect(back.velocity.x).toBeCloseTo(velocity.x, 8);
    expect(back.velocity.y).toBeCloseTo(velocity.y, 8);
    expect(elements.eccentricity).toBeCloseTo(0, 12);
  });

  it('returns eccentric orbits unchanged, in both directions of travel', () => {
    const r = EARTH_RADIUS_M + 250000;
    const circular = Math.sqrt(MU_EARTH / r);

    for (const direction of [1, -1]) {
      for (const speedFactor of [0.95, 1.05, 1.2]) {
        for (const angle of [0, 0.7, 2.4, 5.1]) {
          const position: Vec2 = { x: r * cos(angle), y: r * sin(angle) };
          const speed = circular * speedFactor;
          // Velocity perpendicular to the radius, sense set by `direction`.
          const velocity: Vec2 = {
            x: -speed * sin(angle) * direction,
            y: speed * cos(angle) * direction,
          };

          const elements = stateToElements(position, velocity, MU_EARTH);
          const back = elementsToState(elements, MU_EARTH);

          expect(back.position.x / position.x).toBeCloseTo(1, 8);
          expect(back.position.y - position.y).toBeCloseTo(0, 2);
          expect(back.velocity.x - velocity.x).toBeCloseTo(0, 5);
          expect(back.velocity.y - velocity.y).toBeCloseTo(0, 5);
          expect(elements.direction).toBe(direction);
        }
      }
    }
  });
});

describe('propagation', () => {
  it('returns to the start after exactly one period', () => {
    const { position, velocity } = circularOrbit(400000);
    const elements = stateToElements(position, velocity, MU_EARTH);
    const period = orbitalPeriod_s(elements, MU_EARTH);

    const after = elementsToState(propagate(elements, period, MU_EARTH), MU_EARTH);
    expect(after.position.x).toBeCloseTo(position.x, 3);
    expect(after.position.y).toBeCloseTo(position.y, 3);
  });

  it('is halfway round after half a period', () => {
    const { position, velocity } = circularOrbit(400000);
    const elements = stateToElements(position, velocity, MU_EARTH);
    const period = orbitalPeriod_s(elements, MU_EARTH);

    const after = elementsToState(propagate(elements, period / 2, MU_EARTH), MU_EARTH);
    expect(after.position.x).toBeCloseTo(-position.x, 3);
    expect(after.position.y).toBeCloseTo(-position.y, 3);
  });

  it('conserves the orbit shape over many revolutions', () => {
    // This is why coast uses closed form: a hundred orbits cost no accuracy.
    const r = EARTH_RADIUS_M + 250000;
    const position: Vec2 = { x: r, y: 0 };
    const velocity: Vec2 = { x: 0, y: Math.sqrt(MU_EARTH / r) * 1.1 };
    const elements = stateToElements(position, velocity, MU_EARTH);

    const later = propagate(elements, orbitalPeriod_s(elements, MU_EARTH) * 100, MU_EARTH);
    expect(later.semiMajorAxis_m).toBe(elements.semiMajorAxis_m);
    expect(later.eccentricity).toBe(elements.eccentricity);
    expect(periapsisRadius_m(later)).toBe(periapsisRadius_m(elements));
  });

  it('matches a known LEO period', () => {
    // A 400 km circular orbit takes about 92.6 minutes.
    const { position, velocity } = circularOrbit(400000);
    const elements = stateToElements(position, velocity, MU_EARTH);
    expect(orbitalPeriod_s(elements, MU_EARTH) / 60).toBeCloseTo(92.56, 1);
  });
});

describe('orbit geometry', () => {
  it('reports apsides consistent with the state it came from', () => {
    const r = EARTH_RADIUS_M + 200000;
    const position: Vec2 = { x: r, y: 0 };
    const velocity: Vec2 = { x: 0, y: Math.sqrt(MU_EARTH / r) * 1.15 };
    const elements = stateToElements(position, velocity, MU_EARTH);

    // Burning prograde at periapsis raises the apoapsis and leaves periapsis put.
    expect(periapsisRadius_m(elements)).toBeCloseTo(r, 3);
    expect(apoapsisRadius_m(elements)).toBeGreaterThan(r);
    expect(isElliptical(elements)).toBe(true);
  });

  it('recognises an escape trajectory as not elliptical', () => {
    const r = EARTH_RADIUS_M + 200000;
    const escapeSpeed = Math.sqrt((2 * MU_EARTH) / r);
    const elements = stateToElements(
      { x: r, y: 0 },
      { x: 0, y: escapeSpeed * 1.05 },
      MU_EARTH,
    );
    expect(isElliptical(elements)).toBe(false);
  });
});
