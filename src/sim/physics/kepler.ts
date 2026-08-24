/**
 * Two-dimensional Kepler mechanics (concept §3: 2D world, patched conics).
 *
 * This is the analytical half of the two propagation modes. During coast the
 * simulation does not integrate at all — it converts the state vector into
 * orbital elements once and evaluates position(t) in closed form, which is
 * what makes coast-phase time warp free of a step size.
 *
 * All angles are radians, all distances metres, all times seconds.
 */
import { TAU, atan2, cos, sin } from '../math.js';

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface OrbitalElements {
  /** Semi-major axis in m. Negative for hyperbolic orbits. */
  readonly semiMajorAxis_m: number;
  readonly eccentricity: number;
  /** Angle from +x to periapsis, radians. */
  readonly argumentOfPeriapsis_rad: number;
  /** Mean anomaly at the epoch this element set was built for, radians. */
  readonly meanAnomaly_rad: number;
  /** +1 counter-clockwise, -1 clockwise. 2D has no inclination to carry this. */
  readonly direction: 1 | -1;
}

/** Wraps an angle into [0, 2π). */
export function normalizeAngle(angle: number): number {
  const wrapped = angle - TAU * Math.floor(angle / TAU);
  // Guard the boundary: floating point can leave the result at exactly TAU.
  return wrapped >= TAU ? 0 : wrapped;
}

/**
 * Solves Kepler's equation M = E - e·sin(E) for the eccentric anomaly.
 *
 * Newton-Raphson from a first-order guess. The loop stops on a fixed tolerance
 * and a fixed iteration cap, both exact comparisons on deterministic
 * arithmetic — the same input always takes the same number of iterations.
 */
export function solveEccentricAnomaly(meanAnomaly_rad: number, eccentricity: number): number {
  const m = normalizeAngle(meanAnomaly_rad);
  // The standard starting guess; already within a few percent for small e.
  let e = m + eccentricity * sin(m);

  for (let i = 0; i < 24; i++) {
    const f = e - eccentricity * sin(e) - m;
    const derivative = 1 - eccentricity * cos(e);
    // Near-parabolic orbits flatten the derivative; the guard keeps the step finite.
    if (derivative === 0) break;
    const delta = f / derivative;
    e -= delta;
    if (delta < 1e-13 && delta > -1e-13) break;
  }
  return e;
}

/** True anomaly from eccentric anomaly. */
export function trueAnomalyFromEccentric(eccentricAnomaly: number, eccentricity: number): number {
  const halfE = eccentricAnomaly / 2;
  return (
    2 *
    atan2(
      Math.sqrt(1 + eccentricity) * sin(halfE),
      Math.sqrt(1 - eccentricity) * cos(halfE),
    )
  );
}

/** Eccentric anomaly from true anomaly. */
export function eccentricFromTrueAnomaly(trueAnomaly: number, eccentricity: number): number {
  const halfNu = trueAnomaly / 2;
  return (
    2 *
    atan2(
      Math.sqrt(1 - eccentricity) * sin(halfNu),
      Math.sqrt(1 + eccentricity) * cos(halfNu),
    )
  );
}

/**
 * Orbital elements from a state vector.
 *
 * Clockwise orbits are folded into a counter-clockwise frame and remembered in
 * `direction`, so the rest of the maths only ever deals with one sense of
 * rotation.
 */
