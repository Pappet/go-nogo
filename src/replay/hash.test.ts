import { describe, expect, it } from 'vitest';

import { createMissionConfig } from '../missionConfig.js';
import { createMissionState } from '../sim/countdown.js';
import { createFlightState } from '../sim/flight.js';

import { CanonicalWriter, encodeFlightState, hashFlightState, hashMissionState } from './hash.js';

describe('canonical writer', () => {
  it('writes floats little-endian, eight bytes each', () => {
    const writer = new CanonicalWriter();
    writer.float64(1, 'a');
    const bytes = writer.toBytes();
    expect(bytes).toHaveLength(8);
    // 1.0 as IEEE-754 LE ends with 0x3f 0xf0.
    expect(bytes[7]).toBe(0x3f);
    expect(bytes[6]).toBe(0xf0);
  });

  it('refuses NaN and Infinity, naming the field', () => {
    // A NaN in the state means the simulation is already broken; hashing it
    // would preserve the wreckage instead of reporting it (concept §8.2 rule 8).
    expect(() => new CanonicalWriter().float64(NaN, 'velocityX')).toThrow(/NaN.*velocityX/);
    expect(() => new CanonicalWriter().float64(Infinity, 'altitude')).toThrow(
      /Infinity.*altitude/,
    );
    expect(() => new CanonicalWriter().float64(-Infinity, 'altitude')).toThrow(/altitude/);
  });

  it('refuses a non-integer where an integer belongs', () => {
    expect(() => new CanonicalWriter().int32(1.5, 'tick')).toThrow(/non-integer.*tick/);
  });

  it('normalises signed zero', () => {
    // Physics produces -0 legitimately (a negative factor times +0). Without
    // this, an incidental sign would change a replay hash.
    const positive = new CanonicalWriter();
    positive.float64(0, 'a');
    const negative = new CanonicalWriter();
    negative.float64(-0, 'a');
    expect(Array.from(negative.toBytes())).toEqual(Array.from(positive.toBytes()));
  });

  it('distinguishes values that JSON would render identically', () => {
    const a = new CanonicalWriter();
    a.float64(0.1 + 0.2, 'x');
    const b = new CanonicalWriter();
    b.float64(0.3, 'x');
    // 0.1 + 0.2 !== 0.3 in binary, and the bytes must say so.
    expect(Array.from(a.toBytes())).not.toEqual(Array.from(b.toBytes()));
  });

  it('makes field order part of the encoding', () => {
    const forward = new CanonicalWriter();
    forward.float64(1, 'a');
    forward.float64(2, 'b');
    const reversed = new CanonicalWriter();
    reversed.float64(2, 'b');
    reversed.float64(1, 'a');
    expect(Array.from(forward.toBytes())).not.toEqual(Array.from(reversed.toBytes()));
  });

  it('length-prefixes strings so neighbours cannot merge', () => {
    const split = new CanonicalWriter();
    split.string('ab');
    split.string('c');
    const merged = new CanonicalWriter();
    merged.string('abc');
    merged.string('');
    expect(Array.from(split.toBytes())).not.toEqual(Array.from(merged.toBytes()));
  });
});

describe('flight state hashing', () => {
  it('is stable for an unchanged state', () => {
    const state = createFlightState();
    expect(hashFlightState(state)).toBe(hashFlightState(createFlightState()));
  });

  it('changes when any field changes', () => {
    const baseline = hashFlightState(createFlightState());
    const fields = [
      (s: ReturnType<typeof createFlightState>) => (s.tick = 1),
      (s: ReturnType<typeof createFlightState>) => (s.liftoffTick = 1),
      (s: ReturnType<typeof createFlightState>) => (s.positionX += 1),
      (s: ReturnType<typeof createFlightState>) => (s.positionY += 1),
      (s: ReturnType<typeof createFlightState>) => (s.velocityX += 1),
      (s: ReturnType<typeof createFlightState>) => (s.velocityY += 1),
      (s: ReturnType<typeof createFlightState>) => (s.stageIndex = 1),
      (s: ReturnType<typeof createFlightState>) => (s.propellantRemaining_kg = 1),
      (s: ReturnType<typeof createFlightState>) => (s.ignited = true),
      (s: ReturnType<typeof createFlightState>) => (s.separated = true),
      (s: ReturnType<typeof createFlightState>) => (s.cutoff = true),
      (s: ReturnType<typeof createFlightState>) => (s.maxDynamicPressure_Pa = 1),
      (s: ReturnType<typeof createFlightState>) => (s.maxSensedG = 1),
    ];
    for (const mutate of fields) {
      const state = createFlightState();
      mutate(state);
      expect(hashFlightState(state)).not.toBe(baseline);
    }
  });

  it('notices a difference far below display precision', () => {
    // A metre of position is invisible on a gauge and fatal to a replay.
    const state = createFlightState();
    state.positionX += 1;
    expect(hashFlightState(state)).not.toBe(hashFlightState(createFlightState()));
  });

  it('encodes the whole schema, not a prefix of it', () => {
    const writer = new CanonicalWriter();
    encodeFlightState(createFlightState(), writer);
    // 4 int32 (tick, liftoffTick, stageIndex, mecoTick) + 7 float64 + 3 booleans.
    expect(writer.toBytes()).toHaveLength(4 * 4 + 7 * 8 + 3);
  });
});

