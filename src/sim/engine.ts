/**
 * The tick engine: time, pause, warp and the command queue (concept §8.2
 * rules 1–3, 6).
 *
 * The simulation knows only integer ticks of DT_MS. It never reads a clock —
 * `advance` takes the elapsed milliseconds as an argument, so the wall clock
 * stays outside `src/sim/` where it belongs. That split is what makes a replay
 * reproducible: how the host chops real time into frames changes when ticks
 * run, never what they compute.
 *
 * Time warp adds ticks per frame; DT_MS never changes. Above the numerical
 * limit the engine switches to closed-form evaluation, which is only offered
 * while the world reports it can coast.
 */

/** Fixed simulation step. Every tick is exactly this long, at every warp. */
export const DT_MS = 50;

/** Ticks per simulated second — 20 Hz. */
export const TICKS_PER_SECOND = 1000 / DT_MS;

/** Numerical warp ceiling (concept §3). Beyond this the world must coast. */
export const MAX_NUMERIC_WARP = 4;

/**
 * Longest real interval a single `advance` may consume. A backgrounded tab
 * reports a huge elapsed time on its first frame back; without this clamp the
 * engine would try to catch up in one blocking burst. Sim time falls behind
 * wall time instead, which is correct: the sim, not the clock, is authoritative.
 */
export const MAX_FRAME_MS = 250;

export interface Command {
  readonly tick: number;
  readonly type: string;
  readonly payload: unknown;
}

/**
 * The world plugged into the engine. Phase 0 supplies the ascent and the
 * orbit; the engine only decides *when* these run.
 */
export interface Simulation<S> {
  /** Advance the world by exactly one tick. Called with the tick being entered. */
  step(state: S, tick: number): void;

  /** Apply a command at its tick boundary, before the tick is stepped. */
  apply(state: S, command: Command, tick: number): void;

  /** True while the world can be evaluated in closed form at an arbitrary tick. */
  canCoast(state: S): boolean;

  /** Jump straight to `tick` analytically. Only called when `canCoast` holds. */
  coastTo(state: S, tick: number): void;
}

export class Engine<S> {
  readonly state: S;

  private readonly simulation: Simulation<S>;
  private readonly queue: Command[] = [];

  private currentTick: number;
  private paused = false;
  private warp = 1;

  /** Real milliseconds not yet converted into ticks. Never a sim input. */
  private accumulatorMs = 0;

  /**
   * `startTick` resumes an engine at a state that has already run: a save is a
   * replayed prefix, and the tick counter has to pick up where that prefix
   * left off rather than restarting at zero.
   */
  constructor(simulation: Simulation<S>, state: S, startTick = 0) {
    this.simulation = simulation;
    this.state = state;
    this.currentTick = startTick;
  }