export function stateToElements(position: Vec2, velocity: Vec2, mu: number): OrbitalElements {
  const angularMomentum = position.x * velocity.y - position.y * velocity.x;
  const direction: 1 | -1 = angularMomentum < 0 ? -1 : 1;

  const x = position.x;
  const y = direction * position.y;
  const vx = velocity.x;
  const vy = direction * velocity.y;

  const r = Math.sqrt(x * x + y * y);
  const vSquared = vx * vx + vy * vy;
  const radialVelocity = x * vx + y * vy;

  // Vis-viva, rearranged: 1/a = 2/r - v²/μ.
  const inverseSemiMajor = 2 / r - vSquared / mu;
  const semiMajorAxis_m = 1 / inverseSemiMajor;

  // Eccentricity vector points at periapsis.
  const factor = vSquared - mu / r;
  const ex = (factor * x - radialVelocity * vx) / mu;
  const ey = (factor * y - radialVelocity * vy) / mu;
  const eccentricity = Math.sqrt(ex * ex + ey * ey);

  const argumentOfPeriapsis_rad = eccentricity > 0 ? atan2(ey, ex) : 0;
  const trueAnomaly = normalizeAngle(atan2(y, x) - argumentOfPeriapsis_rad);
  const eccentricAnomaly = eccentricFromTrueAnomaly(trueAnomaly, eccentricity);
  const meanAnomaly_rad = normalizeAngle(eccentricAnomaly - eccentricity * sin(eccentricAnomaly));

  return {
    semiMajorAxis_m,
    eccentricity,
    argumentOfPeriapsis_rad,
    meanAnomaly_rad,
    direction,
  };
}

/** State vector from orbital elements. The inverse of `stateToElements`. */
export function elementsToState(
  elements: OrbitalElements,
  mu: number,
): { position: Vec2; velocity: Vec2 } {
  const { semiMajorAxis_m: a, eccentricity: e, argumentOfPeriapsis_rad: omega } = elements;

  const eccentricAnomaly = solveEccentricAnomaly(elements.meanAnomaly_rad, e);
  const cosE = cos(eccentricAnomaly);
  const sinE = sin(eccentricAnomaly);

  const r = a * (1 - e * cosE);
  const trueAnomaly = trueAnomalyFromEccentric(eccentricAnomaly, e);

  // Perifocal frame: periapsis on +x.
  const perifocalX = r * cos(trueAnomaly);
  const perifocalY = r * sin(trueAnomaly);

  const speedFactor = Math.sqrt(mu * a) / r;
  const perifocalVx = -speedFactor * sinE;
  const perifocalVy = speedFactor * Math.sqrt(1 - e * e) * cosE;

  const cosOmega = cos(omega);
  const sinOmega = sin(omega);

  const x = perifocalX * cosOmega - perifocalY * sinOmega;
  const y = perifocalX * sinOmega + perifocalY * cosOmega;
  const vx = perifocalVx * cosOmega - perifocalVy * sinOmega;
  const vy = perifocalVx * sinOmega + perifocalVy * cosOmega;

  return {
    position: { x, y: elements.direction * y },
    velocity: { x: vx, y: elements.direction * vy },
  };
}

/** Mean motion in rad/s. */
export function meanMotion(elements: OrbitalElements, mu: number): number {
  const a = elements.semiMajorAxis_m;
  return Math.sqrt(mu / (a * a * a));
}

/**
 * Advances the elements by `seconds`. This is the whole coast propagation:
 * only the mean anomaly moves, and it moves linearly with time.
 */
export function propagate(
  elements: OrbitalElements,
  seconds: number,
  mu: number,
): OrbitalElements {
  const meanAnomaly_rad = normalizeAngle(
    elements.meanAnomaly_rad + meanMotion(elements, mu) * seconds,
  );
  return { ...elements, meanAnomaly_rad };
}

export function isElliptical(elements: OrbitalElements): boolean {
  return elements.eccentricity < 1 && elements.semiMajorAxis_m > 0;
}

export function periapsisRadius_m(elements: OrbitalElements): number {
  return elements.semiMajorAxis_m * (1 - elements.eccentricity);
}

export function apoapsisRadius_m(elements: OrbitalElements): number {
  return elements.semiMajorAxis_m * (1 + elements.eccentricity);
}

/** Orbital period in seconds. Only meaningful for closed orbits. */
export function orbitalPeriod_s(elements: OrbitalElements, mu: number): number {
  return TAU / meanMotion(elements, mu);
}
