/**
 * The three markets and the weekly board (concept §6.2).
 *
 * Government, commercial and science are not a ladder — they are three
 * different things to be good at, and reputation is tracked per market so
 * being trusted by one says nothing about the others. Taking work in one
 * market cools the others slightly, which is what stops a campaign from
 * settling into a single loop and calling it a strategy.
 *
 * The board is generated, not authored: `hash64(campaignSeed, week, …)` picks
 * which templates appear and what they pay, so a campaign's week 7 is the same
 * week 7 on every machine and in every replay of it.
 */
import { hashUnit } from '../sim/rng.js';
import type { QaLevel } from '../sim/parts/partInstance.js';

import type { CampaignState } from './campaign.js';
import { MARKETS, adjustReputation } from './campaign.js';
import type { MarketId } from './doctrine.js';

export interface MarketDef {
  readonly title: string;
  readonly character: string;
  readonly reputationOnSuccess: number;
  readonly reputationOnFailure: number;
  /** What taking work here costs you in the other two markets (§6.2). */
  readonly crossMarketPenalty: number;
}

export interface ContractTemplate {
  readonly id: string;
  readonly market: MarketId;
  readonly title: string;
  readonly feeBand: readonly [number, number];
  /** Standing the market wants before it will talk to you. */
  readonly minimumReputation: number;
  /** The lowest QA the customer will accept on every slot. */
  readonly requiredQaLevel: QaLevel;
  /** The most loss-of-mission risk the customer will sign off on (§5.4). */
  readonly maxAcceptedRisk: number;
  readonly researchData: number;
}

export interface ContractsData {
  readonly markets: Readonly<Record<MarketId, MarketDef>>;
  readonly templates: readonly ContractTemplate[];
  /** Share of the fee a failure costs on top of not being paid. */
  readonly penaltyFraction: number;
  readonly boardSize: number;
}

/** One offer on this week's board. */
export interface Contract {
  readonly templateId: string;
  readonly market: MarketId;
  readonly title: string;
  readonly fee: number;
  readonly penalty: number;
  readonly requiredQaLevel: QaLevel;
  readonly maxAcceptedRisk: number;
  readonly researchData: number;
  /** True when it is only on the board because of the minimum guarantee. */
  readonly guaranteed: boolean;
}

function feeFor(
  template: ContractTemplate,
  data: ContractsData,
  seed: number,
  week: number,
): Contract {
  const key = `week-${week}/${template.id}`;
  const [low, high] = template.feeBand;
  const fee = Math.round(low + hashUnit(seed, key, 'contractFee') * (high - low));
  return {
    templateId: template.id,
    market: template.market,
    title: template.title,
    fee,
    penalty: Math.round(fee * data.penaltyFraction),
    requiredQaLevel: template.requiredQaLevel,
    maxAcceptedRisk: template.maxAcceptedRisk,
    researchData: template.researchData,
    guaranteed: false,
  };
}

/** Whether the campaign's standing in a market clears a template's bar. */
export function isOffered(template: ContractTemplate, campaign: CampaignState): boolean {
  return campaign.reputation[template.market] >= template.minimumReputation;
}

/**
 * This week's board.
 *
 * §6.2's **minimum guarantee**: every market contributes at least one offer
 * the campaign can actually take, whatever its reputation. Neglecting a market
 * makes its terms worse — the cheap template is the one that stays reachable —
 * but it never locks the player out, because a board that can lock you out
 * turns one bad week into a campaign you cannot recover from.
 */
export function generateBoard(
  data: ContractsData,
  campaign: CampaignState,
  week: number,
): Contract[] {
  const board: Contract[] = [];
  const used = new Set<string>();

  for (const market of MARKETS) {
    const reachable = data.templates.filter(
      (template) => template.market === market && isOffered(template, campaign),
    );
    if (reachable.length === 0) continue;
    // The best one the campaign has earned, so standing shows up as better
    // terms rather than as more entries.
    const best = reachable.reduce((a, b) => (b.feeBand[1] > a.feeBand[1] ? b : a));
    board.push({ ...feeFor(best, data, campaign.seed, week), guaranteed: true });
    used.add(best.id);
  }

  // The rest of the board is drawn, so a week is not simply the same three.
  const pool = data.templates.filter(
    (template) => !used.has(template.id) && isOffered(template, campaign),
  );
  const ranked = pool
    .map((template) => ({
      template,
      roll: hashUnit(campaign.seed, `week-${week}/${template.id}`, 'boardDraw'),
    }))
    .sort((a, b) => a.roll - b.roll || (a.template.id < b.template.id ? -1 : 1));

  for (const entry of ranked) {
    if (board.length >= data.boardSize) break;
    board.push(feeFor(entry.template, data, campaign.seed, week));
  }

  // Market order, then fee, so the board reads the same way every week.
  return board.sort(
    (a, b) => MARKETS.indexOf(a.market) - MARKETS.indexOf(b.market) || b.fee - a.fee,
  );
}

export interface ContractOutcome {
  readonly paid: number;
  readonly researchData: number;
}

/**
 * Books the result of a flown contract.
 *
 * Success pays the fee and lifts the market's standing; failure costs the
 * penalty and drops it further than success lifted it, because a customer
 * remembers a loss longer than a delivery. Either way the other two markets
 * cool slightly (§6.2) — attention spent here was not spent there.
 */
export function settleContract(
  data: ContractsData,
  campaign: CampaignState,
  contract: Contract,
  succeeded: boolean,
): ContractOutcome {
  const market = data.markets[contract.market];
  const paid = succeeded ? contract.fee : -contract.penalty;

  campaign.capital += paid;
  adjustReputation(
    campaign,
    contract.market,
    succeeded ? market.reputationOnSuccess : market.reputationOnFailure,
  );
  for (const other of MARKETS) {
    if (other !== contract.market) adjustReputation(campaign, other, market.crossMarketPenalty);
  }

  campaign.missionsFlown += 1;
  campaign.week += 1;

  return { paid, researchData: succeeded ? contract.researchData : 0 };
}

/**
 * Whether a vehicle meets what the customer asked for (§6.2).
 *
 * Two separate bars, and they fail differently: a QA level the customer will
 * not accept is a vehicle you may not fly for them at all, while too much
 * accepted risk is a signature they will not give. Both are checkable in the
 * planner before anything is built, which is the point.
 */
export function meetsRequirements(
  contract: Contract,
  slotQaLevels: readonly QaLevel[],
  qaOrder: readonly QaLevel[],
  acceptedRisk: number,
): { readonly ok: boolean; readonly reasons: readonly string[] } {
  const reasons: string[] = [];
  const required = qaOrder.indexOf(contract.requiredQaLevel);

  // Flight-proven certifies the value like qualification does, so it clears a
  // testing bar even though it sits last in the cost ordering.
  const clears = (level: QaLevel): boolean =>
    level === 'flightProven' || qaOrder.indexOf(level) >= required;

  if (!slotQaLevels.every(clears)) {
    reasons.push(`Customer requires ${contract.requiredQaLevel} on every slot.`);
  }
  if (acceptedRisk > contract.maxAcceptedRisk) {
    reasons.push(
      `Customer will not sign off above ${(contract.maxAcceptedRisk * 100).toFixed(0)} % loss of mission.`,
    );
  }
  return { ok: reasons.length === 0, reasons };
}
