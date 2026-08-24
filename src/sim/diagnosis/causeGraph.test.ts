/**
 * The cause graph at runtime.
 *
 * Two properties carry the design. First, a symptom must never identify a
 * cause on its own — otherwise the graph is a lookup table and diagnosis is
 * theatre. Second, symptom instances must be addressable: the same mission
 * always produces the same numbers, no matter what else was drawn.
 */
import { describe, expect, it } from 'vitest';

import anomalySettings from '../../data/anomalies.json' with { type: 'json' };
import causesData from '../../data/causes.json' with { type: 'json' };
import { hashUnit } from '../rng.js';

import {
  type CauseGraphData,
  type SymptomBands,
  buildSymptomInstances,
  loadCauseGraph,
  validateCauseGraph,
} from './causeGraph.js';

const data = causesData as unknown as CauseGraphData;
const graph = loadCauseGraph(data);
const bands = anomalySettings as SymptomBands;

describe('the shipped graph', () => {
  it('loads and validates', () => {
    expect(() => loadCauseGraph(data)).not.toThrow();
  });

  it('has the shape the concept specifies for v1', () => {
    // §9: 4 causes, 6 symptoms, 8 measures, 2 side-effect chains.
    const chains = graph.causeIds.filter((id) => graph.cause(id).is_chain);
    expect(graph.causeIds.length - chains.length).toBe(4);
    expect(chains).toHaveLength(2);
    expect(Object.keys(data.symptoms)).toHaveLength(6);
    expect(graph.measureIds).toHaveLength(8);
  });

  it('never lets one symptom name one cause', () => {
    // The whole premise of §5.1: the player sees the symptom, never the cause.
    for (const symptomId of Object.keys(data.symptoms)) {
      const nonChain = graph
        .causesOf(symptomId)
        .filter((causeId) => !graph.cause(causeId).is_chain);
      if (nonChain.length === 0) continue; // chain announcements are exempt
      expect(nonChain.length).toBeGreaterThan(1);
    }
  });

  it('gives every cause a correct measure and a plausible wrong one', () => {
    for (const causeId of graph.causeIds) {
      const cause = graph.cause(causeId);
      expect(cause.correct_measures.length).toBeGreaterThan(0);
      if (!cause.is_chain) expect(cause.incorrect_measures.length).toBeGreaterThan(0);
    }
  });
});

describe('candidates', () => {
  it('lists every cause that could explain a symptom', () => {
    const candidates = graph.causesOf('sym_pressure_drop');
    expect(candidates).toContain('cause_valve_sluggish');
    expect(candidates).toContain('cause_prop_leak');
    expect(candidates).toContain('cause_sensor_defective');
  });

  it('narrows as a second symptom appears', () => {
    const one = graph.candidatesFor(['sym_pressure_drop']);
    const two = graph.candidatesFor(['sym_pressure_drop', 'sym_voltage_drop']);
    expect(two.length).toBeLessThan(one.length);
    // Only the defective sensor produces both.
    expect(two).toEqual(['cause_sensor_defective']);
  });

  it('requires a candidate to explain every symptom, not just one', () => {
    const candidates = graph.candidatesFor(['sym_pressure_drop', 'sym_telemetry_gaps']);
    for (const causeId of candidates) {
      const symptoms = graph.cause(causeId).symptoms;
      expect(symptoms).toContain('sym_pressure_drop');
      expect(symptoms).toContain('sym_telemetry_gaps');
    }
  });

  it('returns nothing when nothing has been observed', () => {
    expect(graph.candidatesFor([])).toEqual([]);
  });
});

describe('discrimination', () => {
  it('separates two causes when exactly one is in the discriminates set', () => {
    expect(graph.separates('measure_diag_crosscheck', 'cause_sensor_defective', 'cause_prop_leak')).toBe(
      true,
    );
  });

  it('does not separate two causes it says nothing about', () => {
    expect(graph.separates('measure_diag_crosscheck', 'cause_prop_leak', 'cause_bus_short')).toBe(
      false,
    );
  });

  it('offers a useful diagnosis for an ambiguous reading', () => {
    const candidates = graph.candidatesFor(['sym_pressure_drop']);
    const useful = graph.usefulDiagnoses(candidates);
    expect(useful.length).toBeGreaterThan(0);
    for (const measureId of useful) {
      expect(graph.measure(measureId).type).toBe('diagnosis');
    }
  });

  it('offers nothing once a single candidate remains', () => {
    expect(graph.usefulDiagnoses(['cause_prop_leak'])).toEqual([]);
  });
});

