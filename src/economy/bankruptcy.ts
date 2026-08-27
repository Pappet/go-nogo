/**
 * Bankruptcy as a soft fail (concept §6.6).
 *
 * The account below zero for two weeks does not end the campaign — an investor
 * takes it over. Debt cleared, and in exchange: the next three contracts are
 * dictated, one tech branch freezes, and every market's opinion drops. §6.6 is
 * explicit that this is "a painful *consequence of decisions*, not a game-over
 * screen", which is the same philosophy as the rest of the game. Failing is
 * supposed to leave you somewhere, not nowhere.
 *
 * Two clarifications from §6.6 are load-bearing and easy to get wrong:
 *
 * - The freeze prefers a branch that has *not* been forked yet. A fork already
 *   taken is never changed retroactively — the player made that choice and
 *   gets to keep having made it.
 * - Dictated contracts are generated only from unlocked tech, so they are
 *   always flyable. The soft fail is meant to punish, not to suffocate.
 *
 * A second bankruptcy in the same campaign ends it.
 */
import type { CampaignState } from './campaign.js';
import { MARKETS, adjustReputation } from './campaign.js';
import type { TechBranch, TechState } from './techTree.js';

export interface BankruptcyState {
  /** Consecutive weeks the account has been below zero. */
  weeksInDebt: number;
  /** How many times the investor has stepped in. Two ends the campaign. */
  takeovers: number;
  /** Branch the investor froze, if any. */
  frozenBranchId: string | null;
  /** Contracts the investor still dictates. */
  dictatedRemaining: number;
  /** True once the campaign is over for good (§6.6). */
  ended: boolean;
}

export function createBankruptcyState(): BankruptcyState {
  return {
    weeksInDebt: 0,
    takeovers: 0,
    frozenBranchId: null,
    dictatedRemaining: 0,
    ended: false,
  };
}

/** Weeks below zero before the investor moves (§6.6). */
export const GRACE_WEEKS = 2;
export const DICTATED_CONTRACTS = 3;
const REPUTATION_HIT = -12;

/**
 * Which branch the investor freezes.
 *
 * Unforked first, per §6.6. If every branch is already forked there is nothing
 * left to take that would not rewrite a decision, so nothing is frozen and the
 * takeover lands entirely in reputation and dictated work — the honest outcome
 * rather than a punishment invented to fill the slot.
 */
export function branchToFreeze(
  branches: readonly TechBranch[],
  tech: TechState,
): string | null {
  const unforked = branches.filter((branch) => tech.forks[branch.id] === undefined);
  return unforked[0]?.id ?? null;
}

export interface TakeoverResult {
  readonly happened: boolean;
  readonly ended: boolean;
  readonly frozenBranchId: string | null;
}

/**
 * Called once per week, after the books are settled.
 *
 * Counts weeks in debt, and steps in when the count reaches the grace period.
 * The counter resets the moment the account is positive again: two bad weeks
 * separated by a good one are two bad weeks, not a crisis.
 */
export function reviewFinances(
  state: BankruptcyState,
  campaign: CampaignState,
  branches: readonly TechBranch[],
  tech: TechState,
): TakeoverResult {
  if (state.ended) return { happened: false, ended: true, frozenBranchId: state.frozenBranchId };

  if (campaign.capital >= 0) {
    state.weeksInDebt = 0;
    return { happened: false, ended: false, frozenBranchId: state.frozenBranchId };
  }

  state.weeksInDebt += 1;
  if (state.weeksInDebt < GRACE_WEEKS) {
    return { happened: false, ended: false, frozenBranchId: state.frozenBranchId };
  }

  state.takeovers += 1;
  state.weeksInDebt = 0;

  if (state.takeovers >= 2) {
    // §6.6: a second bankruptcy ends the campaign, with a post-mortem to share.
    state.ended = true;
    return { happened: true, ended: true, frozenBranchId: state.frozenBranchId };
  }

  campaign.capital = 0;
  state.frozenBranchId = branchToFreeze(branches, tech);
  state.dictatedRemaining = DICTATED_CONTRACTS;
  for (const market of MARKETS) adjustReputation(campaign, market, REPUTATION_HIT);

  return { happened: true, ended: false, frozenBranchId: state.frozenBranchId };
}

export function isFrozen(state: BankruptcyState, branchId: string): boolean {
  return state.frozenBranchId === branchId;
}

/** True while the investor is still choosing the work (§6.6). */
export function isDictating(state: BankruptcyState): boolean {
  return state.dictatedRemaining > 0;
}

export function recordContractFlown(state: BankruptcyState): void {
  if (state.dictatedRemaining > 0) state.dictatedRemaining -= 1;
}
