/**
 * The powered ascent.
 *
 * The last test flies the shipped vehicle with the shipped pitch program and
 * asserts it reaches orbit. That is the test that turns `data/*.json` from
 * loose numbers into a contract: retune the rocket into something that cannot
 * fly, and the build says so.
 */
import { describe, expect, it } from 'vitest';

import pitchData from '../../data/pitchProgram.json' with { type: 'json' };
import rocketData from '../../data/rocket.json' with { type: 'json' };
import { PI } from '../math.js';

import {
  accelerationAt,
  altitudeOf,
  densityAt,
  environmentAt,
  integrate,
  pressureAt,
  sensedG,
  thrustDirection,
} from './ascent.js';
import { type PitchProgram, pitchAt } from './ascentProgram.js';
import {
  ATMOSPHERE_TOP_M,
  EARTH_RADIUS_M,
  MU_EARTH,
  SEA_LEVEL_DENSITY,
  SEA_LEVEL_PRESSURE,
  STANDARD_GRAVITY,
} from './constants.js';
import { apoapsisRadius_m, periapsisRadius_m, stateToElements, type Vec2 } from './kepler.js';
import { type RocketDef, ispAt, massFlowRate, thrustAt, vehicleMass_kg } from './thrust.js';

const rocket = rocketData as RocketDef;
const pitchProgram = pitchData as PitchProgram;

describe('atmosphere', () => {
  it('starts at sea-level density and pressure', () => {
    expect(densityAt(0)).toBe(SEA_LEVEL_DENSITY);
    expect(pressureAt(0)).toBe(SEA_LEVEL_PRESSURE);
  });

  it('falls off exponentially', () => {
    // One scale height must cut density to 1/e.
    expect(densityAt(8500) / SEA_LEVEL_DENSITY).toBeCloseTo(1 / Math.E, 9);
    expect(densityAt(20000)).toBeLessThan(densityAt(10000));
  });

  it('is vacuum above the modelled top', () => {
    expect(densityAt(ATMOSPHERE_TOP_M)).toBe(0);
    expect(pressureAt(ATMOSPHERE_TOP_M + 1000)).toBe(0);
  });

  it('reports dynamic pressure from density and speed', () => {
    const environment = environmentAt({ x: EARTH_RADIUS_M + 10000, y: 0 }, { x: 0, y: 300 });
    expect(environment.dynamicPressure_Pa).toBeCloseTo(
      0.5 * densityAt(10000) * 300 * 300,
      6,
    );
  });
});

describe('thrust direction', () => {
  const launchPad: Vec2 = { x: EARTH_RADIUS_M, y: 0 };

  it('points straight up at 90° pitch', () => {
    const direction = thrustDirection(launchPad, PI / 2, 1);
    expect(direction.x).toBeCloseTo(1, 12);
    expect(direction.y).toBeCloseTo(0, 12);
  });

  it('points downrange at 0° pitch', () => {
    const direction = thrustDirection(launchPad, 0, 1);
    expect(direction.x).toBeCloseTo(0, 12);
    expect(direction.y).toBeCloseTo(1, 12);
  });

  it('mirrors downrange for a retrograde launch', () => {
    expect(thrustDirection(launchPad, 0, -1).y).toBeCloseTo(-1, 12);
  });

  it('stays a unit vector', () => {
    for (const pitch of [0, 0.3, 1, PI / 2]) {
      const direction = thrustDirection({ x: 0, y: EARTH_RADIUS_M }, pitch, 1);
      expect(Math.sqrt(direction.x * direction.x + direction.y * direction.y)).toBeCloseTo(1, 12);
    }
  });
});

