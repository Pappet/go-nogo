/**
 * The resource scheduler: when a queued measure actually runs (concept §5.2).
 *
 * This is the mechanism that turns diagnosis into a sequencing puzzle rather
 * than a menu. A measure occupies its resources for its whole duration;
 * anything without a conflict runs in parallel. Cross-check (10 s, a channel)
 * and asking the team (45 s, an engineer) started together finish in 45 s, not
 * 55 — with a 52-second escalation window that is the difference between
 * solvable and lost.
 *
 * Scheduling policy: **a queued measure starts as soon as its own resources
 * are free.** A measure blocked on a busy engineer does not hold up a later
 * one that only needs a channel — the concept's timeline shows exactly that
 * ("test pulse (waits for a free channel)" while the team answer runs on).
 * When several measures want the same resource, the earlier-queued one wins,
 * which keeps the outcome a function of the player's order and nothing else.
 *
 * Everything here is integer ticks. `tools/graphLint.ts` answers a different
 * question — "does a feasible plan exist at all" — and may schedule a set more
 * cleverly; this module executes what the player actually asked for.
 */
import { TICKS_PER_SECOND } from '../engine.js';

/**
 * What the scheduler needs to know about a measure. The graph supplies it.
 *
 * A token may appear more than once in `occupies`: that is how a measure asks
 * for more than one slot of a pooled resource. A raw-telemetry cross-check
 * eating two of the four channels is the difference between a channel matrix
 * that means something and one that is decoration.
 */
export interface MeasureSpec {
  readonly id: string;
  readonly duration_s: number;
  /** Resource tokens held exclusively for the duration, e.g. 'engineer:prop'. */
  readonly occupies: readonly string[];
}

/** Capacities per resource token. Anything unlisted has capacity 1. */
export type ResourceCapacities = Readonly<Record<string, number>>;

/**
 * Measures are queued against a target — the anomaly they address. The
 * scheduler never interprets it; it carries it so that a completed measure
 * knows what it was for, and so the same measure can be queued twice for two
 * different anomalies without the two becoming one.
 */
export interface RunningMeasure {
  readonly measureId: string;
  readonly targetId: string;
  readonly startTick: number;
  readonly endTick: number;
}

export interface PendingMeasure {
  readonly measureId: string;
  readonly targetId: string;
  readonly queuedTick: number;
}

export interface ScheduleState {
  running: RunningMeasure[];
  pending: PendingMeasure[];
  /** Measures that ran to completion, oldest first. */
  completed: RunningMeasure[];
}

export function createScheduleState(): ScheduleState {
  return { running: [], pending: [], completed: [] };
}

export function durationTicks(measure: MeasureSpec): number {
  return Math.round(measure.duration_s * TICKS_PER_SECOND);
}

function capacityOf(capacities: ResourceCapacities, resource: string): number {
  const declared = capacities[resource];
  return declared === undefined ? 1 : declared;
}

/**
 * How many slots of `resource` are taken by the given running measures.
 */
function usedSlots(
  resource: string,
  running: readonly RunningMeasure[],
  specs: ReadonlyMap<string, MeasureSpec>,
): number {
  let used = 0;
  for (const active of running) {
    const spec = specs.get(active.measureId);
    if (spec === undefined) continue;
    for (const held of spec.occupies) {
      if (held === resource) used += 1;
    }
  }
  return used;
}

/** How many slots of `resource` this measure asks for. */
function slotsNeeded(spec: MeasureSpec, resource: string): number {
  let needed = 0;
  for (const held of spec.occupies) {
    if (held === resource) needed += 1;
  }
  return needed;
}

function canStart(
  spec: MeasureSpec,
  running: readonly RunningMeasure[],
  specs: ReadonlyMap<string, MeasureSpec>,
  capacities: ResourceCapacities,
): boolean {
  for (const resource of spec.occupies) {
    const needed = slotsNeeded(spec, resource);
    // A measure asking for more slots than exist would wait forever; that is a
    // data error, and the graph linter is where it belongs.
    if (usedSlots(resource, running, specs) + needed > capacityOf(capacities, resource)) {
      return false;
    }
  }
  return true;
}

/** Queues a measure against a target. It starts as soon as its resources allow. */
export function enqueueMeasure(
  state: ScheduleState,
  measureId: string,
  tick: number,
  targetId = '',
): void {
  state.pending.push({ measureId, targetId, queuedTick: tick });
}

/**
 * Advances the schedule to `tick`: retires whatever finished, then starts
 * whatever it can, in queue order.
 *
 * Returns the measures that completed on this tick — the caller turns those
 * into diagnosis results and RESULT READY offers.
 */
