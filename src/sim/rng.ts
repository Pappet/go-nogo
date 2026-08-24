/**
 * Deterministic randomness on two tracks (concept §8.2 rule 4).
 *
 * Track 1 — `hash64`: counter-free, configuration-bound draws. The roll for a
 * given key depends only on (seed, key, context), never on how many draws
 * happened before it. That is what makes a post-mortem what-if exact and a
 * retry surgical: change one part and only that part's roll changes.
 *
 * Track 2 — `createStream`: sequential mulberry32 streams for genuine event
 * sequences with no configuration tie. One stream per system, so an extra
 * draw in one system cannot shift another system's sequence.
 *
 * Both are built on `Math.imul`, whose result the language specifies exactly
 * (32-bit integer multiply, bit-identical in every engine). It is not one of
 * the float functions CLAUDE.md rule 2 bans — those are banned precisely
 * because they are *not* pinned down, which is the opposite of the case here.
 * Integer lanes are also what keeps BigInt out of the hot path.
 *
 * The pinned vectors in rng.test.ts define this hash. Changing it is a
 * breaking change and raises the dataVersion (concept §8.2 rule 4).
 */

/** A 64-bit hash as two 32-bit lanes — JavaScript has no exact 64-bit integer. */
export interface Hash64 {
  readonly hi: number;
  readonly lo: number;
}

/** 2^53, the number of distinct values a double can represent in [0, 1). */
const TWO_POW_53 = 9007199254740992;
const TWO_POW_26 = 67108864;
const TWO_POW_32 = 4294967296;

// Odd 32-bit constants from the xmur3/cyrb53 family.
const MIX_A = 2654435761;
const MIX_B = 1597334677;
const AVALANCHE_A = 2246822507;
const AVALANCHE_B = 3266489909;

/** Lanes of the most recent mix — see the allocation note on `hashUnit`. */
let laneHi = 0;
let laneLo = 0;

/**
 * Absorbs one string into both lanes. Each lane uses a different multiplier,
 * so the two halves of the result do not move in lockstep.
 */
function absorb(text: string): void {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    laneHi = Math.imul(laneHi ^ code, MIX_A);
    laneLo = Math.imul(laneLo ^ code, MIX_B);
  }
}

/**
 * Mixes (seed, context, key) into the two lanes.
 *
 * The lengths are absorbed as well: without them ('ab', 'c') and ('a', 'bc')
 * would collide, which would quietly give two different parts the same roll.
 */
function mix(seed: number, key: string, context: string): void {
  const seedLow = seed | 0;
  const seedHigh = Math.floor(seed / TWO_POW_32) | 0;

  laneHi = (0xdeadbeef ^ seedLow) >>> 0;
  laneLo = (0x41c6ce57 ^ seedHigh) >>> 0;

  absorb(context);
  laneHi = Math.imul(laneHi ^ 0x9e3779b9, MIX_A);
  laneLo = Math.imul(laneLo ^ 0x9e3779b9, MIX_B);
  absorb(key);

  laneHi = Math.imul(laneHi ^ context.length, MIX_A);
  laneLo = Math.imul(laneLo ^ key.length, MIX_B);

  // Final avalanche: each lane is folded through the other, so a one-bit
  // change anywhere in the input moves roughly half the bits of both.
  const foldedHi =
    Math.imul(laneHi ^ (laneHi >>> 16), AVALANCHE_A) ^
    Math.imul(laneLo ^ (laneLo >>> 13), AVALANCHE_B);
  const foldedLo =
    Math.imul(laneLo ^ (laneLo >>> 16), AVALANCHE_A) ^
    Math.imul(foldedHi ^ (foldedHi >>> 13), AVALANCHE_B);

  laneHi = foldedHi >>> 0;
  laneLo = foldedLo >>> 0;
}

/**
 * The configuration-bound draw: `hash64(seed, part.serialNo, 'reliability')`.
 * Same inputs, same 64 bits, in any engine and in any order.
 */
export function hash64(seed: number, key: string, context: string): Hash64 {
  mix(seed, key, context);
  return { hi: laneHi, lo: laneLo };
}

/**
 * The same draw as a double in [0, 1), using all 53 bits a double can hold.
 * Allocation-free — this is the form the simulation actually consumes.
 */
export function hashUnit(seed: number, key: string, context: string): number {
  mix(seed, key, context);
  return ((laneHi >>> 5) * TWO_POW_26 + (laneLo >>> 6)) / TWO_POW_53;
}

/** A sequential stream. Its position is state; its draws are order-dependent. */
export interface Stream {
  /** Next raw 32-bit value. */
  nextUint32(): number;
  /** Next value in [0, 1). */
  nextUnit(): number;
}

class Mulberry32 implements Stream {
  private state: number;

  constructor(state: number) {
    this.state = state | 0;
  }

  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  nextUnit(): number {
    return this.nextUint32() / TWO_POW_32;
  }
}

/**
 * One stream per system, named: 'solarActivity', 'market', … The name is
 * hashed into the starting state, so two systems never share a sequence and
 * adding a system does not disturb the others.
 */
export function createStream(seed: number, name: string): Stream {
  mix(seed, name, 'stream');
  return new Mulberry32(laneHi ^ laneLo);
}
