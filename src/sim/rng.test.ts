/**
 * Pinned behaviour of the RNG.
 *
 * The hash is core mechanics, not an implementation detail (concept §8.2
 * rule 4): the exactness of post-mortem what-ifs and the surgical retry both
 * rest on it. So the vectors here are pinned, and the statistical properties
 * that make the hash usable at all are asserted rather than assumed.
 */
import { describe, expect, it } from 'vitest';

import { createStream, hash64, hashUnit } from './rng.js';

const view = new DataView(new ArrayBuffer(8));

function floatBits(x: number): string {
  view.setFloat64(0, x, false);
  const hi = (view.getUint32(0, false) >>> 0).toString(16).padStart(8, '0');
  const lo = (view.getUint32(4, false) >>> 0).toString(16).padStart(8, '0');
  return hi + lo;
}

const hex = (x: number): string => (x >>> 0).toString(16).padStart(8, '0');

function popcount(x: number): number {
  let value = x >>> 0;
  let count = 0;
  while (value !== 0) {
    count += value & 1;
    value >>>= 1;
  }
  return count;
}

describe('hash64 as an addressable draw', () => {
  it('depends only on its inputs, not on call order', () => {
    // This is the property the whole what-if story rests on: interleaving other
    // draws must not move this one.
    const first = hash64(42, 'SN-4731', 'reliability');
    for (let i = 0; i < 100; i++) hash64(42, `SN-${i}`, 'noise');
    const again = hash64(42, 'SN-4731', 'reliability');
    expect(again).toEqual(first);
  });

  it('separates the key from the context', () => {
    // Without length mixing these would collide and two different parts would
    // silently share a roll.
    expect(hash64(42, 'ab', 'c')).not.toEqual(hash64(42, 'a', 'bc'));
    expect(hash64(42, '', 'abc')).not.toEqual(hash64(42, 'abc', ''));
  });

  it('gives one part different rolls in different contexts', () => {
    expect(hash64(42, 'SN-4731', 'reliability')).not.toEqual(
      hash64(42, 'SN-4731', 'failureTime'),
    );
  });

  it('gives different seeds different rolls', () => {
    expect(hash64(42, 'SN-4731', 'reliability')).not.toEqual(
      hash64(43, 'SN-4731', 'reliability'),
    );
  });

  it('avalanches: a one-bit input change moves about half the output bits', () => {
    let flipped = 0;
    const samples = 4000;
    for (let i = 0; i < samples; i++) {
      const a = hash64(i, 'SN-4731', 'reliability');
      const b = hash64(i ^ 1, 'SN-4731', 'reliability');
      flipped += popcount(a.hi ^ b.hi) + popcount(a.lo ^ b.lo);
    }
    const average = flipped / samples;
    // Ideal is 32 of 64. Anything far off means the lanes are not mixing.
    expect(average).toBeGreaterThan(30);
    expect(average).toBeLessThan(34);
  });

  it('does not collide across a realistic number of serial numbers', () => {
    const seen = new Set<string>();
    const count = 50000;
    for (let i = 0; i < count; i++) {
      const h = hash64(42, `SN-${i}`, 'reliability');
      seen.add(`${h.hi},${h.lo}`);
    }
    expect(seen.size).toBe(count);
  });
});

