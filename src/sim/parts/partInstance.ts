/**
 * Parts as instances with serial numbers (concept §4, §4.1).
 *
 * The whole component system rests on one decision from §8.2 rule 5: a part's
 * reliability is `hash64(seed, serialNo, 'reliability')`, not a roll taken when
 * the part is built. Serial 4731 is the same part in every what-if, in every
 * retry, in every replay — which is what makes the post-mortem's "an
 * acceptance test would have screened out this valve" a provable statement
 * rather than a plausible one, and what makes §5.4's surgical re-roll possible
 * at all.
 *
 * QA (§4.1) therefore never changes what a part *is*. It changes what you know
 * about it, and — for the acceptance test — which part ends up flying: a unit
 * whose true value falls outside the tightened band is screened out and the
 * next one off the line takes its place. The part was always that good or that
 * bad; the test is what found out in time.
 */
import { hashUnit } from '../rng.js';

/** §4.1, in the order they cost more. */
export const QA_LEVELS = ['series', 'acceptance', 'qualification', 'flightProven'] as const;
export type QaLevel = (typeof QA_LEVELS)[number];

export interface PartDef {
  readonly id: string;
  readonly title: string;
  /** Which engineer's specialisation covers it (§6.5), and which system it fails in. */
  readonly system: 'prop' | 'avionics' | 'comms' | 'power';
  readonly mass_kg: number;
  readonly cost: number;
  /** What the manufacturer will commit to. The true value is drawn inside it. */
  readonly reliabilityBand: readonly [number, number];
  /** Causes this part can produce when it fails, for the risk budget (§5.4). */
  readonly failureCauses: readonly string[];
}

export interface QaLevelDef {
  readonly title: string;
  readonly costMultiplier: number;
  readonly buildDays: number;
  /** How much of the manufacturer band survives the test. 1 = untouched. */
  readonly bandFactor: number;
  /** Hot fire leaves the unit slightly better than it was (§4.1). */
  readonly reliabilityBonus: number;
  /** True once the exact value is on the certificate rather than a band. */
  readonly revealsExactValue: boolean;
  readonly wearAdded: number;
}

export type QaLevelTable = Readonly<Record<QaLevel, QaLevelDef>>;

export interface PartInstance {
  readonly partId: string;
  readonly serialNo: string;
  readonly qaLevel: QaLevel;
  /**
   * What the player is shown. Collapses to a point once QA reveals the exact
   * value; §4 is explicit that the spread is visible and the exact value is
   * not, unless it was paid for.
   */
  readonly visibleBand: readonly [number, number];
  /** The truth. Never shown directly unless `visibleBand` has collapsed onto it. */
  readonly effectiveReliability: number;
  readonly wear: number;
  /** Serials that were built for this slot and screened out before this one. */
  readonly screenedOut: readonly string[];
}

/**
 * The reliability of one specific unit. Depends on the serial number and the
 * campaign seed, and on nothing else — not on the QA level, not on what else
 * is in the vehicle, not on when it was built.
 */
export function drawReliability(
  seed: number,
  serialNo: string,
  band: readonly [number, number],
): number {
  return band[0] + hashUnit(seed, serialNo, 'reliability') * (band[1] - band[0]);
}

/** The band a QA level narrows the manufacturer's promise down to, centred. */
export function tightenedBand(
  band: readonly [number, number],
  factor: number,
): readonly [number, number] {
  const centre = (band[0] + band[1]) / 2;
  const half = ((band[1] - band[0]) * factor) / 2;
  return [centre - half, centre + half];
}

/** The serial a slot's n-th unit carries. Stable across runs by construction. */
export function serialFor(slotId: string, attempt: number): string {
  return `${slotId}#${attempt}`;
}

/** How many units a screening test may reject before it takes what it gets. */
const MAX_SCREENING_ATTEMPTS = 24;

/**
 * Builds the unit that actually flies in a slot.
 *
 * For everything but the acceptance test this is the first serial, full stop.
 * The acceptance test screens: it builds units until one lands inside the
 * tightened band, and the rejects are kept on the instance so the post-mortem
 * can point at them. The search is bounded — a manufacturer having a very bad
 * run must not hang the configurator — and on giving up it flies the last unit
 * with the band it actually has, which is the honest outcome rather than a
 * pretended one.
 */
export function buildPart(
  def: PartDef,
  slotId: string,
  qaLevel: QaLevel,
  qaTable: QaLevelTable,
  seed: number,
  wear = 0,
): PartInstance {
  const qa = qaTable[qaLevel];
  const target = tightenedBand(def.reliabilityBand, qa.bandFactor);

  const screenedOut: string[] = [];
  let serialNo = serialFor(slotId, 0);
  let drawn = drawReliability(seed, serialNo, def.reliabilityBand);

  if (qa.bandFactor < 1) {
    for (let attempt = 1; attempt < MAX_SCREENING_ATTEMPTS && drawn < target[0]; attempt += 1) {
      screenedOut.push(serialNo);
      serialNo = serialFor(slotId, attempt);
      drawn = drawReliability(seed, serialNo, def.reliabilityBand);
    }
  }

  const effectiveReliability = Math.min(1, drawn + qa.reliabilityBonus);
  const passedScreening = drawn >= target[0];

  return {
    partId: def.id,
    serialNo,
    qaLevel,
    visibleBand: qa.revealsExactValue
      ? [effectiveReliability, effectiveReliability]
      : passedScreening
        ? [Math.max(target[0], def.reliabilityBand[0]), Math.min(target[1], def.reliabilityBand[1])]
        : def.reliabilityBand,
    effectiveReliability,
    wear: wear + qa.wearAdded,
    screenedOut,
  };
}

/**
 * What the acceptance test would have found, for the post-mortem's what-if
 * (§7 ⑥). Answers the question the player actually asks after a failure: would
 * paying for the test have changed anything here?
 */
export function wouldHaveBeenScreenedOut(
  instance: PartInstance,
  def: PartDef,
  qaTable: QaLevelTable,
): boolean {
  if (instance.qaLevel !== 'series') return false;
  const target = tightenedBand(def.reliabilityBand, qaTable.acceptance.bandFactor);
  return instance.effectiveReliability < target[0];
}