describe('accelerations', () => {
  const vacuumPosition: Vec2 = { x: EARTH_RADIUS_M + 500000, y: 0 };

  it('is pure gravity when coasting in vacuum', () => {
    const velocity: Vec2 = { x: 0, y: 0 };
    const acceleration = accelerationAt({
      position: vacuumPosition,
      velocity,
      mass_kg: 5000,
      thrust_N: 0,
      thrustDirection: { x: 1, y: 0 },
      dragCoefficient: rocket.dragCoefficient,
      referenceArea_m2: rocket.referenceArea_m2,
      environment: environmentAt(vacuumPosition, velocity),
    });
    const r = vacuumPosition.x;
    expect(acceleration.x).toBeCloseTo(-MU_EARTH / (r * r), 9);
    // Zero, but IEEE gives it a sign here: a negative factor times +0 is -0.
    // Physics is not the place to scrub that — the canonical state encoder
    // normalises signed zero before hashing, so it cannot reach a replay hash.
    expect(Math.abs(acceleration.y)).toBe(0);
  });

  it('opposes drag to the velocity vector', () => {
    const position: Vec2 = { x: EARTH_RADIUS_M + 5000, y: 0 };
    const velocity: Vec2 = { x: 0, y: 400 };
    const acceleration = accelerationAt({
      position,
      velocity,
      mass_kg: 50000,
      thrust_N: 0,
      thrustDirection: { x: 1, y: 0 },
      dragCoefficient: rocket.dragCoefficient,
      referenceArea_m2: rocket.referenceArea_m2,
      environment: environmentAt(position, velocity),
    });
    // Motion is +y, so drag must push -y.
    expect(acceleration.y).toBeLessThan(0);
  });

  it('adds thrust along the commanded direction', () => {
    const velocity: Vec2 = { x: 0, y: 0 };
    const withoutThrust = accelerationAt({
      position: vacuumPosition,
      velocity,
      mass_kg: 5000,
      thrust_N: 0,
      thrustDirection: { x: 1, y: 0 },
      dragCoefficient: 0,
      referenceArea_m2: 0,
      environment: environmentAt(vacuumPosition, velocity),
    });
    const withThrust = accelerationAt({
      position: vacuumPosition,
      velocity,
      mass_kg: 5000,
      thrust_N: 50000,
      thrustDirection: { x: 1, y: 0 },
      dragCoefficient: 0,
      referenceArea_m2: 0,
      environment: environmentAt(vacuumPosition, velocity),
    });
    expect(withThrust.x - withoutThrust.x).toBeCloseTo(50000 / 5000, 9);
  });

  it('reports sensed G from thrust, not from gravity', () => {
    // In free fall the crew feels nothing, however hard gravity pulls.
    expect(sensedG(0, 0, 5000)).toBe(0);
    expect(sensedG(50000, 0, 5000)).toBeCloseTo(10 / STANDARD_GRAVITY, 9);
  });
});

describe('integration step', () => {
  it('applies the new velocity to the position', () => {
    const result = integrate({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 2, y: 0 }, 0.5);
    // Semi-implicit: velocity updates first (10 + 2·0.5 = 11), then moves the position.
    expect(result.velocity.x).toBe(11);
    expect(result.position.x).toBe(5.5);
  });
});

interface FlightResult {
  time_s: number;
  maxDynamicPressure_Pa: number;
  maxDynamicPressureTime_s: number;
  maxG: number;
  mecoTime_s: number;
  secoTime_s: number;
  periapsisAltitude_m: number;
  apoapsisAltitude_m: number;
  eccentricity: number;
  impacted: boolean;
}

