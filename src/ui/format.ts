/**
 * Formatting for the console displays.
 *
 * Pure functions, so the readouts can be tested without a browser. Nothing
 * here reads simulation state directly — the console passes values in.
 */

/**
 * Mission clock in the shape a launch console shows it: `T-00:09.8`.
 *
 * The sign is part of the reading, not decoration: negative counts down to
 * ignition, positive counts up from liftoff.
 */
export function formatMissionClock(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  const absolute = Math.abs(seconds);
  const minutes = Math.floor(absolute / 60);
  const remainder = absolute - minutes * 60;
  const wholeSeconds = Math.floor(remainder);
  const tenths = Math.floor((remainder - wholeSeconds) * 10);
  return `T${sign}${pad(minutes)}:${pad(wholeSeconds)}.${tenths}`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/** Altitude in km with one decimal below 100 km, none above. */
export function formatAltitude(metres: number): string {
  const km = metres / 1000;
  return km < 100 ? km.toFixed(1) : Math.round(km).toString();
}

/** Speed in m/s, grouped so four digits stay readable at a glance. */
export function formatSpeed(metresPerSecond: number): string {
  return Math.round(metresPerSecond).toLocaleString('en-US');
}

export function formatG(g: number): string {
  return g.toFixed(2);
}

/** Dynamic pressure in kPa. */
export function formatDynamicPressure(pascals: number): string {
  return (pascals / 1000).toFixed(1);
}
