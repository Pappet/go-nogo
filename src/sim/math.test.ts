/**
 * Pinned behaviour of the deterministic math module.
 *
 * Three layers, each catching a different kind of mistake:
 *  1. The split constants are checked against the host's own values, so a
 *     mistyped digit in PIO2_HI/LN2_HI fails here instead of silently costing
 *     precision at large arguments.
 *  2. Accuracy is compared against `Math.*`. The host library is not bit-exact
 *     across engines — that is why this module exists — but it is accurate, so
 *     it makes a good correctness oracle within a tolerance.
 *  3. Exact bit patterns are pinned. These are this implementation's own
 *     outputs: they define "unchanged". Any edit that moves a single bit moves
 *     every replay hash, and this layer makes that visible and deliberate
 *     (concept §8.2 rule 7).
 */
import { describe, expect, it } from 'vitest';

import { HALF_PI, PI, TAU, atan, atan2, cos, exp, log, pow2, sin } from './math.js';

const view = new DataView(new ArrayBuffer(8));

/** Big-endian hex of the IEEE-754 bits — the only comparison that proves "same value". */
function bits(x: number): string {
  view.setFloat64(0, x, false);
  const hi = (view.getUint32(0, false) >>> 0).toString(16).padStart(8, '0');
  const lo = (view.getUint32(4, false) >>> 0).toString(16).padStart(8, '0');
  return hi + lo;
}

/**
 * Number of trailing zero bits in the mantissa. A Cody-Waite high part needs
 * enough of them that multiplying it by the reduction count stays exact:
 * n trailing zeros buy exactness for |k| < 2^n.
 */
function trailingZeroMantissaBits(x: number): number {
  view.setFloat64(0, x, true);
  const lo = view.getUint32(0, true);
  if (lo !== 0) {
    let n = 0;
    while (((lo >>> n) & 1) === 0) n++;
    return n;
  }
  const mantissaHigh = view.getUint32(4, true) & 0x000fffff;
  if (mantissaHigh === 0) return 52;
  let n = 0;
  while (((mantissaHigh >>> n) & 1) === 0) n++;
  return 32 + n;
}

const ULP1 = 2.220446049250313e-16;

function maxAbsError(
  mine: (x: number) => number,
  reference: (x: number) => number,
  lo: number,
  hi: number,
  samples = 20000,
): number {
  let worst = 0;
  for (let i = 0; i <= samples; i++) {
    const x = lo + ((hi - lo) * i) / samples;
    const error = Math.abs(mine(x) - reference(x));
    if (error > worst) worst = error;
  }
  return worst;
}

function maxRelError(
  mine: (x: number) => number,
  reference: (x: number) => number,
  lo: number,
  hi: number,
  samples = 20000,
): number {
  let worst = 0;
  for (let i = 0; i <= samples; i++) {
    const x = lo + ((hi - lo) * i) / samples;
    const expected = reference(x);
    if (expected === 0 || !Number.isFinite(expected)) continue;
    const error = Math.abs((mine(x) - expected) / expected);
    if (error > worst) worst = error;
  }
  return worst;
}

describe('split constants', () => {
  // These reconstruct the exact same doubles the host uses, which is what makes
  // the reduction good to ~1e-30 rather than ~1e-16.
  it('reconstructs π/2 and ln 2 exactly', () => {
    expect(1.5707963267341256 + 6.077100506506192e-11).toBe(Math.PI / 2);
    expect(0.6931471803691238 + 1.9082149292705877e-10).toBe(Math.LN2);
  });

  it('leaves the high parts enough trailing zeros for an exact k · HI', () => {
    // sin/cos reduce with |k| < 2^20; exp with |k| <= 1024. Both products stay
    // exact only while the high part is short enough.
    expect(trailingZeroMantissaBits(1.5707963267341256)).toBeGreaterThanOrEqual(20);
    expect(trailingZeroMantissaBits(0.6931471803691238)).toBeGreaterThanOrEqual(11);
  });

  it('exports the circle constants the host agrees with', () => {
    expect(PI).toBe(Math.PI);
    expect(TAU).toBe(2 * Math.PI);
    expect(HALF_PI).toBe(Math.PI / 2);
  });
});

