/**
 * Synchronous SHA-256.
 *
 * Web Crypto is asynchronous, and the state hash is taken inside the tick loop
 * every 600 ticks (concept §8.2 rule 8) — an await there would poison the
 * simulation. Node's crypto is not available in the browser. So the algorithm
 * lives here, in about eighty lines, with no dependency.
 *
 * The round constants are *derived*, not recited: K is the fractional part of
 * the cube root of the first 64 primes, H the square root of the first 8, both
 * computed with exact integer arithmetic at module load. A recited table can
 * carry a typo that survives every review; a derived one cannot. The NIST test
 * vectors in sha256.test.ts confirm the whole construction regardless.
 */

/** Largest integer r with r*r <= n. Exact, via Newton's method on BigInt. */
function integerRoot(n: bigint, degree: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << (BigInt(n.toString(2).length) / degree + 1n);
  for (;;) {
    const next = ((degree - 1n) * x + n / x ** (degree - 1n)) / degree;
    if (next >= x) return x;
    x = next;
  }
}

function firstPrimes(count: number): number[] {
  const primes: number[] = [];
  for (let candidate = 2; primes.length < count; candidate++) {
    let isPrime = true;
    for (const prime of primes) {
      if (prime * prime > candidate) break;
      if (candidate % prime === 0) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) primes.push(candidate);
  }
  return primes;
}

const MASK32 = 0xffffffffn;

/** Fractional part of the `degree`-th root of `value`, as a 32-bit integer. */
function rootFraction(value: number, degree: bigint, shift: bigint): number {
  return Number(integerRoot(BigInt(value) << shift, degree) & MASK32);
}

const PRIMES = firstPrimes(64);

/** Cube roots of the first 64 primes: 32 bits of fraction needs a 96-bit shift. */
const K = new Uint32Array(PRIMES.map((prime) => rootFraction(prime, 3n, 96n)));

/** Square roots of the first 8 primes: 32 bits of fraction needs a 64-bit shift. */
const INITIAL_STATE = new Uint32Array(
  PRIMES.slice(0, 8).map((prime) => rootFraction(prime, 2n, 64n)),
);

function rotateRight(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** SHA-256 of `bytes`, as lowercase hex. */
export function sha256(bytes: Uint8Array): string {
  // Padding: 0x80, zeros, then the length in bits as a 64-bit big-endian value.
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9) >>> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  // Lengths beyond 2^32 bits cannot occur here; the high word stays zero.
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 4294967296), false);

  const state = new Uint32Array(INITIAL_STATE);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      const s0 = (rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3)) >>> 0;
      const s1 = (rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;

    for (let i = 0; i < 64; i++) {
      const S1 = (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0;
      const choose = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + S1 + choose + K[i] + w[i]) >>> 0;
      const S0 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (S0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  let hex = '';
  for (const word of state) {
    hex += word.toString(16).padStart(8, '0');
  }
  return hex;
}
