/**
 * Behaviour of the tick engine.
 *
 * The tests that matter most are the ones proving the outcome does not depend
 * on how real time was chopped into frames: that property is what lets a
 * replay reproduce a live session exactly (concept §8.2 rules 1–3).
 */
import { describe, expect, it } from 'vitest';

import { type Command, DT_MS, Engine, MAX_FRAME_MS, MAX_NUMERIC_WARP, type Simulation } from './engine.js';

/** A world that just records what the engine did to it. */
interface TestState {
  steppedTicks: number[];
  applied: string[];
  /** Set by a command; flips the world between burning and coasting. */
  coasting: boolean;
  /** Analytical jumps land here, so a coast is distinguishable from stepping. */
  jumps: [number, number][];
  value: number;
}

function createState(coasting = false): TestState {
  return { steppedTicks: [], applied: [], coasting, jumps: [], value: 0 };
}

const testSimulation: Simulation<TestState> = {
  step(state, tick) {
    state.steppedTicks.push(tick);
    state.value += 1;
  },
  apply(state, command, tick) {
    state.applied.push(`${command.type}@${tick}`);
    if (command.type === 'ignite') state.coasting = false;
    if (command.type === 'shutdown') state.coasting = true;
  },
  canCoast(state) {
    return state.coasting;
  },
  coastTo(state, tick) {
    state.jumps.push([state.steppedTicks.length, tick]);
    state.value += 1;
  },
};

function createEngine(coasting = false): Engine<TestState> {
  return new Engine(testSimulation, createState(coasting));
}

describe('ticks', () => {
  it('starts at tick zero and counts integers', () => {
    const engine = createEngine();
    expect(engine.tick).toBe(0);
    engine.runTicks(3);
    expect(engine.tick).toBe(3);
    expect(engine.state.steppedTicks).toEqual([0, 1, 2]);
  });

  it('runs a tick per DT of elapsed time and carries the remainder', () => {
    const engine = createEngine();
    expect(engine.advance(DT_MS + 10)).toBe(1);
    // 10 ms carried over: 45 more crosses the next boundary.
    expect(engine.advance(45)).toBe(1);
    expect(engine.tick).toBe(2);
  });

  it('accumulates frames too short to produce a tick', () => {
    const engine = createEngine();
    expect(engine.advance(20)).toBe(0);
    expect(engine.advance(20)).toBe(0);
    expect(engine.advance(20)).toBe(1);
    expect(engine.tick).toBe(1);
  });
});

describe('frame independence', () => {
  // The core determinism property: the same elapsed time delivered in
  // different chunks must produce the same simulation.
  it('reaches the same state whether time arrives evenly or raggedly', () => {
    // Commands are injected at fixed ticks so both runs see the same history;
    // only the frame chopping differs. Comparing `steppedTicks` alone would
    // prove nothing — it is always 0..n-1 — so the applied commands and the
    // accumulated value carry the assertion.
    const inject = (engine: Engine<TestState>): void => {
      engine.inject({ tick: 5, type: 'shutdown', payload: null });
      engine.inject({ tick: 17, type: 'ignite', payload: null });
      engine.inject({ tick: 33, type: 'shutdown', payload: null });
    };

    const even = createEngine();
    inject(even);
    while (even.tick < 40) even.advance(DT_MS);

    const ragged = createEngine();
    inject(ragged);
    const frames = [10, 90, 5, 5, 5, 135, 33, 67, 7, 21, 200, 120];
    let frame = 0;
    while (ragged.tick < 40) {
      ragged.advance(frames[frame % frames.length]);
      frame += 1;
    }
    // Ragged frames can overshoot; compare at the first common tick.
    expect(ragged.tick).toBeGreaterThanOrEqual(40);

    const evenAt40 = createEngine();
    inject(evenAt40);
    evenAt40.runTo(40);

    expect(even.tick).toBe(40);
    expect(even.state.applied).toEqual(evenAt40.state.applied);
    expect(even.state.value).toBe(evenAt40.state.value);
    expect(even.state.coasting).toBe(evenAt40.state.coasting);
    expect(ragged.state.applied).toEqual(evenAt40.state.applied);
  });

  it('matches runTicks exactly when the same total time is delivered', () => {
    const framed = createEngine();
    for (let i = 0; i < 100; i++) framed.advance(DT_MS);

    const direct = createEngine();
    direct.runTicks(100);

    expect(framed.tick).toBe(direct.tick);
    expect(framed.state.steppedTicks).toEqual(direct.state.steppedTicks);
  });
});

describe('background tab protection', () => {
  it('clamps a huge elapsed time instead of catching up in one burst', () => {
    const engine = createEngine();
    const ticks = engine.advance(60000);
    expect(ticks).toBe(MAX_FRAME_MS / DT_MS);
  });

  it('lets sim time fall behind wall time rather than stalling', () => {
    const engine = createEngine();
    engine.advance(60000);
    // The next frame starts fresh; no debt was stored up.
    expect(engine.advance(DT_MS)).toBe(1);
  });
});

