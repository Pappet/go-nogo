/**
 * Deterministic transcendental functions (concept §8.2 rule 5).
 *
 * ECMAScript does not require `Math.sin`, `Math.exp` and friends to be
 * correctly rounded — two engines may legitimately differ in the last bits.
 * That is enough to desync a replay, so the simulation never calls them.
 *
 * Everything here is built from operations IEEE-754 pins down exactly:
 * `+`, `-`, `*`, `/`, comparisons, and the bit layout of a double. The same
 * input therefore produces the same bits in every engine, which is the whole
 * point — accuracy is the second goal, reproducibility the first.
 *
 * The polynomial coefficients are Taylor terms written as divisions of exact
 * integers (every factorial used is below 2^53, so the division is a single
 * correctly-rounded operation). The argument-reduction constants are split
 * into a high part with enough trailing mantissa zeros that multiplying it by
 * the reduction count stays exact, plus a correction term; `math.test.ts`
 * verifies both properties, so a mistyped digit fails loudly instead of
 * quietly costing precision.
 *
 * Any change to this file moves every replay hash: it is a breaking change
 * in the sense of concept §8.2 rule 7.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

/** 2/π, used only to pick the quadrant — an error here costs nothing. */
const TWO_OVER_PI = 0.6366197723675814;

/**
 * π/2 = PIO2_HI + PIO2_LO to about 1e-30. PIO2_HI carries only 31 significant
 * bits (22 trailing mantissa zeros), so k·PIO2_HI is exact for |k| < 2^22.
 */
const PIO2_HI = 1.5707963267341256;
const PIO2_LO = 6.077100506506192e-11;

/** ln 2 = LN2_HI + LN2_LO. LN2_HI has 21 trailing mantissa zeros — exp needs |k| <= 1024. */
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;

const LOG2E = 1.4426950408889634;
const SQRT2 = 1.4142135623730951;

/** exp overflows above this and flushes to zero below the second bound. */
const EXP_MAX = 709.782712893384;
const EXP_MIN = -745.1332191019411;

// ---------- Bit-level helpers ----------
// A single scratch view: JavaScript is single-threaded, so reusing it is safe
// and keeps these helpers allocation-free.

const scratch = new DataView(new ArrayBuffer(8));

function fromWords(hi: number, lo: number): number {
  scratch.setUint32(4, hi >>> 0, true);
  scratch.setUint32(0, lo >>> 0, true);
  return scratch.getFloat64(0, true);
}

/**
 * 2^k, exactly. Powers of two are representable, so this is a bit pattern
 * rather than a computation. Outside the normal exponent range the result is
 * built in two steps so that subnormals and overflow still behave.
 */
export function pow2(k: number): number {
  if (k > 1023) {
    return k > 2046 ? Infinity : pow2(1023) * pow2(k - 1023);
  }
  if (k < -1022) {
    return k < -2044 ? 0 : pow2(-1022) * pow2(k + 1022);
  }
  return fromWords((k + 1023) << 20, 0);
}

// ---------- sin / cos ----------

/** Quadrant and remainder of the last `reduce` call — see the scratch note above. */
let reducedQuadrant = 0;
let reducedRemainder = 0;

/**
 * Cody-Waite reduction: x = quadrant·(π/2) + r with |r| <= π/4.
 *
 * `k * PIO2_HI` is exact as long as k fits in 20 bits, which is why the
 * accuracy contract stops at |x| < 2^20 rad — far beyond any angle the
 * simulation produces.
 */
function reduce(x: number): void {
  const k = Math.round(x * TWO_OVER_PI);
  reducedRemainder = x - k * PIO2_HI - k * PIO2_LO;
  reducedQuadrant = ((k % 4) + 4) % 4;
}

/** sin(r) for |r| <= π/4, Taylor to r^17. */
function sinKernel(r: number): number {
  const z = r * r;
  let p = 1 / 355687428096000; //  z^8, 1/17!
  p = p * z - 1 / 1307674368000; //  1/15!
  p = p * z + 1 / 6227020800; //  1/13!
  p = p * z - 1 / 39916800; //  1/11!
  p = p * z + 1 / 362880; //  1/9!
  p = p * z - 1 / 5040; //  1/7!
  p = p * z + 1 / 120; //  1/5!
  p = p * z - 1 / 6; //  1/3!
  p = p * z + 1;
  return r * p;
}

/** cos(r) for |r| <= π/4, Taylor to r^16. */
function cosKernel(r: number): number {
  const z = r * r;
  let p = 1 / 20922789888000; //  z^8, 1/16!
  p = p * z - 1 / 87178291200; //  1/14!
  p = p * z + 1 / 479001600; //  1/12!
  p = p * z - 1 / 3628800; //  1/10!
  p = p * z + 1 / 40320; //  1/8!
  p = p * z - 1 / 720; //  1/6!
  p = p * z + 1 / 24; //  1/4!
  p = p * z - 1 / 2; //  1/2!
  return p * z + 1;
}

export function sin(x: number): number {
  // The reduction turns -0 into +0 (a - a is +0), and a stray sign bit would
  // reach the state hash as a different byte pattern. Keep IEEE's answer.
  if (x === 0) return x;
  reduce(x);
  const r = reducedRemainder;
  switch (reducedQuadrant) {
    case 0:
      return sinKernel(r);
    case 1:
      return cosKernel(r);
    case 2:
      return -sinKernel(r);
    default:
      return -cosKernel(r);
  }
}