describe('pow2', () => {
  it('is exact across the whole double range', () => {
    for (let k = -1074; k <= 1023; k++) {
      expect(pow2(k)).toBe(Math.pow(2, k));
    }
  });

  it('saturates outside that range', () => {
    expect(pow2(2047)).toBe(Infinity);
    expect(pow2(-2045)).toBe(0);
  });
});

describe('accuracy against the host library', () => {
  // sin/cos are bounded by 1, so absolute error against ulp(1) is the honest
  // metric: near a zero crossing no implementation can be relatively accurate.
  it('sin/cos stay within half an ulp over ±2π', () => {
    expect(maxAbsError(sin, Math.sin, -TAU, TAU)).toBeLessThanOrEqual(ULP1);
    expect(maxAbsError(cos, Math.cos, -TAU, TAU)).toBeLessThanOrEqual(ULP1);
  });

  it('sin/cos hold up after argument reduction at ±1e6 rad', () => {
    expect(maxAbsError(sin, Math.sin, -1e6, 1e6)).toBeLessThanOrEqual(2 * ULP1);
    expect(maxAbsError(cos, Math.cos, -1e6, 1e6)).toBeLessThanOrEqual(2 * ULP1);
  });

  it('exp stays within a few ulp across its usable range', () => {
    expect(maxRelError(exp, Math.exp, -700, 700)).toBeLessThan(4 * ULP1);
  });

  it('log stays within a few ulp across six decades', () => {
    expect(maxRelError(log, Math.log, 1e-6, 1e6)).toBeLessThan(4 * ULP1);
  });

  it('atan and atan2 stay within a few ulp', () => {
    expect(maxRelError(atan, Math.atan, -50, 50)).toBeLessThan(8 * ULP1);
    expect(
      maxRelError(
        (x) => atan2(1, x),
        (x) => Math.atan2(1, x),
        -50,
        50,
      ),
    ).toBeLessThan(8 * ULP1);
    expect(
      maxRelError(
        (x) => atan2(x, 1),
        (x) => Math.atan2(x, 1),
        -50,
        50,
      ),
    ).toBeLessThan(8 * ULP1);
  });
});

describe('edge cases', () => {
  it('preserves signed zero where IEEE-754 does', () => {
    expect(bits(sin(0))).toBe(bits(0));
    expect(bits(sin(-0))).toBe(bits(-0));
    expect(bits(sin(-0))).toBe(bits(Math.sin(-0)));
    expect(bits(atan(-0))).toBe(bits(-0));
    expect(bits(atan2(-0, 1))).toBe(bits(-0));
  });

  it('matches the host on the atan2 axes', () => {
    expect(atan2(0, -1)).toBe(Math.atan2(0, -1));
    expect(bits(atan2(-0, -1))).toBe(bits(Math.atan2(-0, -1)));
    expect(atan2(1, 0)).toBe(Math.atan2(1, 0));
    expect(atan2(-1, 0)).toBe(Math.atan2(-1, 0));
    expect(bits(atan2(0, 0))).toBe(bits(Math.atan2(0, 0)));
    expect(bits(atan2(-0, 0))).toBe(bits(Math.atan2(-0, 0)));
    expect(atan2(0, -0)).toBe(Math.atan2(0, -0));
  });

  it('handles exp and log boundaries', () => {
    expect(exp(710)).toBe(Infinity);
    expect(exp(-746)).toBe(0);
    expect(log(0)).toBe(-Infinity);
    expect(log(-1)).toBeNaN();
    expect(log(Infinity)).toBe(Infinity);
    // Subnormal input: the exponent has to be recovered by scaling first.
    expect(log(5e-324)).toBe(Math.log(5e-324));
  });

  it('propagates NaN', () => {
    expect(sin(NaN)).toBeNaN();
    expect(cos(NaN)).toBeNaN();
    expect(atan(NaN)).toBeNaN();
    expect(atan2(NaN, 1)).toBeNaN();
    expect(atan2(1, NaN)).toBeNaN();
    expect(exp(NaN)).toBeNaN();
    expect(log(NaN)).toBeNaN();
  });

  it('lands exactly on the values a reader would check by hand', () => {
    expect(sin(HALF_PI)).toBe(1);
    expect(cos(0)).toBe(1);
    expect(cos(PI)).toBe(-1);
    expect(atan(1)).toBe(PI / 4);
    expect(exp(0)).toBe(1);
    expect(log(1)).toBe(0);
    expect(log(2)).toBe(Math.LN2);
  });
});

