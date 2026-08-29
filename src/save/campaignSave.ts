/**
 * Campaign persistence (concept §8.3, §9).
 *
 * Phase 1 saved a *flight*: a run truncated at a tick, which is all there was
 * to lose. Phase 2 put a company around the flight — capital, standing in
 * three markets, a week, research, a payroll, an investor with opinions — and
 * none of that is recoverable from a command log. A save that stores only the
 * run resumes the right rocket into the wrong company.
 *
 * So the save has two halves, and they fail independently on purpose:
 *
 * - The **campaign** is money and standing. It does not depend on physics, so
 *   a change to the tuning data does not invalidate it.
 * - The **mission** is the flight in progress: the run, the tick it was cut
 *   at, and the exact inputs the mission was configured with. That half *is*
 *   physics, and it is dropped when the data it was flown against has moved
 *   (§8.2 rule 7) — losing an ascent is a nuisance, losing a campaign is a
 *   reason not to play again.
 *
 * Nothing here has behaviour. It is the shape on disk and the code that
 * refuses to trust it, which is the only reason this module can be tested
 * without a browser.
 */
import type { BankruptcyState } from '../economy/bankruptcy.js';
import { type CampaignState, MARKETS } from '../economy/campaign.js';
import type { MarketId } from '../economy/doctrine.js';
import type { Contract } from '../economy/markets.js';
import type { SandboxState } from '../economy/scenario.js';
import { SPECIALTIES, type Specialty, type StaffState } from '../economy/staff.js';
import type { TechState } from '../economy/techTree.js';
import type { VehicleConfig } from '../economy/vehicle.js';
import { QA_LEVELS, type QaLevel } from '../sim/parts/partInstance.js';
import type { Run } from '../replay/run.js';

/** Where the browser keeps it. */
export const SAVE_KEY = 'go-nogo/campaign';

/**
 * Bumped by hand when the shape below changes incompatibly.
 *
 * A save whose version this code does not know is discarded rather than
 * guessed at: a half-understood campaign is worse than a fresh one, because
 * the player cannot see which half was understood.
 */
export const SAVE_SCHEMA_VERSION = 1;

/**
 * The flight in progress.
 *
 * The inputs are stored rather than re-derived from the campaign, and that is
 * the whole point of them being here. `settleContract` moves the week and the
 * mission count the instant a flight ends, so a campaign re-read a moment
 * later builds the *next* mission's vehicle — and the player resumes an ascent
 * with a different mass, a different Δv and a different set of anomalies from
 * the one they were flying. What was flown is a fact; it is written down.
 */
export interface SavedMission {
  /** The run, truncated at `tick` — the mid-mission save (§8.2 rule 9). */
  readonly run: Run;
  readonly tick: number;
  readonly vehicle: VehicleConfig;
  readonly tech: TechState;
  /** Team-query durations as the payroll had left them (§6.5). */
  readonly measureDurations: Readonly<Record<string, number>>;
  /** Science aboard, so the link has something to fail to deliver (§6.3). */
  readonly researchData: number;
  /** True once the flown contract has been booked, so it is booked once. */
  readonly settled: boolean;
  /** Set while a tutorial is being flown; a lesson is not a company (§9). */
  readonly tutorialId: string | null;
}

/** The company between missions. */
export interface SavedCampaign {
  readonly state: CampaignState;
  readonly scenarioId: string;
  /** What is currently built — the planner's last applied decision. */
  readonly vehicle: VehicleConfig;
  readonly contract: Contract | null;
  readonly tech: TechState;
  readonly staff: StaffState;
  readonly finances: BankruptcyState;
  readonly sandbox: SandboxState;
}

export interface SavedGame {
  readonly schemaVersion: number;
  readonly gameVersion: string;
  /** Hash over the data files the mission half was flown against. */
  readonly dataVersion: string;
  readonly campaign: SavedCampaign;
  readonly mission: SavedMission | null;
}

/**
 * The arguments `createMissionConfig` needs to rebuild a saved flight.
 *
 * Named as its own type because two callers have to agree on it exactly: the
 * console that resumes a save, and the test that proves resuming reproduces
 * the run. If they were spelled out twice they would drift, and the drift
 * would be invisible until a player lost an ascent to it.
 */
export interface SavedMissionInputs {
  readonly seed: number;
  readonly missionKey: string;
  readonly vehicle: VehicleConfig;
  readonly tech: TechState;
  readonly measureDurations: Readonly<Record<string, number>>;
  readonly researchData: number;
}

export function savedMissionInputs(mission: SavedMission): SavedMissionInputs {
  return {
    seed: mission.run.seed,
    missionKey: mission.run.configuration.missionKey,
    vehicle: mission.vehicle,
    tech: mission.tech,
    measureDurations: mission.measureDurations,
    researchData: mission.researchData,
  };
}

/**
 * Whether the saved flight still describes a mission this build can fly.
 *
 * Deliberately not asked of the campaign: capital and reputation are numbers
 * about a company, and they mean the same thing however the rocket changed.
 */