  get tick(): number {
    return this.currentTick;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pause is simulation state, not a UI timer (concept §8.2 rule 6): while
   * paused no tick runs, so nothing in the world moves, and queued commands
   * wait for their tick rather than being applied early.
   */
  pause(): void {
    this.paused = true;
    // Drop the partial frame. Keeping it would hand the player a few free
    // milliseconds of sim time for pausing at the right moment.
    this.accumulatorMs = 0;
  }

  resume(): void {
    this.paused = false;
  }

  get warpFactor(): number {
    return this.warp;
  }

  /**
   * Warp above MAX_NUMERIC_WARP is only honoured while the world can coast;
   * during a burn the request is clamped instead of refused, so the UI control
   * needs no special case.
   */
  setWarp(factor: number): void {
    this.warp = factor < 1 ? 1 : Math.floor(factor);
  }

  private effectiveWarp(): number {
    if (this.warp <= MAX_NUMERIC_WARP) return this.warp;
    return this.simulation.canCoast(this.state) ? this.warp : MAX_NUMERIC_WARP;
  }

  /**
   * Stamp a player action onto the next tick that has not run yet and queue it.
   * The stamped command is returned so the run recorder logs exactly what the
   * simulation will see (concept §8.2 rule 3).
   */
  submit(type: string, payload: unknown): Command {
    const command: Command = { tick: this.currentTick, type, payload };
    this.queue.push(command);
    return command;
  }

  /**
   * Feed a command from a recorded run. Its tick must still be ahead of the
   * simulation: replaying a command the world has already moved past would
   * produce a different history, so it fails loudly instead.
   */
  inject(command: Command): void {
    if (command.tick < this.currentTick) {
      throw new Error(
        `Command '${command.type}' is stamped at tick ${command.tick}, already past tick ${this.currentTick}`,
      );
    }
    this.queue.push(command);
  }

  /** Commands still waiting, in the order they will be applied. */
  get pending(): readonly Command[] {
    return this.queue;
  }

  /**
   * Convert elapsed real time into ticks. Returns how many ticks ran.
   *
   * This is the only place real time enters, and it enters as an argument.
   * Frame sizes therefore have no effect on the outcome — `runTicks(100)` and
   * a hundred ragged `advance` calls produce the same state.
   */
  advance(elapsedMs: number): number {
    if (this.paused) return 0;

    const clamped = elapsedMs > MAX_FRAME_MS ? MAX_FRAME_MS : elapsedMs;
    if (clamped > 0) {
      this.accumulatorMs += clamped * this.effectiveWarp();
    }

    let ticksRun = 0;
    while (this.accumulatorMs >= DT_MS && !this.paused) {
      const affordable = Math.floor(this.accumulatorMs / DT_MS);
      const jumped = this.canJump() ? this.jump(this.currentTick + affordable) : 0;

      if (jumped > 0) {
        this.accumulatorMs -= jumped * DT_MS;
        ticksRun += jumped;
      } else {
        // Either the world is burning, or a command sits on the current tick
        // and blocks the jump. Either way one numerical tick is the answer.
        this.runOneTick();
        this.accumulatorMs -= DT_MS;
        ticksRun += 1;
      }
    }

    if (this.paused) {
      this.accumulatorMs = 0;
    }
    return ticksRun;
  }

  private canJump(): boolean {
    return this.effectiveWarp() > MAX_NUMERIC_WARP && this.simulation.canCoast(this.state);
  }

  /** Coast as far as allowed and report how many ticks were covered. */
  private jump(targetTick: number): number {
    const before = this.currentTick;
    this.coastTo(targetTick);
    return this.currentTick - before;
  }

  /**
   * Advance by an exact number of ticks, ignoring real time entirely. This is
   * what replay and the tests drive: same input, same output, no clock.
   */
  runTicks(count: number): void {
    for (let i = 0; i < count; i++) {
      this.runOneTick();
    }
  }

  /** Run until the simulation reaches `targetTick` (no-op if already there). */
  runTo(targetTick: number): void {
    while (this.currentTick < targetTick) {
      this.runOneTick();
    }
  }

  /**
   * Coast analytically to `targetTick`, stopping early at the next queued
   * command — jumping past a command would apply it late and change history.
   * Returns the tick actually reached. Falls back to stepping when the world
   * cannot coast.
   */
  coastTo(targetTick: number): number {
    // Anything already due lands first; it may end the coast phase outright.
    this.applyDueCommands();
    if (targetTick <= this.currentTick) return this.currentTick;

    if (!this.simulation.canCoast(this.state)) {
      this.runTo(targetTick);
      return this.currentTick;
    }

    const nextCommand = this.nextCommandTick();
    const limit = nextCommand < targetTick ? nextCommand : targetTick;

    if (limit > this.currentTick) {
      this.simulation.coastTo(this.state, limit);
      this.currentTick = limit;
    }
    // Land the command that stopped the jump, so the caller sees its effect.
    this.applyDueCommands();
    return this.currentTick;
  }

  private nextCommandTick(): number {
    let earliest = Infinity;
    for (const command of this.queue) {
      if (command.tick < earliest) earliest = command.tick;
    }
    return earliest;
  }

  /**
   * Apply every command stamped at or before the current tick, in submission
   * order. Order matters and must not depend on sort stability across engines,
   * so the queue is scanned rather than sorted.
   */
  private applyDueCommands(): void {
    let index = 0;
    while (index < this.queue.length) {
      const command = this.queue[index];
      if (command.tick <= this.currentTick) {
        this.queue.splice(index, 1);
        this.simulation.apply(this.state, command, this.currentTick);
      } else {
        index += 1;
      }
    }
  }

  private runOneTick(): void {
    // Commands land on the tick boundary, before the world moves.
    this.applyDueCommands();
    this.simulation.step(this.state, this.currentTick);
    this.currentTick += 1;
  }
}
