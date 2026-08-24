/**
 * Drives the simulation from the browser and exposes a snapshot to the console.
 *
 * This is the boundary the determinism rules draw: the wall clock lives here,
 * not in `src/sim`. Every frame this module measures how much real time passed
 * and hands that number to the engine, which converts it into whole ticks. The
 * UI never writes simulation state — player actions become tick-stamped
 * commands, and the console reads a snapshot taken after the ticks have run.
 */
import checklistData from '../data/checklist.json' with { type: 'json' };
import pitchData from '../data/pitchProgram.json' with { type: 'json' };
import rocketData from '../data/rocket.json' with { type: 'json' };
import {
  type ChecklistDef,
  type CountdownPhase,
  type MissionEvent,
  type MissionState,
  allChecklistItemsGo,
  countdownDisplay_s,
  createMissionSimulation,
  createMissionState,
} from '../sim/countdown.js';
import { type Command, Engine, MAX_NUMERIC_WARP } from '../sim/engine.js';
import {
  currentSensedG,
  isThrusting,
  positionOf,
  propellantFraction,
  velocityOf,
} from '../sim/flight.js';
import { altitudeOf, environmentAt, speedOf } from '../sim/physics/ascent.js';
import type { PitchProgram } from '../sim/physics/ascentProgram.js';
import { EARTH_RADIUS_M, MU_EARTH } from '../sim/physics/constants.js';
import {
  type OrbitalElements,
  apoapsisRadius_m,
  isElliptical,
  periapsisRadius_m,
  stateToElements,
} from '../sim/physics/kepler.js';
import type { RocketDef } from '../sim/physics/thrust.js';
import { GAME_VERSION, type Run, computeDataVersion } from '../replay/run.js';

import { playAlert, playBeep, playIgnitionRumble, playSwitchClick, unlockAudio } from './audio/synth.js';

const rocket = rocketData as RocketDef;
const pitchProgram = pitchData as PitchProgram;
const checklist = checklistData as ChecklistDef;
const config = { rocket, pitchProgram, checklist };

const SAVE_KEY = 'go-nogo/run';
const AUTOSAVE_INTERVAL_MS = 30000;
/** Sample the map trail every half second of simulated time. */
const TRAIL_INTERVAL_TICKS = 10;
const TRAIL_LIMIT = 900;

export interface OrbitReadout {
  readonly periapsisAltitude_m: number;
  readonly apoapsisAltitude_m: number;
  readonly eccentricity: number;
  readonly elements: OrbitalElements;
}

export interface Telemetry {
  phase: CountdownPhase;
  clock_s: number;
  checklist: boolean[];
  readyToArm: boolean;
  altitude_m: number;
  speed_ms: number;
  sensedG: number;
  dynamicPressure_Pa: number;
  maxDynamicPressure_Pa: number;
  propellantFraction: number;
  stageIndex: number;
  thrusting: boolean;
  paused: boolean;
  warp: number;
  events: MissionEvent[];
  orbit: OrbitReadout | null;
  position: { x: number; y: number };
  trail: { x: number; y: number }[];
}

export const checklistItems = checklist.items;
export const maxDynamicPressureLimit_Pa = rocket.maxDynamicPressure_Pa;
export const targetOrbit = rocket.targetOrbit;

export class Mission {
  telemetry = $state<Telemetry>(emptyTelemetry());

  private engine = new Engine(createMissionSimulation(config), createMissionState(checklist));
  private commands: Command[] = [];
  private trail: { x: number; y: number }[] = [];
  private frameHandle = 0;
  private lastFrameMs = 0;
  private lastAutosaveMs = 0;
  private announcedEvents = 0;

