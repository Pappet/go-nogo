/**
 * The component system (§4, §4.1).
 *
 * The property everything else rests on: a serial number names one specific
 * unit, forever. If that ever stops holding, the post-mortem's what-if becomes
 * a guess and §5.4's surgical re-roll becomes a lie — so it is asserted from
 * several directions rather than once.
 */
import { describe, expect, it } from 'vitest';

import { partCatalogue, partDef, qaLevels } from '../../missionConfig.js';

import {
  QA_LEVELS,
  buildPart,
  drawReliability,
  serialFor,
  tightenedBand,
  wouldHaveBeenScreenedOut,
} from './partInstance.js';

const qaTable = qaLevels;
const parts = partCatalogue;
const valve = partDef('part_main_valve');

describe('a serial number names one unit', () => {
  it('draws the same reliability for the same serial, every time', () => {
    const first = drawReliability(42, 'part_main_valve#0', valve.reliabilityBand);
    expect(drawReliability(42, 'part_main_valve#0', valve.reliabilityBand)).toBe(first);
  });

  it('does not depend on the QA level the part was bought at', () => {
    // The test reveals the part; it does not create it. Everything §7 ⑥
    // promises about what-ifs depends on this being true.
    const series = buildPart(valve, 'slot_valve', 'series', qaTable, 42);
    const qualified = buildPart(valve, 'slot_valve', 'qualification', qaTable, 42);
    const bare = drawReliability(42, series.serialNo, valve.reliabilityBand);

    expect(series.effectiveReliability).toBe(bare);
    // Qualification adds its hot-fire bonus on top of the same underlying unit.
    if (qualified.serialNo === series.serialNo) {
      expect(qualified.effectiveReliability).toBeCloseTo(
        bare + qaTable.qualification.reliabilityBonus,
        12,
      );
    }
  });

  it('gives different serials different units, and different campaigns different fleets', () => {
    const a = drawReliability(42, serialFor('slot_valve', 0), valve.reliabilityBand);
    const b = drawReliability(42, serialFor('slot_valve', 1), valve.reliabilityBand);
    const otherSeed = drawReliability(43, serialFor('slot_valve', 0), valve.reliabilityBand);
    expect(a).not.toBe(b);
    expect(a).not.toBe(otherSeed);
  });

  it('stays inside what the manufacturer committed to', () => {
    for (const part of parts) {
      for (let index = 0; index < 300; index += 1) {
        const drawn = drawReliability(42, serialFor(part.id, index), part.reliabilityBand);
        expect(drawn).toBeGreaterThanOrEqual(part.reliabilityBand[0]);
        expect(drawn).toBeLessThanOrEqual(part.reliabilityBand[1]);
      }
    }
  });
});

describe('QA changes what you know, and what flies', () => {
  it('shows the manufacturer band on a series part and hides the value', () => {
    const instance = buildPart(valve, 'slot_valve', 'series', qaTable, 42);
    expect(instance.visibleBand).toEqual(valve.reliabilityBand);
    expect(instance.screenedOut).toEqual([]);
  });

  it('screens out a unit below the tightened band and flies the next one', () => {
    // Find a slot whose first unit the acceptance test would reject, then
    // assert that it is not the unit that flies.
    const target = tightenedBand(valve.reliabilityBand, qaTable.acceptance.bandFactor);
    let slot = '';
    for (let index = 0; index < 200 && slot === ''; index += 1) {
      const candidate = `slot_${index}`;
      if (drawReliability(42, serialFor(candidate, 0), valve.reliabilityBand) < target[0]) {
        slot = candidate;
      }
    }
    expect(slot).not.toBe('');

    const accepted = buildPart(valve, slot, 'acceptance', qaTable, 42);
    expect(accepted.screenedOut.length).toBeGreaterThan(0);
    expect(accepted.serialNo).not.toBe(serialFor(slot, 0));
    expect(accepted.effectiveReliability).toBeGreaterThanOrEqual(target[0]);

    // And the rejected unit is still exactly the unit it always was.
    const asSeries = buildPart(valve, slot, 'series', qaTable, 42);
    expect(asSeries.serialNo).toBe(accepted.screenedOut[0]);
    expect(wouldHaveBeenScreenedOut(asSeries, valve, qaTable)).toBe(true);
  });

  it('collapses the visible band onto the value once it is certificated', () => {
    for (const level of ['qualification', 'flightProven'] as const) {
      const instance = buildPart(valve, 'slot_valve', level, qaTable, 42);
      expect(instance.visibleBand[0]).toBe(instance.effectiveReliability);
      expect(instance.visibleBand[1]).toBe(instance.effectiveReliability);
    }
  });

  it('narrows the visible band without ever widening past the manufacturer', () => {
    for (const level of QA_LEVELS) {
      for (const part of parts) {
        const instance = buildPart(part, `slot_${part.id}`, level, qaTable, 42);
        const width = instance.visibleBand[1] - instance.visibleBand[0];
        const manufacturer = part.reliabilityBand[1] - part.reliabilityBand[0];
        expect(width).toBeLessThanOrEqual(manufacturer + 1e-12);
        expect(instance.effectiveReliability).toBeLessThanOrEqual(1);
      }
    }
  });

  it('charges flight-proven parts a flight of wear', () => {
    expect(buildPart(valve, 'slot_valve', 'flightProven', qaTable, 42).wear).toBe(1);
    expect(buildPart(valve, 'slot_valve', 'series', qaTable, 42).wear).toBe(0);
    expect(buildPart(valve, 'slot_valve', 'series', qaTable, 42, 2).wear).toBe(2);
  });

  it('answers the what-if only where the question makes sense', () => {
    // Asking whether the acceptance test would have caught it is meaningless
    // for a part that was acceptance-tested.
    const accepted = buildPart(valve, 'slot_valve', 'acceptance', qaTable, 42);
    expect(wouldHaveBeenScreenedOut(accepted, valve, qaTable)).toBe(false);
  });
});

describe('the shipped catalogue', () => {
  it('gives every part a band the manufacturer could mean', () => {
    for (const part of parts) {
      expect(part.reliabilityBand[0]).toBeLessThan(part.reliabilityBand[1]);
      expect(part.reliabilityBand[0]).toBeGreaterThan(0);
      expect(part.reliabilityBand[1]).toBeLessThanOrEqual(1);
      expect(part.failureCauses.length).toBeGreaterThan(0);
    }
  });

  it('prices certainty above the series part, and a used one below it', () => {
    // §4.1 is a table of trade-offs; if any level were both cheaper and better
    // than another, the configurator would have nothing to decide.
    expect(qaTable.acceptance.costMultiplier).toBeGreaterThan(qaTable.series.costMultiplier);
    expect(qaTable.qualification.costMultiplier).toBeGreaterThan(qaTable.acceptance.costMultiplier);
    expect(qaTable.qualification.buildDays).toBeGreaterThan(qaTable.acceptance.buildDays);
    // Flight-proven is the cheap certainty — paid for in wear, not money.
    expect(qaTable.flightProven.costMultiplier).toBeLessThan(qaTable.series.costMultiplier);
    expect(qaTable.flightProven.wearAdded).toBeGreaterThan(0);
  });

  it('names a cause the graph actually has for every part', async () => {
    const { causeGraphData } = await import('../../missionConfig.js');
    const known = new Set(Object.keys(causeGraphData.causes));
    for (const part of parts) {
      for (const causeId of part.failureCauses) expect(known).toContain(causeId);
    }
  });
});