/** Flies the shipped vehicle to depletion using only the physics primitives. */
function flyAscent(dt_s: number): FlightResult {
  let position: Vec2 = { x: EARTH_RADIUS_M, y: 0 };
  let velocity: Vec2 = { x: 0, y: 0 };
  let stageIndex = 0;
  let propellant = rocket.stages[0].propellantMass_kg;
  let time = 0;

  let maxQ = 0;
  let maxQTime = 0;
  let maxG = 0;
  let meco = -1;
  let seco = -1;
  let impacted = false;

  const maxSteps = Math.ceil(900 / dt_s);
  for (let step = 0; step < maxSteps; step++) {
    const environment = environmentAt(position, velocity);
    const stage = rocket.stages[stageIndex];

    let thrust = 0;
    if (propellant > 0) {
      thrust = thrustAt(stage, environment.pressure_Pa);
      propellant -= massFlowRate(thrust, ispAt(stage, environment.pressure_Pa)) * dt_s;
      if (propellant <= 0) {
        propellant = 0;
        if (stageIndex === 0) meco = time;
        else seco = time;
      }
    }

    const mass = vehicleMass_kg(rocket, stageIndex, propellant);
    const acceleration = accelerationAt({
      position,
      velocity,
      mass_kg: mass,
      thrust_N: thrust,
      thrustDirection: thrustDirection(position, pitchAt(pitchProgram, time), 1),
      dragCoefficient: rocket.dragCoefficient,
      referenceArea_m2: rocket.referenceArea_m2,
      environment,
    });

    if (environment.dynamicPressure_Pa > maxQ) {
      maxQ = environment.dynamicPressure_Pa;
      maxQTime = time;
    }
    if (thrust > 0) {
      const g = Math.sqrt(acceleration.x * acceleration.x + acceleration.y * acceleration.y);
      if (g / STANDARD_GRAVITY > maxG) maxG = g / STANDARD_GRAVITY;
    }

    const next = integrate(position, velocity, acceleration, dt_s);
    position = next.position;
    velocity = next.velocity;
    time += dt_s;

    if (propellant === 0 && stageIndex === 0) {
      stageIndex = 1;
      propellant = rocket.stages[1].propellantMass_kg;
    }

    if (altitudeOf(position) < 0) {
      impacted = true;
      break;
    }
    if (stageIndex === rocket.stages.length - 1 && propellant === 0) break;
  }

  const elements = stateToElements(position, velocity, MU_EARTH);
  return {
    time_s: time,
    maxDynamicPressure_Pa: maxQ,
    maxDynamicPressureTime_s: maxQTime,
    maxG,
    mecoTime_s: meco,
    secoTime_s: seco,
    periapsisAltitude_m: periapsisRadius_m(elements) - EARTH_RADIUS_M,
    apoapsisAltitude_m: apoapsisRadius_m(elements) - EARTH_RADIUS_M,
    eccentricity: elements.eccentricity,
    impacted,
  };
}

describe('the shipped ascent reaches orbit', () => {
  const flight = flyAscent(0.05);

  it('does not fall back into the atmosphere', () => {
    expect(flight.impacted).toBe(false);
  });

  it('stages in the right order and at a plausible time', () => {
    expect(flight.mecoTime_s).toBeGreaterThan(120);
    expect(flight.mecoTime_s).toBeLessThan(200);
    expect(flight.secoTime_s).toBeGreaterThan(flight.mecoTime_s);
  });

  it('passes max-Q inside the structural limit', () => {
    expect(flight.maxDynamicPressure_Pa).toBeLessThan(rocket.maxDynamicPressure_Pa);
    // It should still get close — a vehicle that never loads its structure has
    // been detuned into something with no drama.
    expect(flight.maxDynamicPressure_Pa).toBeGreaterThan(rocket.maxDynamicPressure_Pa * 0.8);
    expect(flight.maxDynamicPressureTime_s).toBeGreaterThan(40);
    expect(flight.maxDynamicPressureTime_s).toBeLessThan(110);
  });

  it('keeps acceleration survivable', () => {
    expect(flight.maxG).toBeGreaterThan(3);
    expect(flight.maxG).toBeLessThan(6);
  });

  it('ends in a closed orbit above the atmosphere', () => {
    expect(flight.periapsisAltitude_m).toBeGreaterThan(rocket.targetOrbit.periapsisAltitude_m);
    expect(flight.eccentricity).toBeLessThan(0.1);
    expect(flight.apoapsisAltitude_m).toBeGreaterThan(flight.periapsisAltitude_m);
  });

  it('reaches orbital velocity', () => {
    // Concept §3 puts LEO at about 7.78 km/s.
    const r = EARTH_RADIUS_M + flight.periapsisAltitude_m;
    expect(Math.sqrt(MU_EARTH / r)).toBeGreaterThan(7500);
  });

  it('is insensitive to the integration step, so DT is not load-bearing', () => {
    // If halving DT moved the outcome much, the profile would be an artefact
    // of the step size rather than of the physics.
    const finer = flyAscent(0.025);
    expect(finer.periapsisAltitude_m / flight.periapsisAltitude_m).toBeCloseTo(1, 1);
    expect(finer.mecoTime_s).toBeCloseTo(flight.mecoTime_s, 0);
  });
});