  start(): void {
    if (this.frameHandle !== 0) return;
    this.lastFrameMs = performance.now();
    this.lastAutosaveMs = this.lastFrameMs;
    const loop = (now: number): void => {
      const elapsed = now - this.lastFrameMs;
      this.lastFrameMs = now;

      this.engine.advance(elapsed);
      this.captureTrail();
      this.announce();
      this.telemetry = this.snapshot();

      if (now - this.lastAutosaveMs >= AUTOSAVE_INTERVAL_MS) {
        this.lastAutosaveMs = now;
        this.save();
      }
      this.frameHandle = requestAnimationFrame(loop);
    };
    this.frameHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.frameHandle !== 0) {
      cancelAnimationFrame(this.frameHandle);
      this.frameHandle = 0;
    }
  }

  // ---------- Player input: everything becomes a tick-stamped command ----------

  toggleChecklist(index: number): void {
    unlockAudio();
    if (this.state.phase !== 'HOLD') return;
    this.commands.push(this.engine.submit('toggleChecklist', { index }));
    playSwitchClick();
  }

  arm(): void {
    unlockAudio();
    if (this.state.phase !== 'HOLD' || !allChecklistItemsGo(this.state)) return;
    this.commands.push(this.engine.submit('arm', null));
    playSwitchClick();
  }

  togglePause(): void {
    unlockAudio();
    if (this.engine.isPaused) this.engine.resume();
    else this.engine.pause();
    this.telemetry = this.snapshot();
  }

  setWarp(factor: number): void {
    this.engine.setWarp(factor);
    this.telemetry = this.snapshot();
  }

  warpUp(): void {
    this.setWarp(this.engine.warpFactor >= MAX_NUMERIC_WARP ? 20 : this.engine.warpFactor * 2);
  }

  warpDown(): void {
    this.setWarp(this.engine.warpFactor > MAX_NUMERIC_WARP ? MAX_NUMERIC_WARP : 1);
  }

  /** Starts over from a fresh pad. The run recording restarts with it. */
  reset(): void {
    this.engine = new Engine(createMissionSimulation(config), createMissionState(checklist));
    this.commands = [];
    this.trail = [];
    this.announcedEvents = 0;
    this.telemetry = this.snapshot();
  }

  // ---------- Save and resume: a run truncated at a tick (§8.2 rule 9) ----------

  save(): void {
    if (typeof localStorage === 'undefined') return;
    const run: Run = {
      gameVersion: GAME_VERSION,
      dataVersion: computeDataVersion(rocket, pitchProgram, checklist),
      seed: 42,
      configuration: { rocketName: rocket.name },
      commands: this.commands,
      stateHashes: [],
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ run, tick: this.engine.tick }));
    } catch {
      // A full or blocked storage must never take the launch down with it.
    }
  }

  /** Replays a stored run back to its tick. Returns false when there is none. */
  resume(): boolean {
    if (typeof localStorage === 'undefined') return false;
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw === null) return false;

    try {
      const saved = JSON.parse(raw) as { run: Run; tick: number };
      if (saved.run.dataVersion !== computeDataVersion(rocket, pitchProgram, checklist)) {
        // Flown against different numbers: the run would not reproduce.
        return false;
      }
      if (saved.tick <= 0 && saved.run.commands.length === 0) {
        // A save taken before anything happened restores nothing worth saying.
        return false;
      }
      this.reset();
      for (const command of saved.run.commands) this.engine.inject(command);
      this.commands = [...saved.run.commands];
      this.engine.runTo(saved.tick);
      this.announcedEvents = this.state.events.length;
      this.captureTrail();
      this.telemetry = this.snapshot();
      return true;
    } catch {
      return false;
    }
  }

  clearSave(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(SAVE_KEY);
  }

  // ---------- Internals ----------

  private get state(): MissionState {
    return this.engine.state;
  }

  /** Plays a sound for each milestone that appeared since the last frame. */
  private announce(): void {
    const events = this.state.events;
    for (let i = this.announcedEvents; i < events.length; i++) {
      const event = events[i];
      if (event.type === 'IGNITION') playIgnitionRumble();
      else if (event.type === 'ORBIT_CHECK') {
        if (event.message.includes('NOMINAL')) playBeep(true);
        else playAlert();
      } else if (event.type !== 'CHECKLIST') playBeep(false);
    }
    this.announcedEvents = events.length;
  }

  private captureTrail(): void {
    const flight = this.state.flight;
    if (flight.liftoffTick < 0) return;
    if (flight.tick % TRAIL_INTERVAL_TICKS !== 0) return;
    this.trail.push({ x: flight.positionX, y: flight.positionY });
    if (this.trail.length > TRAIL_LIMIT) this.trail.shift();
  }

  private snapshot(): Telemetry {
    const state = this.state;
    const flight = state.flight;
    const position = positionOf(flight);
    const velocity = velocityOf(flight);
    const environment = environmentAt(position, velocity);

    return {
      phase: state.phase,
      clock_s: countdownDisplay_s(state),
      checklist: [...state.checklist],
      readyToArm: state.phase === 'HOLD' && allChecklistItemsGo(state),
      altitude_m: altitudeOf(position),
      speed_ms: speedOf(velocity),
      sensedG: currentSensedG(flight, rocket),
      dynamicPressure_Pa: flight.liftoffTick >= 0 ? environment.dynamicPressure_Pa : 0,
      maxDynamicPressure_Pa: flight.maxDynamicPressure_Pa,
      propellantFraction: flight.ignited ? propellantFraction(flight, rocket) : 1,
      stageIndex: flight.stageIndex,
      thrusting: isThrusting(flight),
      paused: this.engine.isPaused,
      warp: this.engine.warpFactor,
      events: state.events.slice(-14),
      orbit: readOrbit(flight.positionX, flight.positionY, flight.velocityX, flight.velocityY),
      position: { x: flight.positionX, y: flight.positionY },
      trail: [...this.trail],
    };
  }
}

function readOrbit(x: number, y: number, vx: number, vy: number): OrbitReadout | null {
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed < 1) return null;
  const elements = stateToElements({ x, y }, { x: vx, y: vy }, MU_EARTH);
  if (!isElliptical(elements)) return null;
  return {
    periapsisAltitude_m: periapsisRadius_m(elements) - EARTH_RADIUS_M,
    apoapsisAltitude_m: apoapsisRadius_m(elements) - EARTH_RADIUS_M,
    eccentricity: elements.eccentricity,
    elements,
  };
}

function emptyTelemetry(): Telemetry {
  return {
    phase: 'HOLD',
    clock_s: 0,
    checklist: checklist.items.map(() => false),
    readyToArm: false,
    altitude_m: 0,
    speed_ms: 0,
    sensedG: 0,
    dynamicPressure_Pa: 0,
    maxDynamicPressure_Pa: 0,
    propellantFraction: 1,
    stageIndex: 0,
    thrusting: false,
    paused: false,
    warp: 1,
    events: [],
    orbit: null,
    position: { x: EARTH_RADIUS_M, y: 0 },
    trail: [],
  };
}