export function missionIsFlyable(save: SavedGame, gameVersion: string, dataVersion: string): boolean {
  if (save.mission === null) return false;
  if (save.gameVersion !== gameVersion) return false;
  if (save.dataVersion !== dataVersion) return false;
  // Nothing was ever commanded, so the save restores a vehicle sitting on the
  // pad — no different from starting fresh, and not worth announcing.
  return save.mission.run.commands.length > 0;
}

export function serializeSave(save: SavedGame): string {
  return JSON.stringify(save);
}

// ---------- Reading back something a browser has been holding ----------
//
// Everything below treats the stored text as hostile. It is not: it is what
// this code wrote. But it survived a version upgrade, a hand-edit in devtools
// and whatever else localStorage lived through, and a save that throws on load
// takes the whole console down with it — so the shape is checked rather than
// asserted, and anything unrecognised is a missing save rather than a crash.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberRecord(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isFiniteNumber(entry)) return null;
    out[key] = entry;
  }
  return out;
}

function stringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return null;
    out[key] = entry;
  }
  return out;
}

function isQaLevel(value: unknown): value is QaLevel {
  return typeof value === 'string' && (QA_LEVELS as readonly string[]).includes(value);
}

/**
 * The QA level is checked against the table, not merely against `string`.
 *
 * `buildVehicle` indexes the QA table with it and reads `bandFactor` off the
 * result, so an unrecognised level is not a wrong number — it is a crash on
 * the way to the pad, and it happens to a player whose save looked fine.
 */
function parseVehicle(value: unknown): VehicleConfig | null {
  if (!isRecord(value) || !Array.isArray(value.slots)) return null;
  const slots = [];
  for (const raw of value.slots) {
    if (!isRecord(raw)) return null;
    const { slotId, partId, qaLevel, units } = raw;
    if (typeof slotId !== 'string' || typeof partId !== 'string') return null;
    if (!isQaLevel(qaLevel)) return null;
    if (!Number.isInteger(units) || (units as number) < 1) return null;
    slots.push({ slotId, partId, qaLevel, units: units as number });
  }
  if (slots.length === 0) return null;
  return { slots };
}

function parseTech(value: unknown): TechState | null {
  if (!isRecord(value)) return null;
  const levels = numberRecord(value.levels);
  const forks = stringRecord(value.forks);
  if (levels === null || forks === null || !isFiniteNumber(value.data)) return null;
  return { levels, forks, data: value.data };
}

function isSpecialty(value: unknown): value is Specialty {
  return typeof value === 'string' && (SPECIALTIES as readonly string[]).includes(value);
}

/**
 * The specialty is checked against the four that exist, not against `string`.
 *
 * This one fails soft rather than loudly — `measureDurationOverrides` iterates
 * the known specialties, so an unrecognised one simply never matches — which
 * is exactly why it is worth checking: the engineer still draws a salary every
 * week in `weeklySalaries` while doing nothing at all, and a payroll line that
 * quietly buys nothing is harder to notice than a crash.
 */
function parseStaff(value: unknown): StaffState | null {
  if (!isRecord(value) || !Array.isArray(value.hired)) return null;
  const hired = [];
  for (const raw of value.hired) {
    if (!isRecord(raw)) return null;
    const { id, name, specialty, salary } = raw;
    if (typeof id !== 'string' || typeof name !== 'string') return null;
    if (!isSpecialty(specialty) || !isFiniteNumber(salary)) return null;
    hired.push({ id, name, specialty, salary });
  }
  return { hired };
}

function parseFinances(value: unknown): BankruptcyState | null {
  if (!isRecord(value)) return null;
  const { weeksInDebt, takeovers, frozenBranchId, dictatedRemaining, ended } = value;
  if (!isFiniteNumber(weeksInDebt) || !isFiniteNumber(takeovers)) return null;
  if (!isFiniteNumber(dictatedRemaining) || typeof ended !== 'boolean') return null;
  if (frozenBranchId !== null && typeof frozenBranchId !== 'string') return null;
  return { weeksInDebt, takeovers, frozenBranchId, dictatedRemaining, ended };
}

function parseSandbox(value: unknown): SandboxState | null {
  if (!isRecord(value)) return null;
  if (typeof value.unlocked !== 'boolean' || typeof value.active !== 'boolean') return null;
  return { unlocked: value.unlocked, active: value.active };
}

function parseCampaignState(value: unknown): CampaignState | null {
  if (!isRecord(value)) return null;
  const { doctrineId, seed, capital, week, missionsFlown } = value;
  if (typeof doctrineId !== 'string' || !isFiniteNumber(seed)) return null;
  if (!isFiniteNumber(capital) || !isFiniteNumber(week)) return null;
  if (!isFiniteNumber(missionsFlown)) return null;

  const reputation = numberRecord(value.reputation);
  const vehicle = parseVehicle(value.vehicle);
  if (reputation === null || vehicle === null) return null;
  // Every market, or none. `adjustReputation` reads the standing back out and
  // adds to it, so a missing market does not read as zero — it reads as NaN,
  // and then it spreads through the books quietly.
  if (MARKETS.some((market) => reputation[market] === undefined)) return null;

  return {
    doctrineId,
    seed,
    capital,
    reputation: reputation as Record<MarketId, number>,
    week,
    missionsFlown,
    vehicle,
  };
}

