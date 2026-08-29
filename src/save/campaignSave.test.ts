/**
 * What the save promises, and what it refuses.
 *
 * The interesting cases are all failure cases. A save that round-trips is
 * table stakes; a save that survives a schema bump, a truncated write and a
 * data file changing underneath it is the reason this module exists at all,
 * because every one of those ends with a player losing a campaign if it is
 * handled by throwing.
 */
import { describe, expect, it } from 'vitest';

import { createCampaign } from '../economy/campaign.js';
import { defaultVehicle, doctrines, scenarios } from '../missionConfig.js';
import { GAME_VERSION, type Run } from '../replay/run.js';

import {
  SAVE_SCHEMA_VERSION,
  type SavedGame,
  missionIsFlyable,
  parseSave,
  savedMissionInputs,
  serializeSave,
} from './campaignSave.js';

const DATA_VERSION = 'a'.repeat(64);

const run: Run = {
  gameVersion: GAME_VERSION,
  dataVersion: DATA_VERSION,
  seed: 1234,
  configuration: { rocketName: 'GN-1 Vanguard', missionKey: 'doctrine_iron/mission-3' },
  commands: [
    { tick: 20, type: 'toggleChecklist', payload: { index: 0 } },
    { tick: 120, type: 'arm', payload: null },
  ],
  stateHashes: [],
};

function aSave(overrides: Partial<SavedGame> = {}): SavedGame {
  const campaign = createCampaign(doctrines[0], 1234, defaultVehicle);
  campaign.capital = 87_500;
  campaign.week = 6;
  campaign.missionsFlown = 2;
  campaign.reputation.science = 31;

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    gameVersion: GAME_VERSION,
    dataVersion: DATA_VERSION,
    campaign: {
      state: campaign,
      scenarioId: scenarios[0].id,
      vehicle: defaultVehicle,
      contract: {
        templateId: 'contract_smallsat',
        market: 'commercial',
        title: 'Smallsat rideshare',
        fee: 42_000,
        penalty: 8_400,
        requiredQaLevel: 'series',
        maxAcceptedRisk: 0.2,
        researchData: 12,
        guaranteed: false,
      },
      tech: { levels: { propulsion: 2 }, forks: { avionics: 'fork_hardened' }, data: 7.5 },
      staff: {
        hired: [{ id: 'eng_4', name: 'R. Okonjo', specialty: 'prop', salary: 1_800 }],
      },
      finances: {
        weeksInDebt: 1,
        takeovers: 0,
        frozenBranchId: null,
        dictatedRemaining: 0,
        ended: false,
      },
      sandbox: { unlocked: true, active: false },
    },
    mission: {
      run,
      tick: 2_400,
      vehicle: defaultVehicle,
      tech: { levels: { propulsion: 2 }, forks: {}, data: 7.5 },
      measureDurations: { measure_pressure_check: 18 },
      researchData: 12,
      settled: false,
      tutorialId: null,
    },
    ...overrides,
  };
}

function roundTrip(save: SavedGame): SavedGame | null {
  return parseSave(serializeSave(save));
}

describe('campaign save', () => {
  it('round-trips the whole company', () => {
    const restored = roundTrip(aSave());

    expect(restored).not.toBeNull();
    expect(restored?.campaign.state.capital).toBe(87_500);
    expect(restored?.campaign.state.week).toBe(6);
    expect(restored?.campaign.state.missionsFlown).toBe(2);
    expect(restored?.campaign.state.reputation.science).toBe(31);
    expect(restored?.campaign.state.seed).toBe(1234);
    expect(restored?.campaign.tech.forks.avionics).toBe('fork_hardened');
    expect(restored?.campaign.staff.hired[0].name).toBe('R. Okonjo');
    expect(restored?.campaign.sandbox.unlocked).toBe(true);
    expect(restored?.campaign.contract?.fee).toBe(42_000);
  });

  it('round-trips the flight in progress, inputs and all', () => {
    const restored = roundTrip(aSave());

    expect(restored?.mission?.tick).toBe(2_400);
    expect(restored?.mission?.run.commands).toHaveLength(2);
    expect(restored?.mission?.measureDurations.measure_pressure_check).toBe(18);
    expect(restored?.mission?.vehicle.slots).toHaveLength(defaultVehicle.slots.length);
  });

  it('hands the mission back as the arguments that rebuilt it', () => {
    // The point of storing the inputs: what comes back is what
    // `createMissionConfig` was called with, not a re-derivation of it.
    const restored = roundTrip(aSave());
    const inputs = savedMissionInputs(restored!.mission!);

    expect(inputs.seed).toBe(1234);
    expect(inputs.missionKey).toBe('doctrine_iron/mission-3');
    expect(inputs.researchData).toBe(12);
    // The slots, not the object: parsing normalises a save down to the shape
    // that is declared, so the description `vehicle.json` carries for the
    // reader does not survive the round trip — and does not need to.
    expect(inputs.vehicle.slots).toEqual(defaultVehicle.slots);
  });

  it('drops a save written by a schema this build does not know', () => {
    // Guessing at half of it is worse than starting fresh, because the player
    // cannot see which half was guessed.
    const text = serializeSave(aSave()).replace(
      `"schemaVersion":${SAVE_SCHEMA_VERSION}`,
      `"schemaVersion":${SAVE_SCHEMA_VERSION + 1}`,
    );
    expect(parseSave(text)).toBeNull();
  });

  it('returns null rather than throwing on anything unreadable', () => {
    expect(parseSave(null)).toBeNull();
    expect(parseSave('')).toBeNull();
    expect(parseSave('{')).toBeNull();
    expect(parseSave('"a string"')).toBeNull();
    expect(parseSave('null')).toBeNull();
    // A write cut off half way through — the case localStorage actually hits.
    expect(parseSave(serializeSave(aSave()).slice(0, 400))).toBeNull();
  });

  it('refuses a campaign missing a field, however plausible the rest looks', () => {
    const save = aSave();
    const broken = JSON.parse(serializeSave(save)) as Record<string, unknown>;
    const campaign = broken.campaign as Record<string, unknown>;
    delete (campaign.state as Record<string, unknown>).capital;

    expect(parseSave(JSON.stringify(broken))).toBeNull();
  });

  it('loses an unreadable flight without losing the company', () => {
    const broken = JSON.parse(serializeSave(aSave())) as Record<string, unknown>;
    (broken.mission as Record<string, unknown>).tick = 'soon';

    const restored = parseSave(JSON.stringify(broken));
    expect(restored?.mission).toBeNull();
    expect(restored?.campaign.state.capital).toBe(87_500);
  });
});

