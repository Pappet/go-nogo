/**
 * Context priors.
 *
 * The test that matters most is the last one: across contexts, the leading
 * candidate for a symptom has to change. If it never does, the bars have
 * become a lookup table with decimals and §5.8's defence against the graph
 * flattening out is gone.
 */
import { describe, expect, it } from 'vitest';

import causesData from '../../data/causes.json' with { type: 'json' };
import priorSettings from '../../data/priors.json' with { type: 'json' };
import { hashUnit } from '../rng.js';

import { type CauseGraphData, loadCauseGraph } from './causeGraph.js';
import {
  type PriorSettings,
  activeContextTags,
  computePriors,
  frozenOrder,
  rollMissionContext,
} from './priors.js';

const graph = loadCauseGraph(causesData as unknown as CauseGraphData);
const settings = priorSettings as PriorSettings;

const pressureCandidates = graph.causesOf('sym_pressure_drop');

describe('mission context', () => {
  it('is the same for the same mission, whatever else was drawn', () => {
    const first = rollMissionContext(settings, 42, 'mission-1');
    for (let i = 0; i < 50; i++) hashUnit(42, `noise-${i}`, 'unrelated');
    expect(rollMissionContext(settings, 42, 'mission-1')).toEqual(first);
  });

  it('differs between missions', () => {
    const profiles = new Set<string>();
    for (let mission = 0; mission < 60; mission++) {
      profiles.add(rollMissionContext(settings, 42, `m${mission}`).join(','));
    }
    expect(profiles.size).toBeGreaterThan(6);
  });

  it('only ever draws declared tags', () => {
    const declared = new Set(settings.missionTags.map((tag) => tag.id));
    for (let mission = 0; mission < 100; mission++) {
      for (const tag of rollMissionContext(settings, 42, `m${mission}`)) {
        expect(declared.has(tag)).toBe(true);
      }
    }
  });

  it('adds what the flight phase implies, without duplicates', () => {
    const active = activeContextTags(settings, ['high_radiation'], 'MAX_Q');
    expect(active).toContain('high_radiation');
    expect(active).toContain('max_q');
    expect(new Set(active).size).toBe(active.length);
  });

  it('returns a stable value, not an insertion-order artefact', () => {
    expect(activeContextTags(settings, ['cheap_qa', 'cold_profile'], 'MAX_Q')).toEqual(
      activeContextTags(settings, ['cold_profile', 'cheap_qa'], 'MAX_Q'),
    );
  });

  it('handles a phase with nothing to say', () => {
    expect(activeContextTags(settings, ['cold_profile'], 'HOLD')).toEqual(['cold_profile']);
  });
});

describe('the candidate bars', () => {
  it('sum to one', () => {
    for (const phase of ['HOLD', 'MAX_Q', 'ORBIT_CHECK']) {
      const tags = activeContextTags(settings, ['cheap_qa'], phase);
      const priors = computePriors(graph, pressureCandidates, tags, settings);
      const total = priors.reduce((sum, prior) => sum + prior.probability, 0);
      expect(total).toBeCloseTo(1, 12);
    }
  });

  it('never hands out a certainty', () => {
    // Every candidate keeps a share: a bar at 100 % would be an answer the
    // player did not pay for.
    const tags = activeContextTags(settings, ['max_q', 'high_vibration'], 'MAX_Q');
    for (const prior of computePriors(graph, pressureCandidates, tags, settings)) {
      expect(prior.probability).toBeGreaterThan(0);
      expect(prior.probability).toBeLessThan(1);
    }
  });

  it('is uniform when no context matches', () => {
    const priors = computePriors(graph, pressureCandidates, [], settings);
    const first = priors[0].probability;
    for (const prior of priors) expect(prior.probability).toBeCloseTo(first, 12);
  });

  it('raises a cause whose context is in force', () => {
    const neutral = computePriors(graph, pressureCandidates, [], settings);
    const atMaxQ = computePriors(graph, pressureCandidates, ['max_q'], settings);

    const leakNeutral = neutral.find((p) => p.causeId === 'cause_prop_leak')!.probability;
    const leakAtMaxQ = atMaxQ.find((p) => p.causeId === 'cause_prop_leak')!.probability;
    // A leak is the max-Q candidate; the others must give way for it.
    expect(leakAtMaxQ).toBeGreaterThan(leakNeutral);
  });

  it('compounds when several tags point the same way', () => {
    const one = computePriors(graph, pressureCandidates, ['max_q'], settings);
    const both = computePriors(graph, pressureCandidates, ['max_q', 'high_vibration'], settings);
    const leakOne = one.find((p) => p.causeId === 'cause_prop_leak')!.probability;
    const leakBoth = both.find((p) => p.causeId === 'cause_prop_leak')!.probability;
    expect(leakBoth).toBeGreaterThan(leakOne);
  });

  it('reports which tags argued for a cause', () => {
    const priors = computePriors(graph, pressureCandidates, ['max_q', 'cheap_qa'], settings);
    expect(priors.find((p) => p.causeId === 'cause_prop_leak')?.matchedTags).toEqual(['max_q']);
    expect(priors.find((p) => p.causeId === 'cause_sensor_defective')?.matchedTags).toEqual([
      'cheap_qa',
    ]);
    expect(priors.find((p) => p.causeId === 'cause_valve_sluggish')?.matchedTags).toEqual([]);
  });

  it('returns nothing for an empty candidate set', () => {
    expect(computePriors(graph, [], ['max_q'], settings)).toEqual([]);
  });
});

describe('ordering', () => {
  it('puts the strongest candidate first', () => {
    const priors = computePriors(graph, pressureCandidates, ['max_q'], settings);
    expect(priors[0].causeId).toBe('cause_prop_leak');
    for (let i = 1; i < priors.length; i++) {
      expect(priors[i - 1].probability).toBeGreaterThanOrEqual(priors[i].probability);
    }
  });

  it('breaks ties the same way every time', () => {
    // Equal weights must not leave the button order up to iteration order —
    // §7.7 needs a panel that cannot reshuffle under the player's hand.
    const render = (): string => frozenOrder(computePriors(graph, pressureCandidates, [], settings)).join(',');
    expect(render()).toBe(render());
    expect(frozenOrder(computePriors(graph, pressureCandidates, [], settings))).toEqual(
      [...pressureCandidates].sort(),
    );
  });
});

describe('the defence against a flattening graph', () => {
  it('does not let one cause own the top slot for a symptom', () => {
    // §5.8: after fifty hours, "55 %" must not have come to mean one cause.
    const leaders = new Set<string>();
    for (const phase of ['HOLD', 'LIFTOFF', 'MAX_Q', 'ORBIT_CHECK']) {
      for (let mission = 0; mission < 40; mission++) {
        const missionTags = rollMissionContext(settings, 42, `m${mission}`);
        const tags = activeContextTags(settings, missionTags, phase);
        const priors = computePriors(graph, pressureCandidates, tags, settings);
        leaders.add(priors[0].causeId);
      }
    }
    // Every candidate for this symptom must lead in some context.
    expect(leaders.size).toBe(pressureCandidates.length);
  });

  it('moves the numbers, not just the order', () => {
    const seen = new Set<string>();
    for (const phase of ['HOLD', 'MAX_Q', 'ORBIT_CHECK']) {
      for (let mission = 0; mission < 30; mission++) {
        const tags = activeContextTags(settings, rollMissionContext(settings, 42, `m${mission}`), phase);
        const top = computePriors(graph, pressureCandidates, tags, settings)[0];
        seen.add(top.probability.toFixed(3));
      }
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});
