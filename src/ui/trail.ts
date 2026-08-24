/**
 * Sampling of the flown path for the orbit map.
 *
 * Kept apart from the mission runner because the rule is easy to get subtly
 * wrong and worth testing on its own: the first version tested
 * `tick % interval === 0`, which works only while the tick advances one at a
 * time. Under time warp a frame covers several ticks at once, so that test
 * steps over most of its own sample points and the trail comes out with holes.
 */

export interface TrailPoint {
  readonly x: number;
  readonly y: number;
}

export class TrailSampler {
  private points: TrailPoint[] = [];
  private interval: number;
  private lastTick = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly baseInterval: number,
    private readonly limit: number,
  ) {
    this.interval = baseInterval;
  }

  /**
   * Offers the position at `tick`. Takes it when enough ticks have passed
   * since the last sample, whatever step size the caller arrives in.
   */
  offer(tick: number, x: number, y: number): void {
    if (tick - this.lastTick < this.interval) return;

    this.lastTick = tick;
    this.points.push({ x, y });

    if (this.points.length > this.limit) {
      // Halve the resolution rather than forgetting the ascent to make room
      // for the orbit: the whole flight stays on the map either way.
      this.points = this.points.filter((_, index) => index % 2 === 0);
      this.interval *= 2;
    }
  }

  get trail(): readonly TrailPoint[] {
    return this.points;
  }

  /** Current gap between samples, in ticks. Grows as the flight gets long. */
  get sampleInterval(): number {
    return this.interval;
  }

  reset(): void {
    this.points = [];
    this.interval = this.baseInterval;
    this.lastTick = Number.NEGATIVE_INFINITY;
  }
}