describe('measures and consequences', () => {
  it('knows the correct measure for a cause', () => {
    expect(graph.isCorrectFor('cause_prop_leak', 'measure_iso_valve')).toBe(true);
    expect(graph.isCorrectFor('cause_prop_leak', 'measure_increase_pressure')).toBe(false);
  });

  it('reports the chain a wrong measure sets off', () => {
    // Raising pressure on a leak makes it worse (§5.3).
    expect(graph.sideEffectOf('cause_prop_leak', 'measure_increase_pressure')).toBe(
      'chain_flameout',
    );
  });

  it('reports no chain for a measure that simply does not help', () => {
    expect(graph.sideEffectOf('cause_prop_leak', 'measure_loads_off')).toBeNull();
  });

  it('exposes the escalation window, falling back to the linter default', () => {
    expect(graph.escalationWindow_s('cause_prop_leak')).toBe(55);
    expect(graph.escalationWindow_s('chain_flameout')).toBe(20);
  });

  it('hands the scheduler a spec for every measure', () => {
    for (const measureId of graph.measureIds) {
      const spec = graph.specs.get(measureId);
      expect(spec?.duration_s).toBe(graph.measure(measureId).duration_s);
      expect(spec?.occupies).toEqual(graph.measure(measureId).occupies);
    }
  });
});

describe('symptom instances', () => {
  it('are addressable — same mission, same numbers', () => {
    // The property the surgical retry rests on (§8.2 rule 4).
    const first = buildSymptomInstances(graph, bands, 42, 'mission-1', 'cause_prop_leak');
    for (let i = 0; i < 50; i++) hashUnit(42, `noise-${i}`, 'unrelated');
    const again = buildSymptomInstances(graph, bands, 42, 'mission-1', 'cause_prop_leak');
    expect(again).toEqual(first);
  });

  it('differ between missions, causes and seeds', () => {
    const base = buildSymptomInstances(graph, bands, 42, 'mission-1', 'cause_prop_leak');
    const otherMission = buildSymptomInstances(graph, bands, 42, 'mission-2', 'cause_prop_leak');
    const otherSeed = buildSymptomInstances(graph, bands, 43, 'mission-1', 'cause_prop_leak');
    expect(otherMission).not.toEqual(base);
    expect(otherSeed).not.toEqual(base);
  });

  it('covers every symptom the cause produces', () => {
    const instances = buildSymptomInstances(graph, bands, 7, 'mission-1', 'cause_prop_leak');
    expect(instances.map((instance) => instance.symptomId)).toEqual(
      graph.cause('cause_prop_leak').symptoms,
    );
  });

  it('stays inside the visible band, so a symptom is never invisible', () => {
    for (let mission = 0; mission < 200; mission++) {
      for (const causeId of graph.causeIds) {
        for (const instance of buildSymptomInstances(graph, bands, 42, `m${mission}`, causeId)) {
          expect(instance.strength).toBeGreaterThanOrEqual(bands.symptomStrength.min);
          expect(instance.strength).toBeLessThanOrEqual(bands.symptomStrength.max);
          expect(instance.delay_s).toBeGreaterThanOrEqual(bands.symptomDelay_s.min);
          expect(instance.delay_s).toBeLessThanOrEqual(bands.symptomDelay_s.max);
        }
      }
    }
  });

  it('actually varies — the same cause does not look the same twice', () => {
    // §5.2: "the same cause never looks exactly the same". A generator that
    // technically randomises but lands in a narrow band would defeat that.
    const strengths = new Set<number>();
    const delays = new Set<number>();
    for (let mission = 0; mission < 100; mission++) {
      for (const instance of buildSymptomInstances(graph, bands, 42, `m${mission}`, 'cause_prop_leak')) {
        strengths.add(Math.round(instance.strength * 20));
        delays.add(Math.round(instance.delay_s));
      }
    }
    expect(strengths.size).toBeGreaterThan(8);
    expect(delays.size).toBeGreaterThan(8);
  });
});

describe('validation', () => {
  it('rejects a dangling symptom reference', () => {
    const broken = {
      ...data,
      causes: {
        ...data.causes,
        cause_prop_leak: { ...data.causes.cause_prop_leak, symptoms: ['sym_nope'] },
      },
    } as CauseGraphData;
    expect(() => validateCauseGraph(broken)).toThrow(/unknown symptom 'sym_nope'/);
  });

  it('rejects a side effect pointing at a cause that does not exist', () => {
    const broken = {
      ...data,
      causes: {
        ...data.causes,
        cause_prop_leak: {
          ...data.causes.cause_prop_leak,
          incorrect_measures: [{ measure: 'measure_abort', side_effect: 'chain_nope' }],
        },
      },
    } as CauseGraphData;
    expect(() => validateCauseGraph(broken)).toThrow(/unknown cause 'chain_nope'/);
  });

  it('names every problem it found, not just the first', () => {
    const broken = {
      ...data,
      causes: {
        ...data.causes,
        cause_prop_leak: {
          ...data.causes.cause_prop_leak,
          symptoms: ['sym_nope'],
          correct_measures: ['measure_nope'],
        },
      },
    } as CauseGraphData;
    expect(() => validateCauseGraph(broken)).toThrow(/sym_nope[\s\S]*measure_nope/);
  });

  it('throws a helpful error for an unknown lookup', () => {
    expect(() => graph.cause('nope')).toThrow(/Unknown cause 'nope'/);
    expect(() => graph.measure('nope')).toThrow(/Unknown measure 'nope'/);
    expect(() => graph.symptom('nope')).toThrow(/Unknown symptom 'nope'/);
  });
});
