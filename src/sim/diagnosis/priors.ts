/**
 * Context priors v1 (concept §5.2, §5.8).
 *
 * The candidate bars are not a fixed table. "Tank pressure dropping" at max-Q
 * has different likely causes than the same reading during coast, and that is
 * the whole defence against the graph flattening out: after fifty hours "55 %"
 * must never have come to mean one particular cause (§5.8).
 *
 * Two sources feed the context. The flight supplies what it knows — the phase
 * it is in. The mission supplies the rest as a seeded profile: whether this
 * vehicle flew a cold profile, carries an old serial number, went through
 * cheap QA. Phase 1 has no configurator to choose those (that is Phase 2), so
 * they are drawn per mission from `hash64` and are as addressable as anything
 * else in a replay.
 *
 * Priors shift the odds; they never decide. Every candidate keeps a share, so
 * a confident-looking bar is still a bet — which is what makes paying for a
 * diagnosis a real decision rather than a formality.
 */
import { hashUnit } from '../rng.js';

import type { CauseGraph } from './causeGraph.js';

export interface MissionTagDef {
  readonly id: string;
  readonly probability: number;
}

export interface PriorSettings {
  /** Multiplier applied once per matching active tag. */
  readonly matchBoost: number;
  /** Tags implied by the countdown phase the vehicle is in. */
  readonly phaseTags: Readonly<Record<string, readonly string[]>>;
  /** Tags drawn once per mission. */
  readonly missionTags: readonly MissionTagDef[];
}

export interface CandidatePrior {
  readonly causeId: string;
  /** Share of the probability mass, 0..1. Sums to 1 across the candidates. */
  readonly probability: number;
  /** The active tags that argued for this cause — what a tooltip explains. */
  readonly matchedTags: readonly string[];
}

/**
 * Draws the mission's standing context. Same mission, same profile — and
 * unrelated draws elsewhere cannot shift it.
 */
export function rollMissionContext(
  settings: PriorSettings,
  seed: number,
  missionKey: string,
): string[] {
  return settings.missionTags
    .filter((tag) => hashUnit(seed, `${missionKey}/${tag.id}`, 'contextTag') < tag.probability)
    .map((tag) => tag.id);
}

/**
 * The tags in force right now: the mission's standing profile plus whatever
 * the current flight phase implies.
 */
export function activeContextTags(
  settings: PriorSettings,
  missionTags: readonly string[],
  phase: string,
): string[] {
  const active = new Set(missionTags);
  for (const tag of settings.phaseTags[phase] ?? []) active.add(tag);
  // Sorted so the set is a stable value, not an insertion-order artefact.
  return [...active].sort();
}

/**
 * Weights the candidates by context.
 *
 * Every candidate starts at one and is multiplied once per matching tag, then
 * the weights are normalised. Starting at one rather than zero is the point:
 * an unmatched cause stays on the board, so the bars never hand the player a
 * certainty they did not pay for.
 */
export function computePriors(
  graph: CauseGraph,
  candidates: readonly string[],
  activeTags: readonly string[],
  settings: PriorSettings,
): CandidatePrior[] {
  if (candidates.length === 0) return [];

  const active = new Set(activeTags);
  const weighted = candidates.map((causeId) => {
    const matchedTags = (graph.cause(causeId).context_priors ?? []).filter((tag) =>
      active.has(tag),
    );
    let weight = 1;
    for (let i = 0; i < matchedTags.length; i++) weight *= settings.matchBoost;
    return { causeId, weight, matchedTags };
  });

  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);

  return weighted
    .map((entry) => ({
      causeId: entry.causeId,
      probability: entry.weight / total,
      matchedTags: entry.matchedTags,
    }))
    // Highest first, then by id — §7.7 needs an ordering that cannot shuffle
    // under the player's hand between two identical readings.
    .sort((a, b) => b.probability - a.probability || (a.causeId < b.causeId ? -1 : 1));
}

/**
 * The ordering the diagnosis panel freezes when it opens (§7.7).
 *
 * Sorting by the prior at open time and then holding it is deliberate: bars
 * that re-sort as new information lands would move the button out from under
 * a player who is already reaching for `Q`.
 */
export function frozenOrder(priors: readonly CandidatePrior[]): string[] {
  return priors.map((prior) => prior.causeId);
}
