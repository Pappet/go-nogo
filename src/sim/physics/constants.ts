/**
 * Physical constants of the Phase 0 world.
 *
 * These are properties of Earth and of SI, not tuning knobs — the numbers a
 * designer would turn (masses, Isp, thrust, pitch nodes, max-Q limit) live in
 * `src/data/*.json` as CLAUDE.md requires.
 */

/** Earth's gravitational parameter μ in m³/s² (concept §3: 398 600 km³/s²). */
export const MU_EARTH = 3.986004418e14;

/** Equatorial radius in m. Altitude is measured from here. */
export const EARTH_RADIUS_M = 6378137;

/** Standard gravity, the constant that turns Isp in seconds into exhaust velocity. */
export const STANDARD_GRAVITY = 9.80665;

/** Sea-level density and pressure of the exponential atmosphere. */
export const SEA_LEVEL_DENSITY = 1.225;
export const SEA_LEVEL_PRESSURE = 101325;

/** Scale height of the exponential atmosphere in m. */
export const SCALE_HEIGHT_M = 8500;

/** Above this altitude the atmosphere is treated as vacuum (density < 1e-8 kg/m³). */
export const ATMOSPHERE_TOP_M = 160000;
