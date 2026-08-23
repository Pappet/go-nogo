import { describe, expect, it } from 'vitest';

import pitchData from '../../data/pitchProgram.json' with { type: 'json' };
import { PI } from '../math.js';

import { type PitchProgram, pitchAt, validatePitchProgram } from './ascentProgram.js';

const program = pitchData as PitchProgram;
const toDegrees = (radians: number): number => (radians * 180) / PI;

describe('pitch program', () => {
  it('accepts the shipped program', () => {
    expect(() => validatePitchProgram(program)).not.toThrow();
  });

  it('starts vertical and ends horizontal', () => {
    expect(toDegrees(pitchAt(program, 0))).toBeCloseTo(90, 6);
    expect(toDegrees(pitchAt(program, 520))).toBeCloseTo(0, 6);
  });

  it('interpolates linearly between nodes', () => {
    // Nodes at 20 s / 84° and 40 s / 72°: the midpoint must be 78°.
    expect(toDegrees(pitchAt(program, 30))).toBeCloseTo(78, 6);
  });

  it('holds the end values instead of extrapolating', () => {
    // Extrapolating past the last node would pitch the nose below the horizon.
    expect(toDegrees(pitchAt(program, -10))).toBeCloseTo(90, 6);
    expect(toDegrees(pitchAt(program, 10000))).toBeCloseTo(0, 6);
  });

  it('never pitches back up', () => {
    let previous = pitchAt(program, 0);
    for (let t = 0; t <= 600; t += 0.5) {
      const current = pitchAt(program, t);
      expect(current).toBeLessThanOrEqual(previous + 1e-12);
      previous = current;
    }
  });

  it('rejects unordered or too-short programs', () => {
    expect(() => validatePitchProgram({ nodes: [{ time_s: 0, pitch_deg: 90 }] })).toThrow(
      /at least two/,
    );
    expect(() =>
      validatePitchProgram({
        nodes: [
          { time_s: 0, pitch_deg: 90 },
          { time_s: 0, pitch_deg: 80 },
        ],
      }),
    ).toThrow(/increase in time/);
  });
});
