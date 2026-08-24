/**
 * The pitch program (concept §3: "pitch program instead of live steering").
 *
 * The player never steers. The vehicle follows this curve, which is why the
 * interesting decisions sit before launch and around the anomalies, not on a
 * joystick.
 */
import { PI } from '../math.js';

export interface PitchNode {
  readonly time_s: number;
  readonly pitch_deg: number;
}

export interface PitchProgram {
  readonly nodes: readonly PitchNode[];
}

const DEGREES_TO_RADIANS = PI / 180;

/**
 * Pitch above the local horizon in radians at `time_s` after liftoff.
 *
 * Linear interpolation between nodes; before the first and after the last node
 * the value is held. Holding rather than extrapolating matters: an
 * extrapolated pitch would swing past zero into a nose-down attitude late in
 * the burn.
 */
export function pitchAt(program: PitchProgram, time_s: number): number {
  const nodes = program.nodes;
  if (nodes.length === 0) {
    throw new Error('Pitch program has no nodes');
  }

  const first = nodes[0];
  if (time_s <= first.time_s) return first.pitch_deg * DEGREES_TO_RADIANS;

  for (let i = 1; i < nodes.length; i++) {
    const previous = nodes[i - 1];
    const current = nodes[i];
    if (time_s <= current.time_s) {
      const span = current.time_s - previous.time_s;
      // Coincident nodes would divide by zero; treat them as a step.
      if (span <= 0) return current.pitch_deg * DEGREES_TO_RADIANS;
      const fraction = (time_s - previous.time_s) / span;
      const degrees = previous.pitch_deg + (current.pitch_deg - previous.pitch_deg) * fraction;
      return degrees * DEGREES_TO_RADIANS;
    }
  }

  return nodes[nodes.length - 1].pitch_deg * DEGREES_TO_RADIANS;
}

/** Validates a pitch program loaded from JSON. Nodes must be strictly ordered. */
export function validatePitchProgram(program: PitchProgram): void {
  if (program.nodes.length < 2) {
    throw new Error('Pitch program needs at least two nodes');
  }
  for (let i = 1; i < program.nodes.length; i++) {
    if (program.nodes[i].time_s <= program.nodes[i - 1].time_s) {
      throw new Error(
        `Pitch program nodes must increase in time: node ${i} is at ${program.nodes[i].time_s}s`,
      );
    }
  }
}