describe('pinned vectors', () => {
  // Generated from this implementation. Updating them is a breaking change and
  // must be justified in the commit that does it.
  const SIN: [number, string][] = [
    [0, '0000000000000000'],
    [0.5, '3fdeaee8744b05f0'],
    [1, '3feaed548f090cee'],
    [-1, 'bfeaed548f090cee'],
    [1.5707963267948966, '3ff0000000000000'],
    [3.141592653589793, '3ca1a62633100000'],
    [6.283185307179586, 'bcb1a62633100000'],
    [100, 'bfe03425b78c4db8'],
    [-100, '3fe03425b78c4db8'],
    [12345.6789, 'bfe68298a1cec146'],
  ];
  const COS: [number, string][] = [
    [0, '3ff0000000000000'],
    [0.5, '3fec1528065b7d50'],
    [1, '3fe14a280fb5068c'],
    [-1, '3fe14a280fb5068c'],
    [1.5707963267948966, '3c91a62633100000'],
    [3.141592653589793, 'bff0000000000000'],
    [6.283185307179586, '3ff0000000000000'],
    [100, '3feb981dbf665fe0'],
    [-100, '3feb981dbf665fe0'],
    [12345.6789, '3fe6be7c89fe4a8e'],
  ];
  const ATAN: [number, string][] = [
    [0, '0000000000000000'],
    [0.25, '3fcf5b75f92c80dd'],
    [1, '3fe921fb54442d18'],
    [-1, 'bfe921fb54442d18'],
    [3, '3ff3fc176b7a8560'],
    [-7.5, 'bff7030cf9403196'],
    [1000, '3ff91de2c0e658bc'],
    [-0.0001, 'bf1a36e2e9a4f662'],
  ];
  const EXP: [number, string][] = [
    [0, '3ff0000000000000'],
    [1, '4005bf0a8b14576a'],
    [-1, '3fd78b56362cef38'],
    [0.5, '3ffa61298e1e069c'],
    [10, '40d5829dcf950560'],
    [-10, '3f07cd79b5647c9a'],
    [100, '48f3494a9b171bf5'],
    [-100, '36ea8c1f14e2af5d'],
    [709, '7fdd422d2be5dc9b'],
  ];
  const LOG: [number, string][] = [
    [1, '0000000000000000'],
    [2, '3fe62e42fefa39ef'],
    [0.5, 'bfe62e42fefa39ef'],
    [10, '40026bb1bbb55516'],
    [100, '40126bb1bbb55516'],
    [0.000001, 'c02ba18a998fffa0'],
    [1000000, '402ba18a998fffa0'],
    [6378137, '402f5636c4ef396b'],
    [398600.4418, '4029ca9b212f55db'],
  ];
  const ATAN2: [number, number, string][] = [
    [1, 1, '3fe921fb54442d18'],
    [1, -1, '4002d97c7f3321d2'],
    [-1, -1, 'c002d97c7f3321d2'],
    [-1, 1, 'bfe921fb54442d18'],
    [0, 5, '0000000000000000'],
    [3, 4, '3fe4978fa3269ee1'],
    [-2.5, 0.75, 'bff4782cbabc8156'],
    [1e-8, 1, '3e45798ee2308c3a'],
  ];

  it.each([
    ['sin', sin, SIN],
    ['cos', cos, COS],
    ['atan', atan, ATAN],
    ['exp', exp, EXP],
    ['log', log, LOG],
  ] as [string, (x: number) => number, [number, string][]][])(
    '%s reproduces its pinned bits',
    (_name, fn, vectors) => {
      for (const [input, expected] of vectors) {
        expect(`${input} -> ${bits(fn(input))}`).toBe(`${input} -> ${expected}`);
      }
    },
  );

  it('atan2 reproduces its pinned bits', () => {
    for (const [y, x, expected] of ATAN2) {
      expect(`atan2(${y}, ${x}) -> ${bits(atan2(y, x))}`).toBe(`atan2(${y}, ${x}) -> ${expected}`);
    }
  });
});
