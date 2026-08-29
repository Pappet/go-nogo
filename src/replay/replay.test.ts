/**
 * The three determinism tests CLAUDE.md requires.
 *
 * They are the reason the whole engine is shaped the way it is: no clock in
 * the simulation, tick-stamped commands, canonical binary hashing. If any of
 * them fails, a replay no longer reproduces the session it recorded.
 *
 * The reference run is checked in at fixtures/seed42.json. Regenerate it
 * deliberately — `REGENERATE_FIXTURES=1 npm test` — and justify the change in
 * the commit, as CLAUDE.md requires: a moved hash means the simulation now
 * computes something different.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMissionConfig, dataVersion } from '../missionConfig.js';
import { createMissionState } from '../sim/countdown.js';
import { TICKS_PER_SECOND, type Command } from '../sim/engine.js';
import { buildMissionReport, verdictLine } from '../sim/diagnosis/postMortem.js';

import { HASH_INTERVAL_TICKS, play, playRun, verifyRun } from './playback.js';
import {
  GAME_VERSION,
  type Run,
  deserializeRun,
  serializeRun,
  sliceRun,
} from './run.js';

/**
 * The fixture flies a mission chosen for what it puts the engine through, not
 * for being the default: three root causes, both chain types and a lost
 * vehicle. A quiet flight would still verify the hashes and prove far less.
 */
const config = createMissionConfig({ missionKey: 'mission-6' });

/**
 * Seed 42 and a fixed command log, exactly as CLAUDE.md specifies.
 *
 * The log is a real launch: five checklist switches thrown one after another,
 * then arm. Everything after that — the terminal count, ignition, staging,
 * cutoff — falls out of the simulation without another input.
 */
const SEED = 42;
const ARM_TICK = 120;
/** Terminal count is 10 s = 200 ticks, so the engines light here. */
const IGNITION_TICK = ARM_TICK + 200;
const RUN_LENGTH_TICKS = 12000; // 10 minutes: ascent, cutoff and a long coast.
const COMMANDS: Command[] = [
  { tick: 20, type: 'toggleChecklist', payload: { index: 0 } },
  { tick: 40, type: 'toggleChecklist', payload: { index: 1 } },
  { tick: 60, type: 'toggleChecklist', payload: { index: 2 } },
  { tick: 80, type: 'toggleChecklist', payload: { index: 3 } },
  { tick: 100, type: 'toggleChecklist', payload: { index: 4 } },
  { tick: ARM_TICK, type: 'arm', payload: null },
];

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'seed42.json');

function recordRun(): Run {
  const result = play(config, COMMANDS, RUN_LENGTH_TICKS);
  return {
    gameVersion: GAME_VERSION,
    dataVersion: dataVersion(),
    seed: SEED,
    configuration: { rocketName: config.rocket.name, missionKey: config.missionKey },
    commands: COMMANDS,
    stateHashes: result.hashes,
  };
}

if (process.env.REGENERATE_FIXTURES === '1') {
  writeFileSync(FIXTURE_PATH, `${serializeRun(recordRun())}\n`);
}

describe('replay fixture (seed 42)', () => {
  it('has a checked-in reference to compare against', () => {
    expect(existsSync(FIXTURE_PATH)).toBe(true);
  });

  const fixture = deserializeRun(readFileSync(FIXTURE_PATH, 'utf-8'));

  it('was flown against the current data files', () => {
    // A change to any file the flight is decided by — the rocket, the parts
    // catalogue, the cause graph, the exposure table — invalidates the run
    // before a single tick is simulated (concept §8.2 rule 7).
    expect(fixture.dataVersion).toBe(dataVersion());
    expect(fixture.gameVersion).toBe(GAME_VERSION);
  });

  it('reproduces every recorded state hash', () => {
    const result = verifyRun(fixture, config, dataVersion());
    expect(result.firstMismatchTick).toBe(-1);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(RUN_LENGTH_TICKS / HASH_INTERVAL_TICKS + 1);
  });

  it('reproduces the final state hash', () => {
    const result = playRun(fixture, config, RUN_LENGTH_TICKS);
    const recorded = fixture.stateHashes[fixture.stateHashes.length - 1];
    expect(`${result.finalTick}:${result.finalHash}`).toBe(`${recorded.tick}:${recorded.sha256}`);
  });

  it('is a real flight that goes wrong — not an empty one', () => {
    // The command log launches and then never touches the anomalies, so they
    // run their windows out and cascade. That makes this a stronger
    // determinism fixture than a clean ascent: escalation, chain spawning and
    // the loss of the vehicle all have to reproduce bit for bit.
    const result = playRun(fixture, config, RUN_LENGTH_TICKS);
    expect(result.state.flight.ignited).toBe(true);
    expect(result.state.missionLost).toBe(true);

    // Three separate root causes, and both chain types among what they set
    // off. That is the point of choosing this mission: a fixture that only
    // exercised one escalation path would verify a third of the machinery.
    const roots = result.state.diagnosis.anomalies.anomalies.filter(
      (anomaly) => anomaly.spawnedBy === null,
    );
    expect(roots.length).toBeGreaterThanOrEqual(3);
    const chains = new Set(
      result.state.diagnosis.anomalies.anomalies
        .filter((anomaly) => anomaly.spawnedBy !== null)
        .map((anomaly) => anomaly.causeId),
    );
    expect(chains.size).toBeGreaterThanOrEqual(2);
    expect(
      result.state.events.filter((event) => event.type === 'ANOMALY_CHAIN').length,
    ).toBeGreaterThan(0);
  });

  it('reports on the flight the fixture actually flew', () => {
    // The post-mortem's claim is that it cannot drift from what happened,
    // because it derives everything from state the simulation already holds.
    // Building it from the fixture run is the test of that claim: the report
    // has to agree with a flight nobody wrote it against.
    const result = playRun(fixture, config, RUN_LENGTH_TICKS);
    const report = buildMissionReport(
      config.causeGraph,
      result.state.diagnosis.anomalies,
      result.state.diagnosis.results,
      result.state.missionLost,
      0.11,
      TICKS_PER_SECOND,
    );

    expect(report.lost).toBe(true);
    // Nobody diagnosed and nobody acted, so every anomaly is untouched.
    expect(report.diagnosesBought).toBe(0);
    expect(report.wrongMeasures).toBe(0);
    expect(report.untouched).toBe(report.anomalies.length);
    expect(report.anomalies.some((entry) => entry.verdict === 'escalated')).toBe(true);
    // A cascade means at least one anomaly names what it came out of.
    expect(report.anomalies.some((entry) => entry.chain.length > 1)).toBe(true);
    expect(verdictLine(report)).toContain('Risk accepted: 11 %');
    expect(verdictLine(report)).toContain('Vehicle lost');
  });

  it('detects a tampered hash and localises it to its 30-second window', () => {
    const tampered: Run = {
      ...fixture,
      stateHashes: fixture.stateHashes.map((entry, index) =>
        index === 4 ? { ...entry, sha256: 'deadbeef' } : entry,
      ),
    };
    const result = verifyRun(tampered, config, dataVersion());
    expect(result.ok).toBe(false);
    expect(result.firstMismatchTick).toBe(fixture.stateHashes[4].tick);
  });

  it('rejects a run flown against different data', () => {
    const otherData: Run = { ...fixture, dataVersion: 'f'.repeat(64) };
    expect(verifyRun(otherData, config, dataVersion()).ok).toBe(false);
  });
});