export function cos(x: number): number {
  reduce(x);
  const r = reducedRemainder;
  switch (reducedQuadrant) {
    case 0:
      return cosKernel(r);
    case 1:
      return -sinKernel(r);
    case 2:
      return -cosKernel(r);
    default:
      return sinKernel(r);
  }
}

// ---------- atan / atan2 ----------

/**
 * atan(t) for |t| <= ~0.1, Taylor in t^2 to t^17.
 * Callers halve their argument until it is that small.
 */
function atanKernel(t: number): number {
  const z = t * t;
  let p = 1 / 17;
  p = p * z - 1 / 15;
  p = p * z + 1 / 13;
  p = p * z - 1 / 11;
  p = p * z + 1 / 9;
  p = p * z - 1 / 7;
  p = p * z + 1 / 5;
  p = p * z - 1 / 3;
  p = p * z + 1;
  return t * p;
}

/** atan(t) = 2·atan(t / (1 + sqrt(1 + t²))) — halves the argument exactly. */
function halveArgument(t: number): number {
  return t / (1 + Math.sqrt(1 + t * t));
}

export function atan(x: number): number {
  if (x !== x) return NaN;
  if (x === 0) return x; // preserves -0
  const negative = x < 0;
  const a = negative ? -x : x;

  // Above 1 the series converges slowly; the reciprocal identity is exact.
  const inverted = a > 1;
  let t = inverted ? 1 / a : a;

  // Three halvings bring |t| <= 1 down to <= 0.0985, where the kernel is
  // accurate to well under an ulp.
  t = halveArgument(t);
  t = halveArgument(t);
  t = halveArgument(t);

  let result = 8 * atanKernel(t);
  if (inverted) result = HALF_PI - result;
  return negative ? -result : result;
}

export function atan2(y: number, x: number): number {
  if (y !== y || x !== x) return NaN;

  if (x === 0) {
    if (y > 0) return HALF_PI;
    if (y < 0) return -HALF_PI;
    // Both zero: the sign of x decides, as in IEEE-754.
    return 1 / x < 0 ? (1 / y < 0 ? -PI : PI) : y;
  }

  const ratio = atan(y / x);
  if (x > 0) return ratio;
  if (y < 0 || (y === 0 && 1 / y < 0)) return ratio - PI;
  return ratio + PI;
}

// ---------- exp / log ----------

export function exp(x: number): number {
  if (x !== x) return NaN;
  if (x > EXP_MAX) return Infinity;
  if (x < EXP_MIN) return 0;

  // x = k·ln2 + r with |r| <= ln2/2, so e^x = 2^k · e^r.
  const k = Math.round(x * LOG2E);
  const r = x - k * LN2_HI - k * LN2_LO;

  let p = 1 / 87178291200; //  r^14, 1/14!
  p = p * r + 1 / 6227020800; //  1/13!
  p = p * r + 1 / 479001600; //  1/12!
  p = p * r + 1 / 39916800; //  1/11!
  p = p * r + 1 / 3628800; //  1/10!
  p = p * r + 1 / 362880; //  1/9!
  p = p * r + 1 / 40320; //  1/8!
  p = p * r + 1 / 5040; //  1/7!
  p = p * r + 1 / 720; //  1/6!
  p = p * r + 1 / 120; //  1/5!
  p = p * r + 1 / 24; //  1/4!
  p = p * r + 1 / 6; //  1/3!
  p = p * r + 1 / 2; //  1/2!
  p = p * r + 1;
  p = p * r + 1;

  return p * pow2(k);
}

export function log(x: number): number {
  if (x !== x) return NaN;
  if (x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;

  let value = x;
  let exponent = 0;

  // Subnormals carry no exponent bits; scale them into the normal range first.
  if (value < 2.2250738585072014e-308) {
    value = value * pow2(64);
    exponent = -64;
  }

  // Read both words before touching the scratch view again.
  scratch.setFloat64(0, value, true);
  const hi = scratch.getUint32(4, true);
  const lo = scratch.getUint32(0, true);
  exponent += ((hi >>> 20) & 0x7ff) - 1023;

  // Mantissa forced into [1, 2), then centred on 1 so the series stays short.
  let m = fromWords((hi & 0x000fffff) | 0x3ff00000, lo);
  if (m > SQRT2) {
    m = m / 2;
    exponent += 1;
  }

  const s = (m - 1) / (m + 1);
  const z = s * s;

  let p = 1 / 25;
  p = p * z + 1 / 23;
  p = p * z + 1 / 21;
  p = p * z + 1 / 19;
  p = p * z + 1 / 17;
  p = p * z + 1 / 15;
  p = p * z + 1 / 13;
  p = p * z + 1 / 11;
  p = p * z + 1 / 9;
  p = p * z + 1 / 7;
  p = p * z + 1 / 5;
  p = p * z + 1 / 3;
  p = p * z + 1;

  // Split ln2 keeps the exponent term exact for large |exponent|.
  return exponent * LN2_HI + (exponent * LN2_LO + 2 * s * p);
}