describe('hashUnit', () => {
  it('stays inside [0, 1)', () => {
    let min = 1;
    let max = 0;
    for (let i = 0; i < 50000; i++) {
      const u = hashUnit(7, `SN-${i}`, 'reliability');
      if (u < min) min = u;
      if (u > max) max = u;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
  });

  it('is uniform enough to scale into a reliability band', () => {
    const buckets = new Array<number>(100).fill(0);
    const count = 100000;
    for (let i = 0; i < count; i++) {
      buckets[Math.floor(hashUnit(42, `SN-${i}`, 'reliability') * 100)] += 1;
    }
    const expectedPerBucket = count / 100;
    let chiSquare = 0;
    for (const observed of buckets) {
      const delta = observed - expectedPerBucket;
      chiSquare += (delta * delta) / expectedPerBucket;
    }
    // 99 degrees of freedom: the 0.1 % critical value is about 148.
    expect(chiSquare).toBeLessThan(148);
  });
});

describe('streams', () => {
  it('gives each system its own sequence', () => {
    const solar = createStream(42, 'solarActivity');
    const market = createStream(42, 'market');
    let identical = 0;
    for (let i = 0; i < 10000; i++) {
      if (solar.nextUint32() === market.nextUint32()) identical += 1;
    }
    // Two independent 32-bit streams collide about 10000 / 2^32 times.
    expect(identical).toBeLessThan(3);
  });

  it('replays identically from the same seed and name', () => {
    const a = createStream(42, 'solarActivity');
    const b = createStream(42, 'solarActivity');
    for (let i = 0; i < 100; i++) {
      expect(a.nextUint32()).toBe(b.nextUint32());
    }
  });

  it('keeps nextUnit inside [0, 1)', () => {
    const stream = createStream(1, 'anomaly');
    for (let i = 0; i < 10000; i++) {
      const u = stream.nextUnit();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});

describe('pinned vectors', () => {
  // Generated from this implementation. Changing any of them is a breaking
  // change and raises the dataVersion (concept §8.2 rule 4).
  const HASH64: [number, string, string, string, string][] = [
    [42, 'SN-4731', 'reliability', 'd977b308', '396c6cc7'],
    [42, 'SN-4731', 'failureTime', 'a6d3d45c', '6f930851'],
    [42, 'SN-4732', 'reliability', 'ec4417ae', '78f06a06'],
    [43, 'SN-4731', 'reliability', 'e2f3f930', '0f913385'],
    [0, '', '', '2700503e', '2f27a432'],
    [1, 'a', 'b', 'ee62bd15', '2c0d08b1'],
    [-1, 'stage-1', 'ignition', '797470f0', '8d50688e'],
    [9007199254740991, 'SN-1', 'reliability', '77b5785b', '9da55d6b'],
  ];

  const HASH_UNIT: [number, string, string, string][] = [
    [42, 'SN-4731', 'reliability', '3feb2ef660e5b1b3'],
    [42, 'SN-4731', 'failureTime', '3fe4da7a89be4c21'],
    [42, 'SN-4732', 'reliability', '3fed8882f5e3c1a8'],
    [43, 'SN-4731', 'reliability', '3fec5e7f243e44ce'],
    [0, '', '', '3fc3802812f27a40'],
    [1, 'a', 'b', '3fedcc57a0b03422'],
    [-1, 'stage-1', 'ignition', '3fde5d1c3c6a8344'],
    [9007199254740991, 'SN-1', 'reliability', '3fdded5e14ed2aea'],
  ];

  const STREAMS: [number, string, string[]][] = [
    [
      42,
      'solarActivity',
      ['3daa5d1f', '764e2288', '1c337bcb', 'c4f4913d', '94912657', '86cbd05d', '79a79c26', '96f96988'],
    ],
    [
      42,
      'market',
      ['0dfe4248', '0776d1b1', '7f3db816', '708a1322', '782daa71', '9b037af0', '264d2236', '329b926c'],
    ],
    [
      7,
      'anomaly',
      ['5b423997', 'c36cb559', 'c8e12dcb', '8882d5f4', '7324428e', '9f358653', '198ee5c7', '7c4a752a'],
    ],
  ];

  it('hash64 reproduces its pinned lanes', () => {
    for (const [seed, key, context, hi, lo] of HASH64) {
      const actual = hash64(seed, key, context);
      expect(`${seed}/${key}/${context} -> ${hex(actual.hi)}:${hex(actual.lo)}`).toBe(
        `${seed}/${key}/${context} -> ${hi}:${lo}`,
      );
    }
  });

  it('hashUnit reproduces its pinned bits', () => {
    for (const [seed, key, context, expected] of HASH_UNIT) {
      expect(`${seed}/${key}/${context} -> ${floatBits(hashUnit(seed, key, context))}`).toBe(
        `${seed}/${key}/${context} -> ${expected}`,
      );
    }
  });

  it('streams reproduce their pinned openings', () => {
    for (const [seed, name, expected] of STREAMS) {
      const stream = createStream(seed, name);
      const actual = expected.map(() => hex(stream.nextUint32()));
      expect(`${name} -> ${actual.join(',')}`).toBe(`${name} -> ${expected.join(',')}`);
    }
  });
});