describe('save and resume', () => {
  // CLAUDE.md: save at T+90 s, resume, keep running — the final hash must match
  // the run that was never interrupted.
  const SAVE_TICK = IGNITION_TICK + 90 * 20; // T+90 s at 20 ticks per second.

  it('resumes to the same final state as an uninterrupted run', () => {
    const uninterrupted = play(config, COMMANDS, RUN_LENGTH_TICKS);

    const full = recordRun();
    const saved = sliceRun(full, SAVE_TICK);

    // Resuming is replaying the prefix (concept §8.2 rule 9): the save stores
    // inputs, not a snapshot of the world.
    const restored = play(config, saved.commands, SAVE_TICK);
    expect(restored.finalTick).toBe(SAVE_TICK);

    const continued = play(config, full.commands, RUN_LENGTH_TICKS, restored.state);

    expect(continued.finalTick).toBe(uninterrupted.finalTick);
    expect(continued.finalHash).toBe(uninterrupted.finalHash);
  });

  it('saves mid-ascent, while the vehicle is still under thrust', () => {
    // A save during coast would be the easy case; this one has to reproduce a
    // burning stage with a partially drained tank.
    const atSave = play(config, COMMANDS, SAVE_TICK);
    expect(atSave.state.flight.ignited).toBe(true);
    expect(atSave.state.flight.cutoff).toBe(false);
    expect(atSave.state.flight.propellantRemaining_kg).toBeGreaterThan(0);
    expect(atSave.state.flight.propellantRemaining_kg).toBeLessThan(
      config.rocket.stages[0].propellantMass_kg,
    );
  });

  it('keeps only the commands up to the save point', () => {
    const full = recordRun();
    const saved = sliceRun(full, 50);
    expect(saved.commands).toHaveLength(2);
    const late = sliceRun(full, RUN_LENGTH_TICKS);
    expect(late.commands).toHaveLength(COMMANDS.length);
  });
});

describe('double playback', () => {
  it('produces an identical hash series both times', () => {
    const first = play(config, COMMANDS, RUN_LENGTH_TICKS);
    const second = play(config, COMMANDS, RUN_LENGTH_TICKS);

    expect(second.hashes.map((entry) => `${entry.tick}:${entry.sha256}`)).toEqual(
      first.hashes.map((entry) => `${entry.tick}:${entry.sha256}`),
    );
    expect(second.finalHash).toBe(first.finalHash);
  });

  it('samples every 600 ticks, as the desync detector expects', () => {
    const result = play(config, COMMANDS, RUN_LENGTH_TICKS);
    const ticks = result.hashes.map((entry) => entry.tick);
    expect(ticks[0]).toBe(0);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i] - ticks[i - 1]).toBe(HASH_INTERVAL_TICKS);
    }
  });

  it('is unaffected by a fresh state object', () => {
    // Guards against state leaking through module scope between runs.
    const first = play(config, COMMANDS, 3000, createMissionState(config));
    const second = play(config, COMMANDS, 3000, createMissionState(config));
    expect(second.finalHash).toBe(first.finalHash);
  });
});
