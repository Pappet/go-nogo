import { describe, expect, it } from 'vitest';

import pitchData from '../data/pitchProgram.json' with { type: 'json' };
import rocketData from '../data/rocket.json' with { type: 'json' };

import { Engine } from './engine.js';
import {
  canCoastNow,
  createFlightSimulation,
  createFlightState,
  isThrusting,
  missionTime_s,
  positionOf,
  velocityOf,
} from './flight.js';
import { altitudeOf } from './physics/ascent.js';
import type { PitchProgram } from './physics/ascentProgram.js';
import { ATMOSPHERE_TOP_M, EARTH_RADIUS_M, MU_EARTH } from './physics/constants.js';
import { periapsisRadius_m, stateToElements } from './physics/kepler.js';
import type { RocketDef } from './physics/thrust.js';

const rocket = rocketData as RocketDef;
const config = { rocket, pitchProgram: pitchData as PitchProgram };

function createEngine(): Engine<ReturnType<typeof createFlightState>> {
  return new Engine(createFlightSimulation(config), createFlightState());
}

describe('on the pad', () => {
  it('does not move before ignition', () => {
    const engine = createEngine();
    engine.runTicks(600);
    expect(engine.state.positionX).toBe(EARTH_RADIUS_M);
    expect(engine.state.positionY).toBe(0);
    expect(engine.state.velocityX).toBe(0);
    expect(altitudeOf(positionOf(engine.state))).toBe(0);
  });

  it('does not fall through the pad under gravity', () => {
    // The hold-down clamps carry the weight; integrating gravity here would
    // sink the vehicle into the ground before the count reached zero.
    const engine = createEngine();
    engine.runTicks(2000);
    expect(engine.state.velocityY).toBe(0);
  });

  it('cannot coast while still on the pad', () => {
    expect(canCoastNow(createFlightState())).toBe(false);
  });

  it('reports mission time from liftoff, not from tick zero', () => {
    const engine = createEngine();
    engine.runTicks(100);
    engine.submit('ignite', null);
    engine.runTicks(40);
    // Ignition landed at tick 100, and 40 ticks of 50 ms have run since.
    expect(missionTime_s(engine.state)).toBeCloseTo(2, 9);
  });
});

describe('ignition and ascent', () => {
  it('loads the first stage and starts climbing', () => {
    const engine = createEngine();
    engine.submit('ignite', null);
    engine.runTicks(200);

    expect(engine.state.ignited).toBe(true);
    expect(engine.state.propellantRemaining_kg).toBeGreaterThan(0);
    expect(engine.state.propellantRemaining_kg).toBeLessThan(
      rocket.stages[0].propellantMass_kg,
    );
    expect(altitudeOf(positionOf(engine.state))).toBeGreaterThan(0);
    expect(isThrusting(engine.state)).toBe(true);
  });

  it('ignores a second ignition command', () => {
    const engine = createEngine();
    engine.submit('ignite', null);
    engine.runTicks(100);
    const propellantAfterFirst = engine.state.propellantRemaining_kg;
    engine.submit('ignite', null);
    engine.runTicks(1);
    // A duplicate must not refill the tanks.
    expect(engine.state.propellantRemaining_kg).toBeLessThan(propellantAfterFirst);
    expect(engine.state.liftoffTick).toBe(0);
  });

  it('stages when the first stage runs dry', () => {
    const engine = createEngine();
    engine.submit('ignite', null);
    engine.runTicks(4000); // past MECO at about T+146 s

    expect(engine.state.separated).toBe(true);
    expect(engine.state.stageIndex).toBe(1);
    expect(engine.state.propellantRemaining_kg).toBeGreaterThan(0);
  });

  it('shuts the upper stage down on reaching the target orbit', () => {
    const engine = createEngine();
    engine.submit('ignite', null);
    engine.runTicks(12000);

    expect(engine.state.cutoff).toBe(true);
    const elements = stateToElements(
      positionOf(engine.state),
      velocityOf(engine.state),
      MU_EARTH,
    );
    const periapsisAltitude = periapsisRadius_m(elements) - EARTH_RADIUS_M;
    expect(periapsisAltitude).toBeGreaterThanOrEqual(rocket.targetOrbit.periapsisAltitude_m);
  });

  it('records the telemetry peaks the console will show', () => {
    const engine = createEngine();
    engine.submit('ignite', null);
    engine.runTicks(12000);
    expect(engine.state.maxDynamicPressure_Pa).toBeGreaterThan(0);
    expect(engine.state.maxDynamicPressure_Pa).toBeLessThan(rocket.maxDynamicPressure_Pa);
    expect(engine.state.maxSensedG).toBeGreaterThan(3);
  });
});

describe('coasting', () => {
  it('refuses to coast while thrusting', () => {
    const engine = createEngine();
    engine.submit('ignite', null);
    engine.runTicks(1000);
    expect(canCoastNow(engine.state)).toBe(false);
  });

  it('refuses to coast inside the atmosphere', () => {
    // Closed-form Kepler has no drag term; coasting here would invent energy.
    const state = createFlightState();
    state.ignited = true;
    state.cutoff = true;
    state.positionX = EARTH_RADIUS_M + ATMOSPHERE_TOP_M - 1000;
    expect(canCoastNow(state)).toBe(false);

    state.positionX = EARTH_RADIUS_M + ATMOSPHERE_TOP_M + 1000;
    expect(canCoastNow(state)).toBe(true);
  });

  it('lands on the same orbit whether it coasts or steps', () => {
    // The two propagation modes must agree, or a time-warp change would alter
    // the flight (concept §3).
    const stepped = createEngine();
    stepped.submit('ignite', null);
    stepped.runTicks(11000);

    const coasted = createEngine();
    coasted.submit('ignite', null);
    coasted.runTicks(10000);
    coasted.coastTo(11000);

    const a = stateToElements(positionOf(stepped.state), velocityOf(stepped.state), MU_EARTH);
    const b = stateToElements(positionOf(coasted.state), velocityOf(coasted.state), MU_EARTH);

    expect(b.semiMajorAxis_m / a.semiMajorAxis_m).toBeCloseTo(1, 6);
    expect(b.eccentricity).toBeCloseTo(a.eccentricity, 5);
  });
});
