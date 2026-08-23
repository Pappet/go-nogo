/**
 * The Phase 0 world: one hard-wired vehicle, from the pad to orbit.
 *
 * This is the `Simulation` the engine drives. It owns nothing about time —
 * the engine decides when a tick happens — and nothing about presentation.
 * The countdown state machine sits on top of this and turns the transitions
 * below into events.
 */
import { DT_MS, type Command, type Simulation } from './engine.js';
import {
  accelerationAt,
  altitudeOf,
  environmentAt,
  integrate,
  sensedG,
  thrustDirection,
} from './physics/ascent.js';
import { type PitchProgram, pitchAt } from './physics/ascentProgram.js';
import { ATMOSPHERE_TOP_M, EARTH_RADIUS_M, MU_EARTH } from './physics/constants.js';
import {
  elementsToState,
  periapsisRadius_m,
  propagate,
  stateToElements,
  type Vec2,
} from './physics/kepler.js';
import { type RocketDef, ispAt, massFlowRate, thrustAt, vehicleMass_kg } from './physics/thrust.js';

const DT_S = DT_MS / 1000;

/** Everything that survives a tick. Every field is part of the state hash. */
export interface FlightState {
  /** Tick the state is valid at. Kept here so a coast can size its own jump. */
  tick: number;
  /** Tick of liftoff, or -1 while still on the pad. */
  liftoffTick: number;

  positionX: number;
  positionY: number;
  velocityX: number;
  velocityY: number;

  stageIndex: number;
  propellantRemaining_kg: number;

  ignited: boolean;
  separated: boolean;
  /** True once guidance has shut the upper stage down on reaching the target. */
  cutoff: boolean;

  maxDynamicPressure_Pa: number;
  maxSensedG: number;
}

export interface FlightConfig {
  readonly rocket: RocketDef;
  readonly pitchProgram: PitchProgram;
}

export function createFlightState(): FlightState {
  return {
    tick: 0,
    liftoffTick: -1,
    positionX: EARTH_RADIUS_M,
    positionY: 0,
    velocityX: 0,
    velocityY: 0,
    stageIndex: 0,
    propellantRemaining_kg: 0,
    ignited: false,
    separated: false,
    cutoff: false,
    maxDynamicPressure_Pa: 0,
    maxSensedG: 0,
  };
}

export function positionOf(state: FlightState): Vec2 {
  return { x: state.positionX, y: state.positionY };
}

export function velocityOf(state: FlightState): Vec2 {
  return { x: state.velocityX, y: state.velocityY };
}

/** Seconds since liftoff. Negative while the vehicle is still on the pad. */
export function missionTime_s(state: FlightState): number {
  if (state.liftoffTick < 0) return 0;
  return (state.tick - state.liftoffTick) * DT_S;
}

export function isThrusting(state: FlightState): boolean {
  return state.ignited && !state.cutoff && state.propellantRemaining_kg > 0;
}

/**
 * The vehicle may be evaluated in closed form once the engines are quiet and
 * the air is thin enough to ignore. Coasting inside the atmosphere would drop
 * the drag term and quietly invent energy.
 */
export function canCoastNow(state: FlightState): boolean {
  if (isThrusting(state)) return false;
  if (!state.ignited) return false;
  return altitudeOf(positionOf(state)) >= ATMOSPHERE_TOP_M;
}

export function createFlightSimulation(config: FlightConfig): Simulation<FlightState> {
  const { rocket, pitchProgram } = config;
  const targetPeriapsis_m = EARTH_RADIUS_M + rocket.targetOrbit.periapsisAltitude_m;

  function step(state: FlightState, tick: number): void {
    state.tick = tick + 1;

    // On the pad the vehicle is held down; gravity is carried by the launch mount.
    if (!state.ignited) return;

    const position = positionOf(state);
    const velocity = velocityOf(state);
    const environment = environmentAt(position, velocity);
    const stage = rocket.stages[state.stageIndex];

    let thrust = 0;
    if (isThrusting(state)) {
      thrust = thrustAt(stage, environment.pressure_Pa);
      const flow = massFlowRate(thrust, ispAt(stage, environment.pressure_Pa));
      state.propellantRemaining_kg -= flow * DT_S;
      if (state.propellantRemaining_kg <= 0) {
        state.propellantRemaining_kg = 0;
      }
    }

    const mass = vehicleMass_kg(rocket, state.stageIndex, state.propellantRemaining_kg);
    const pitch = pitchAt(pitchProgram, missionTime_s(state));
    const acceleration = accelerationAt({
      position,
      velocity,
      mass_kg: mass,
      thrust_N: thrust,
      thrustDirection: thrustDirection(position, pitch, 1),
      dragCoefficient: rocket.dragCoefficient,
      referenceArea_m2: rocket.referenceArea_m2,
      environment,
    });

    if (environment.dynamicPressure_Pa > state.maxDynamicPressure_Pa) {
      state.maxDynamicPressure_Pa = environment.dynamicPressure_Pa;
    }
    const dragForce =
      0.5 *
      environment.density_kgm3 *
      environment.speed_ms *
      environment.speed_ms *
      rocket.dragCoefficient *
      rocket.referenceArea_m2;
    const g = sensedG(thrust, dragForce, mass);
    if (g > state.maxSensedG) state.maxSensedG = g;

    const next = integrate(position, velocity, acceleration, DT_S);
    state.positionX = next.position.x;
    state.positionY = next.position.y;
    state.velocityX = next.velocity.x;
    state.velocityY = next.velocity.y;

    // Staging: a depleted lower stage is dropped and the next one lights.
    if (
      state.propellantRemaining_kg === 0 &&
      state.stageIndex < rocket.stages.length - 1 &&
      !state.cutoff
    ) {
      state.stageIndex += 1;
      state.propellantRemaining_kg = rocket.stages[state.stageIndex].propellantMass_kg;
      state.separated = true;
    }

    // Guidance cutoff: stop the upper stage the moment the target orbit is in
    // hand, rather than burning to depletion and overshooting it.
    if (
      !state.cutoff &&
      state.stageIndex === rocket.stages.length - 1 &&
      state.propellantRemaining_kg > 0
    ) {
      const elements = stateToElements(next.position, next.velocity, MU_EARTH);
      if (elements.eccentricity < 1 && periapsisRadius_m(elements) >= targetPeriapsis_m) {
        state.cutoff = true;
      }
    }
  }

  function apply(state: FlightState, command: Command, tick: number): void {
    if (command.type === 'ignite' && !state.ignited) {
      state.ignited = true;
      state.liftoffTick = tick;
      state.propellantRemaining_kg = rocket.stages[0].propellantMass_kg;
    }
  }

  function coastTo(state: FlightState, tick: number): void {
    const seconds = (tick - state.tick) * DT_S;
    if (seconds <= 0) {
      state.tick = tick;
      return;
    }
    const elements = stateToElements(positionOf(state), velocityOf(state), MU_EARTH);
    const advanced = propagate(elements, seconds, MU_EARTH);
    const next = elementsToState(advanced, MU_EARTH);
    state.positionX = next.position.x;
    state.positionY = next.position.y;
    state.velocityX = next.velocity.x;
    state.velocityY = next.velocity.y;
    state.tick = tick;
  }

  return { step, apply, canCoast: canCoastNow, coastTo };
}