function parseContract(value: unknown): Contract | null {
  if (!isRecord(value)) return null;
  const { templateId, market, title, fee, penalty } = value;
  const { requiredQaLevel, maxAcceptedRisk, researchData, guaranteed } = value;
  if (typeof templateId !== 'string' || typeof market !== 'string') return null;
  if (!(MARKETS as readonly string[]).includes(market)) return null;
  if (typeof title !== 'string' || !isQaLevel(requiredQaLevel)) return null;
  if (!isFiniteNumber(fee) || !isFiniteNumber(penalty)) return null;
  if (!isFiniteNumber(maxAcceptedRisk) || !isFiniteNumber(researchData)) return null;
  if (typeof guaranteed !== 'boolean') return null;
  return {
    templateId,
    market: market as Contract['market'],
    title,
    fee,
    penalty,
    requiredQaLevel,
    maxAcceptedRisk,
    researchData,
    guaranteed,
  };
}

function parseRun(value: unknown): Run | null {
  if (!isRecord(value)) return null;
  const { gameVersion, dataVersion, seed, configuration, commands } = value;
  if (typeof gameVersion !== 'string' || typeof dataVersion !== 'string') return null;
  if (!isFiniteNumber(seed) || !Array.isArray(commands)) return null;
  if (!isRecord(configuration)) return null;
  // The mission key decides every anomaly draw (§8.2 rule 5). A run without
  // one is not a mission anybody can resume — it is a guess at which crisis.
  if (typeof configuration.missionKey !== 'string') return null;
  if (typeof configuration.rocketName !== 'string') return null;

  for (const command of commands) {
    if (!isRecord(command) || !Number.isInteger(command.tick)) return null;
    if (typeof command.type !== 'string') return null;
  }

  return {
    gameVersion,
    dataVersion,
    seed,
    configuration: { rocketName: configuration.rocketName, missionKey: configuration.missionKey },
    commands: commands as Run['commands'],
    // A save re-derives its hashes by replaying, so it never stores any.
    stateHashes: [],
  };
}

function parseMission(value: unknown): SavedMission | null {
  if (!isRecord(value)) return null;
  const run = parseRun(value.run);
  const vehicle = parseVehicle(value.vehicle);
  const tech = parseTech(value.tech);
  const measureDurations = numberRecord(value.measureDurations);
  if (run === null || vehicle === null || tech === null || measureDurations === null) return null;
  if (!Number.isInteger(value.tick) || (value.tick as number) < 0) return null;
  if (!isFiniteNumber(value.researchData) || typeof value.settled !== 'boolean') return null;
  if (value.tutorialId !== null && typeof value.tutorialId !== 'string') return null;

  return {
    run,
    tick: value.tick as number,
    vehicle,
    tech,
    measureDurations,
    researchData: value.researchData,
    settled: value.settled,
    tutorialId: value.tutorialId,
  };
}

function parseCampaign(value: unknown): SavedCampaign | null {
  if (!isRecord(value)) return null;
  const state = parseCampaignState(value.state);
  const vehicle = parseVehicle(value.vehicle);
  const tech = parseTech(value.tech);
  const staff = parseStaff(value.staff);
  const finances = parseFinances(value.finances);
  const sandbox = parseSandbox(value.sandbox);
  if (state === null || vehicle === null || tech === null) return null;
  if (staff === null || finances === null || sandbox === null) return null;
  if (typeof value.scenarioId !== 'string') return null;

  return {
    state,
    scenarioId: value.scenarioId,
    vehicle,
    contract: value.contract === null ? null : parseContract(value.contract),
    tech,
    staff,
    finances,
    sandbox,
  };
}

/**
 * Reads a save, or returns null.
 *
 * Null covers every way this can go wrong — absent, unparseable, written by a
 * schema this build does not know, missing a field — because the console does
 * the same thing in all of them: start a fresh campaign. Distinguishing them
 * would only give the player a more detailed way to be told they lost it.
 */
export function parseSave(text: string | null): SavedGame | null {
  if (text === null) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isRecord(raw)) return null;
  if (raw.schemaVersion !== SAVE_SCHEMA_VERSION) return null;
  if (typeof raw.gameVersion !== 'string' || typeof raw.dataVersion !== 'string') return null;

  const campaign = parseCampaign(raw.campaign);
  if (campaign === null) return null;

  // A mission that does not parse loses the ascent, not the company. That is
  // the same trade the version check makes, for the same reason.
  const mission = raw.mission === null || raw.mission === undefined ? null : parseMission(raw.mission);

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    gameVersion: raw.gameVersion,
    dataVersion: raw.dataVersion,
    campaign,
    mission,
  };
}