describe('mission state hashing', () => {
  const config = createMissionConfig();

  it('covers the countdown machine as well as the flight', () => {
    const baseline = hashMissionState(createMissionState(config));

    const armed = createMissionState(config);
    armed.phase = 'ARMED';
    expect(hashMissionState(armed)).not.toBe(baseline);

    const switched = createMissionState(config);
    switched.checklist[0] = true;
    expect(hashMissionState(switched)).not.toBe(baseline);

    const counting = createMissionState(config);
    counting.ignitionTick = 320;
    expect(hashMissionState(counting)).not.toBe(baseline);
  });

  it('notices an event appearing or going missing', () => {
    const baseline = hashMissionState(createMissionState(config));
    const withEvent = createMissionState(config);
    withEvent.events.push({ tick: 1, missionTime_s: 0, type: 'CHECKLIST', message: 'x' });
    expect(hashMissionState(withEvent)).not.toBe(baseline);
  });

  it('ignores the wording of an event message', () => {
    // Log text is presentation. Rewording a line must not invalidate every
    // stored replay, but the event still has to exist.
    const first = createMissionState(config);
    first.events.push({ tick: 1, missionTime_s: 0, type: 'MECO', message: 'MECO — cutoff' });
    const second = createMissionState(config);
    second.events.push({ tick: 1, missionTime_s: 0, type: 'MECO', message: 'main engine off' });
    expect(hashMissionState(second)).toBe(hashMissionState(first));
  });
});

describe('the hash covers what the player can learn, and when', () => {
  /**
   * A symptom's drawn delay decides the moment the reading appears — which is
   * the moment the candidate list narrows, and the whole basis of the
   * wait-versus-diagnose decision. It went unhashed once; a change to the
   * delay bands then moved ten of eleven fixture hashes not at all.
   */
  it('moves when a symptom would become visible at a different time', async () => {
    const config = createMissionConfig();
    const state = createMissionState(config);
    state.diagnosis.anomalies.anomalies.push({
      id: 'anomaly-1',
      causeId: 'cause_bus_short',
      onsetTick: 400,
      escalationTick: 1600,
      resolvedTick: -1,
      escalatedTick: -1,
      applied: [],
      spawnedBy: null,
      symptoms: [
        { symptomId: 'sym_voltage_drop', strength: 0.7, delay_s: 0 },
        { symptomId: 'sym_telemetry_gaps', strength: 0.5, delay_s: 30 },
      ],
    });

    const before = await hashMissionState(state);
    state.diagnosis.anomalies.anomalies[0] = {
      ...state.diagnosis.anomalies.anomalies[0],
      symptoms: [
        { symptomId: 'sym_voltage_drop', strength: 0.7, delay_s: 0 },
        { symptomId: 'sym_telemetry_gaps', strength: 0.5, delay_s: 12 },
      ],
    };
    expect(await hashMissionState(state)).not.toBe(before);
  });

  it('moves when a symptom reads differently, at the same time', async () => {
    const config = createMissionConfig();
    const state = createMissionState(config);
    state.diagnosis.anomalies.anomalies.push({
      id: 'anomaly-1',
      causeId: 'cause_bus_short',
      onsetTick: 400,
      escalationTick: 1600,
      resolvedTick: -1,
      escalatedTick: -1,
      applied: [],
      spawnedBy: null,
      symptoms: [{ symptomId: 'sym_voltage_drop', strength: 0.7, delay_s: 0 }],
    });

    const before = await hashMissionState(state);
    state.diagnosis.anomalies.anomalies[0] = {
      ...state.diagnosis.anomalies.anomalies[0],
      symptoms: [{ symptomId: 'sym_voltage_drop', strength: 0.36, delay_s: 0 }],
    };
    expect(await hashMissionState(state)).not.toBe(before);
  });
});
