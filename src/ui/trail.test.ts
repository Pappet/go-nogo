import { describe, expect, it } from 'vitest';

import { TrailSampler } from './trail.js';

/** Feeds ticks the way a frame loop does: in steps, not one at a time. */
function fly(sampler: TrailSampler, ticksPerFrame: number, frames: number): void {
  let tick = 0;
  for (let frame = 0; frame < frames; frame++) {
    tick += ticksPerFrame;
    sampler.offer(Math.floor(tick), Math.floor(tick), 0);
  }
}

describe('trail sampling', () => {
  it('samples at the interval when ticks arrive one at a time', () => {
    const sampler = new TrailSampler(10, 900);
    fly(sampler, 1, 100);
    expect(sampler.trail).toHaveLength(10);
  });

  it('keeps sampling when a frame covers several ticks', () => {
    // The regression: at 20× warp a frame advances about 6.7 ticks. The old
    // `tick % interval === 0` test stepped over most multiples of the interval,
    // so the trail came out full of holes. Sampling can only land on a frame
    // boundary, so the guarantee is one sample per `interval + step` ticks.
    const sampler = new TrailSampler(10, 900);
    const ticksPerFrame = 6.7;
    const frames = 150;
    fly(sampler, ticksPerFrame, frames);

    const flownTicks = ticksPerFrame * frames;
    const guaranteed = Math.floor(flownTicks / (10 + ticksPerFrame));
    expect(sampler.trail.length).toBeGreaterThanOrEqual(guaranteed);

    // For comparison, the modulo rule this replaced would have caught almost
    // nothing at this step size.
    let modulaHits = 0;
    for (let frame = 1; frame <= frames; frame++) {
      if (Math.floor(frame * ticksPerFrame) % 10 === 0) modulaHits += 1;
    }
    expect(sampler.trail.length).toBeGreaterThan(modulaHits * 2);
  });

  it('leaves no gap larger than the interval plus one frame, at any warp', () => {
    // A sample can only be taken on a frame boundary, so overshooting the
    // interval by up to one frame is the floor of what any sampler can do.
    // What must never happen again is a gap that grows without bound.
    for (const ticksPerFrame of [0.3, 1, 3, 6.7, 20, 60]) {
      const sampler = new TrailSampler(10, 100000);
      fly(sampler, ticksPerFrame, 400);

      const xs = sampler.trail.map((point) => point.x);
      let widest = 0;
      for (let i = 1; i < xs.length; i++) {
        widest = Math.max(widest, xs[i] - xs[i - 1]);
      }
      expect(widest).toBeLessThanOrEqual(10 + Math.ceil(ticksPerFrame));
    }
  });

  it('halves its resolution instead of dropping the start of the flight', () => {
    const sampler = new TrailSampler(10, 100);
    fly(sampler, 1, 5000);

    expect(sampler.trail.length).toBeLessThanOrEqual(100);
    // The ascent is still on the map: the first sample is still near tick 0.
    expect(sampler.trail[0].x).toBeLessThan(20);
    // And the last one is current.
    expect(sampler.trail[sampler.trail.length - 1].x).toBeGreaterThan(4000);
    expect(sampler.sampleInterval).toBeGreaterThan(10);
  });

  it('spans the whole flight however long it runs', () => {
    const sampler = new TrailSampler(10, 200);
    fly(sampler, 6.7, 20000); // over an hour of simulated flight
    expect(sampler.trail[0].x).toBeLessThan(20);
    expect(sampler.trail.length).toBeGreaterThan(100);
  });

  it('starts clean after a reset', () => {
    const sampler = new TrailSampler(10, 100);
    fly(sampler, 1, 5000);
    sampler.reset();
    expect(sampler.trail).toHaveLength(0);
    expect(sampler.sampleInterval).toBe(10);
  });
});