describe('pause', () => {
  it('runs no ticks while paused', () => {
    const engine = createEngine();
    engine.pause();
    expect(engine.advance(1000)).toBe(0);
    expect(engine.tick).toBe(0);
    expect(engine.isPaused).toBe(true);
  });

  it('does not bank the partial frame across a pause', () => {
    const engine = createEngine();
    engine.advance(40); // 40 ms in the accumulator
    engine.pause();
    engine.resume();
    // Without dropping the partial frame, 10 ms would be enough for a tick.
    expect(engine.advance(10)).toBe(0);
  });

  it('resumes exactly where it stopped', () => {
    const engine = createEngine();
    engine.runTicks(5);
    engine.pause();
    engine.advance(1000);
    engine.resume();
    engine.advance(DT_MS);
    expect(engine.tick).toBe(6);
  });
});

describe('warp', () => {
  it('adds ticks per frame without changing DT', () => {
    const engine = createEngine();
    engine.setWarp(4);
    expect(engine.advance(DT_MS)).toBe(4);
    // Every tick is still one DT: the world stepped four separate times.
    expect(engine.state.steppedTicks).toEqual([0, 1, 2, 3]);
  });

  it('clamps to the numerical ceiling while the world cannot coast', () => {
    const engine = createEngine(false);
    engine.setWarp(50);
    expect(engine.advance(DT_MS)).toBe(MAX_NUMERIC_WARP);
  });

  it('never drops below 1×', () => {
    const engine = createEngine();
    engine.setWarp(0);
    expect(engine.warpFactor).toBe(1);
    engine.setWarp(-5);
    expect(engine.warpFactor).toBe(1);
  });
});

describe('analytical coast', () => {
  it('evaluates in one jump instead of stepping', () => {
    const engine = createEngine(true);
    engine.setWarp(100);
    const ticks = engine.advance(DT_MS);
    expect(ticks).toBe(100);
    expect(engine.tick).toBe(100);
    // One analytical evaluation, no per-tick stepping.
    expect(engine.state.jumps).toEqual([[0, 100]]);
    expect(engine.state.steppedTicks).toEqual([]);
  });

  it('stops at the next queued command instead of jumping past it', () => {
    const engine = createEngine(true);
    engine.setWarp(100);
    engine.inject({ tick: 30, type: 'ignite', payload: null });
    engine.advance(DT_MS);
    // The jump stopped at 30, the command landed, and burning resumed
    // numerically from there.
    expect(engine.state.jumps).toEqual([[0, 30]]);
    expect(engine.state.applied).toEqual(['ignite@30']);
    expect(engine.state.coasting).toBe(false);
    expect(engine.tick).toBeGreaterThanOrEqual(30);
  });

  it('falls back to stepping when the world cannot coast', () => {
    const engine = createEngine(false);
    engine.coastTo(10);
    expect(engine.state.jumps).toEqual([]);
    expect(engine.tick).toBe(10);
  });
});

describe('commands', () => {
  it('applies a command at its tick, before the world steps', () => {
    const engine = createEngine();
    engine.inject({ tick: 3, type: 'ignite', payload: null });
    engine.runTicks(5);
    expect(engine.state.applied).toEqual(['ignite@3']);
  });

  it('stamps a submitted command onto the next tick to run', () => {
    const engine = createEngine();
    engine.runTicks(7);
    const command = engine.submit('armSwitch', { index: 2 });
    expect(command.tick).toBe(7);
    engine.runTicks(1);
    expect(engine.state.applied).toEqual(['armSwitch@7']);
  });

  it('keeps commands on the same tick in submission order', () => {
    const engine = createEngine();
    engine.inject({ tick: 2, type: 'first', payload: null });
    engine.inject({ tick: 2, type: 'second', payload: null });
    engine.inject({ tick: 2, type: 'third', payload: null });
    engine.runTicks(3);
    expect(engine.state.applied).toEqual(['first@2', 'second@2', 'third@2']);
  });

  it('holds a command submitted during a pause until the sim resumes', () => {
    const engine = createEngine();
    engine.runTicks(4);
    engine.pause();
    engine.submit('abort', null);
    engine.advance(1000);
    expect(engine.state.applied).toEqual([]);
    engine.resume();
    engine.advance(DT_MS);
    expect(engine.state.applied).toEqual(['abort@4']);
  });

  it('rejects a command stamped in the past', () => {
    const engine = createEngine();
    engine.runTicks(10);
    expect(() => engine.inject({ tick: 4, type: 'late', payload: null })).toThrow(/already past/);
  });

  it('reports what is still pending', () => {
    const engine = createEngine();
    engine.inject({ tick: 5, type: 'later', payload: null });
    expect(engine.pending).toHaveLength(1);
    engine.runTicks(6);
    expect(engine.pending).toHaveLength(0);
  });
});

describe('replayability', () => {
  it('reproduces a session exactly from its command log', () => {
    // Live session: ragged frames, commands submitted as they arrive.
    const live = createEngine(false);
    const log: Command[] = [];
    const frames = [37, 12, 96, 51, 8, 140, 22, 63, 71, 19];
    frames.forEach((ms, index) => {
      if (index === 3) log.push(live.submit('shutdown', null));
      if (index === 6) log.push(live.submit('ignite', null));
      live.advance(ms);
    });

    // Replay: no clock at all, just the log and the tick count.
    const replay = createEngine(false);
    for (const command of log) replay.inject(command);
    replay.runTo(live.tick);

    expect(replay.tick).toBe(live.tick);
    expect(replay.state.applied).toEqual(live.state.applied);
    expect(replay.state.steppedTicks).toEqual(live.state.steppedTicks);
    expect(replay.state.value).toBe(live.state.value);
  });
});
