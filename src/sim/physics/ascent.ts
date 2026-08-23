/**
 * The powered-ascent environment and its accelerations.
 *
 * This is the numerical half of the two propagation modes: while the engines
 * burn and the atmosphere bites, the state is integrated at the fixed DT. The
 * closed-form half lives in kepler.ts and takes over once the vehicle coasts.
 *
 * Earth's rotation is ignored — a Phase 0 simplification in the spirit of
 * "plausible beats perfect" (concept §10).
 */
import { cos, exp, sin } from '../math.js';

import {
  ATMOSPHERE_TOP_M,
  EARTH_RADIUS_M,
  MU_EARTH,
  SCALE_HEIGHT_M,
  SEA_LEVEL_DENSITY,
  SEA_LEVEL_PRESSURE,
  STANDARD_GRAVITY,
} from './constants.js';
import type { Vec2 } from './kepler.js';

export interface Environment {
  readonly altitude_m: number;
  readonly density_kgm3: number;
  readonly pressure_Pa: number;
  readonly dynamicPressure_Pa: number;
  readonly speed_ms: number;
}

export function altitudeOf(position: Vec2): number {
  return Math.sqrt(position.x * position.x + position.y * position.y) - EARTH_RADIUS_M;
}

export function speedOf(velocity: Vec2): number {
  return Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
}

/** Exponential atmosphere; above ATMOSPHERE_TOP_M it is treated as vacuum. */
export function densityAt(altitude_m: number): number {
  if (altitude_m >= ATMOSPHERE_TOP_M) return 0;
  if (altitude_m <= 0) return SEA_LEVEL_DENSITY;
  return SEA_LEVEL_DENSITY * exp(-altitude_m / SCALE_HEIGHT_M);
}

export function pressureAt(altitude_m: number): number {
  if (altitude_m >= ATMOSPHERE_TOP_M) return 0;
  if (altitude_m <= 0) return SEA_LEVEL_PRESSURE;
  return SEA_LEVEL_PRESSURE * exp(-altitude_m / SCALE_HEIGHT_M);
}

export function environmentAt(position: Vec2, velocity: Vec2): Environment {
  const altitude_m = altitudeOf(position);
  const density_kgm3 = densityAt(altitude_m);
  const speed_ms = speedOf(velocity);
  return {
    altitude_m,
    density_kgm3,
    pressure_Pa: pressureAt(altitude_m),
    speed_ms,
    dynamicPressure_Pa: 0.5 * density_kgm3 * speed_ms * speed_ms,
  };
}

/**
 * Unit vector the engines point along, from the pitch program.
 *
 * Pitch is measured from the local horizon, so 90° is straight up and 0° is
 * along the direction of flight. `direction` selects which way downrange is,
 * matching the sign convention in kepler.ts.
 */
export function thrustDirection(position: Vec2, pitch_rad: number, direction: 1 | -1): Vec2 {
  const r = Math.sqrt(position.x * position.x + position.y * position.y);
  const upX = position.x / r;
  const upY = position.y / r;
  // Downrange is "up" rotated a quarter turn in the direction of motion.
  const downrangeX = -upY * direction;
  const downrangeY = upX * direction;

  const sinPitch = sin(pitch_rad);
  const cosPitch = cos(pitch_rad);
  return {
    x: upX * sinPitch + downrangeX * cosPitch,
    y: upY * sinPitch + downrangeY * cosPitch,
  };
}

export interface AccelerationInput {
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly mass_kg: number;
  /** Current engine thrust in N; zero while coasting or shut down. */
  readonly thrust_N: number;
  /** Unit vector the thrust acts along. */
  readonly thrustDirection: Vec2;
  readonly dragCoefficient: number;
  readonly referenceArea_m2: number;
  readonly environment: Environment;
}

/** Total acceleration: gravity, drag and thrust. */
export function accelerationAt(input: AccelerationInput): Vec2 {
  const { position, velocity, mass_kg, environment } = input;

  const r = Math.sqrt(position.x * position.x + position.y * position.y);
  const gravityFactor = -MU_EARTH / (r * r * r);
  let ax = gravityFactor * position.x;
  let ay = gravityFactor * position.y;

  if (environment.density_kgm3 > 0 && environment.speed_ms > 0) {
    // D = ½ρv²·Cd·A, opposing the velocity vector.
    const dragMagnitude =
      0.5 *
      environment.density_kgm3 *
      environment.speed_ms *
      environment.speed_ms *
      input.dragCoefficient *
      input.referenceArea_m2;
    const dragAcceleration = dragMagnitude / mass_kg / environment.speed_ms;
    ax -= dragAcceleration * velocity.x;
    ay -= dragAcceleration * velocity.y;
  }

  if (input.thrust_N > 0) {
    const thrustAcceleration = input.thrust_N / mass_kg;
    ax += thrustAcceleration * input.thrustDirection.x;
    ay += thrustAcceleration * input.thrustDirection.y;
  }

  return { x: ax, y: ay };
}

/**
 * One fixed step of semi-implicit Euler. Velocity is updated first and the new
 * velocity moves the position, which keeps the energy behaviour stable over
 * the thousands of steps an ascent takes.
 */
export function integrate(
  position: Vec2,
  velocity: Vec2,
  acceleration: Vec2,
  dt_s: number,
): { position: Vec2; velocity: Vec2 } {
  const vx = velocity.x + acceleration.x * dt_s;
  const vy = velocity.y + acceleration.y * dt_s;
  return {
    velocity: { x: vx, y: vy },
    position: { x: position.x + vx * dt_s, y: position.y + vy * dt_s },
  };
}

/** Sensed acceleration in g, what the crew and the G gauge would feel. */
export function sensedG(thrust_N: number, dragForce_N: number, mass_kg: number): number {
  return (thrust_N - dragForce_N) / mass_kg / STANDARD_GRAVITY;
}