describe('what a changed build may still fly', () => {
  it('accepts a flight recorded against the current data', () => {
    expect(missionIsFlyable(aSave(), GAME_VERSION, DATA_VERSION)).toBe(true);
  });

  it('refuses a flight recorded against different data (§8.2 rule 7)', () => {
    // The books are numbers about a company and mean the same thing either
    // way; the ascent is physics and would not reproduce.
    const save = aSave();
    expect(missionIsFlyable(save, GAME_VERSION, 'b'.repeat(64))).toBe(false);
    expect(parseSave(serializeSave(save))?.campaign.state.capital).toBe(87_500);
  });

  it('refuses a flight recorded by a different build', () => {
    expect(missionIsFlyable(aSave(), '9.9.9', DATA_VERSION)).toBe(false);
  });

  it('refuses a flight nothing was ever commanded in', () => {
    // It restores a vehicle sitting on the pad: no different from starting
    // fresh, and not worth telling the player about.
    const save = aSave();
    const idle: SavedGame = {
      ...save,
      mission: { ...save.mission!, run: { ...run, commands: [] } },
    };
    expect(missionIsFlyable(idle, GAME_VERSION, DATA_VERSION)).toBe(false);
  });

  it('has nothing to fly when the save has no flight in it', () => {
    expect(missionIsFlyable(aSave({ mission: null }), GAME_VERSION, DATA_VERSION)).toBe(false);
  });
});

describe('what a hand-edited save cannot smuggle in', () => {
  // These are the fields that do not merely read wrong — they take the game
  // down or poison the books, so the parser has to catch them rather than
  // trust that only this code ever wrote the file.

  it('refuses a QA level the parts table does not have', () => {
    // `buildVehicle` indexes the QA table with this and reads a field off the
    // result: an unknown level is a crash on the way to the pad.
    const broken = JSON.parse(serializeSave(aSave())) as Record<string, unknown>;
    const campaign = broken.campaign as Record<string, unknown>;
    const vehicle = campaign.vehicle as { slots: Record<string, unknown>[] };
    vehicle.slots[0].qaLevel = 'gold_plated';

    expect(parseSave(JSON.stringify(broken))).toBeNull();
  });

  it('refuses a slot with no units in it', () => {
    const broken = JSON.parse(serializeSave(aSave())) as Record<string, unknown>;
    const campaign = broken.campaign as Record<string, unknown>;
    const vehicle = campaign.vehicle as { slots: Record<string, unknown>[] };
    vehicle.slots[0].units = 0;

    expect(parseSave(JSON.stringify(broken))).toBeNull();
  });

  it('refuses an engineer whose specialty is not one of the four', () => {
    // Fails soft downstream — `measureDurationOverrides` iterates the known
    // specialties, so it never matches — but they keep drawing a salary in
    // `weeklySalaries`, and a payroll line that buys nothing is easy to miss.
    const broken = JSON.parse(serializeSave(aSave())) as Record<string, unknown>;
    const campaign = broken.campaign as Record<string, unknown>;
    const staff = campaign.staff as { hired: Record<string, unknown>[] };
    staff.hired[0].specialty = 'guidance';

    expect(parseSave(JSON.stringify(broken))).toBeNull();
  });

  it('refuses a campaign that has lost a market', () => {
    // `adjustReputation` adds to what it reads back. A missing market does not
    // read as zero, it reads as NaN — and then it spreads through the books.
    const broken = JSON.parse(serializeSave(aSave())) as Record<string, unknown>;
    const campaign = broken.campaign as Record<string, unknown>;
    delete (campaign.state as { reputation: Record<string, number> }).reputation.commercial;

    expect(parseSave(JSON.stringify(broken))).toBeNull();
  });

  it('loses a contract for a market that does not exist', () => {
    const broken = JSON.parse(serializeSave(aSave())) as Record<string, unknown>;
    const campaign = broken.campaign as Record<string, unknown>;
    (campaign.contract as Record<string, unknown>).market = 'defence';

    // The board is regenerated every week anyway, so an unreadable offer costs
    // the player one contract — not the campaign holding it.
    const restored = parseSave(JSON.stringify(broken));
    expect(restored?.campaign.contract).toBeNull();
    expect(restored?.campaign.state.capital).toBe(87_500);
  });
});