export function advanceSchedule(
  state: ScheduleState,
  tick: number,
  specs: ReadonlyMap<string, MeasureSpec>,
  capacities: ResourceCapacities,
): RunningMeasure[] {
  const finished: RunningMeasure[] = [];
  const stillRunning: RunningMeasure[] = [];
  for (const active of state.running) {
    if (active.endTick <= tick) {
      finished.push(active);
      state.completed.push(active);
    } else {
      stillRunning.push(active);
    }
  }
  state.running = stillRunning;

  // Queue order decides who gets a contested resource; a blocked measure does
  // not hold up a later one with no conflict.
  const stillPending: PendingMeasure[] = [];
  for (const waiting of state.pending) {
    const spec = specs.get(waiting.measureId);
    if (spec === undefined) continue; // unknown measure: drop rather than stall
    if (waiting.queuedTick > tick) {
      stillPending.push(waiting);
      continue;
    }
    if (canStart(spec, state.running, specs, capacities)) {
      state.running.push({
        measureId: waiting.measureId,
        targetId: waiting.targetId,
        startTick: tick,
        endTick: tick + durationTicks(spec),
      });
    } else {
      stillPending.push(waiting);
    }
  }
  state.pending = stillPending;

  return finished;
}

export interface ProjectedMeasure {
  readonly measureId: string;
  readonly targetId: string;
  readonly startTick: number;
  readonly endTick: number;
  /** True while the measure is still waiting for a resource to free up. */
  readonly waiting: boolean;
}

/**
 * Projects when every queued and running measure will land, without touching
 * the live state. This is what the command timeline preview draws (§5.7): the
 * player sees "acting costs time" as a plan against the escalation marker
 * rather than as a sentence in a tooltip.
 */
export function projectSchedule(
  state: ScheduleState,
  tick: number,
  specs: ReadonlyMap<string, MeasureSpec>,
  capacities: ResourceCapacities,
): ProjectedMeasure[] {
  const projection: ProjectedMeasure[] = state.running.map((active) => ({
    measureId: active.measureId,
    targetId: active.targetId,
    startTick: active.startTick,
    endTick: active.endTick,
    waiting: false,
  }));

  // Replay the same rules forward on a copy until every pending measure lands.
  let running: RunningMeasure[] = [...state.running];
  const pending = [...state.pending];
  let now = tick;

  // Each iteration either places at least one measure or jumps to the next
  // moment something changes, and there are at most as many such moments as
  // measures — so twice the count, plus slack, cannot be reached.
  const limit = (pending.length + running.length) * 2 + 4;
  for (let step = 0; step < limit && pending.length > 0; step++) {
    running = running.filter((active) => active.endTick > now);

    let started = false;
    for (let i = 0; i < pending.length; ) {
      const waiting = pending[i];
      const spec = specs.get(waiting.measureId);
      if (spec === undefined) {
        pending.splice(i, 1);
        continue;
      }
      if (waiting.queuedTick <= now && canStart(spec, running, specs, capacities)) {
        const placed = {
          measureId: waiting.measureId,
          targetId: waiting.targetId,
          startTick: now,
          endTick: now + durationTicks(spec),
        };
        running.push(placed);
        projection.push({ ...placed, waiting: now > tick });
        pending.splice(i, 1);
        started = true;
      } else {
        i += 1;
      }
    }

    if (!started) {
      // Nothing could start, so jump straight to the next moment the picture
      // changes: a running measure releasing its resources, or a command whose
      // queued tick is still ahead. Stepping one tick at a time would be the
      // same answer arrived at slowly — and slowly enough to hit the loop
      // bound and silently drop a measure from the preview.
      let next = Number.POSITIVE_INFINITY;
      for (const active of running) {
        if (active.endTick > now && active.endTick < next) next = active.endTick;
      }
      for (const waiting of pending) {
        if (waiting.queuedTick > now && waiting.queuedTick < next) next = waiting.queuedTick;
      }
      if (!Number.isFinite(next)) break;
      now = next;
    }
  }

  return projection.sort((a, b) => a.startTick - b.startTick || a.endTick - b.endTick);
}

/**
 * The makespan of a projection: ticks from `tick` until the last measure ends.
 * This is the number that has to fit inside the escalation window.
 */
export function makespanTicks(projection: readonly ProjectedMeasure[], tick: number): number {
  let last = tick;
  for (const measure of projection) {
    if (measure.endTick > last) last = measure.endTick;
  }
  return last - tick;
}
