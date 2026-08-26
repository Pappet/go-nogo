/**
 * Drives the simulation from the browser and exposes a snapshot to the console.
 *
 * This is the boundary the determinism rules draw: the wall clock lives here,
 * not in `src/sim`. Every frame this module measures how much real time passed
 * and hands that number to the engine, which converts it into whole ticks. The
 * UI never writes simulation state — player actions become tick-stamped
 * commands, and the console reads a snapshot taken after the ticks have run.
 */
import { dismissOffer } from '../sim/pauseModel.js';
import {
  createMissionConfig,
  checklist,
  defaultVehicle,
  effectiveExposure,
  effectivePartDef,
  pitchProgram,
  contracts,
  doctrineById,
  groundStations,
  scenarioById,
  scenarios,
  baseMeasureDuration,
  staffTable,
  techEffects,
  techTree,
  doctrines,
  partLethality,
  qaLevels,
  rocket,
} from '../missionConfig.js';
import { type DoctrineDef, nearestAllowedQa, qaLocked } from '../economy/doctrine.js';
import {
  type CampaignState,
  createCampaign,
  nextMissionKey,
} from '../economy/campaign.js';
import {
  type Contract,
  generateBoard,
  meetsRequirements,
  settleContract,
} from '../economy/markets.js';
import {
  type TechState,
  createTechState,
  nextStep,
  researchLevel,
  takeFork,
} from '../economy/techTree.js';
import {
  type Engineer,
  type StaffState,
  createStaffState,
  dismiss,
  hire,
  measureDurationOverrides,
  offerPool,
  weeklySalaries,
} from '../economy/staff.js';
import {
  type SandboxState,
  type ScenarioDef,
  applyScenario,
  createSandboxState,
  enterSandbox,
  leaveSandbox,
  noteOrbitReached,
  startingVehicle,
  weeklyFixedCosts,
} from '../economy/scenario.js';
import {
  type BankruptcyState,
  createBankruptcyState,
  isFrozen,
  recordContractFlown,
  reviewFinances,
} from '../economy/bankruptcy.js';
import { QA_LEVELS } from '../sim/parts/partInstance.js';
import {
  type RiskBudget,
  computeRiskBudget,
  headlineRisk,
} from '../economy/riskBudget.js';
import { type SlotChoice, type VehicleConfig, buildVehicle, changedSlots } from '../economy/vehicle.js';
import type { QaLevel } from '../sim/parts/partInstance.js';
import {
  type MissionReport,
  buildMissionReport,
  verdictLine,
} from '../sim/diagnosis/postMortem.js';
import {
  candidateBars,
  candidatesFor,
  observedSymptoms,
  openAnomalies,
} from '../sim/diagnosis/diagnosis.js';
import type { CandidatePrior } from '../sim/diagnosis/priors.js';
import {
  type ProjectedMeasure,
  projectSchedule,
} from '../sim/diagnosis/measures.js';
import { ticksToEscalation } from '../sim/systems/anomaly.js';
import { type StationView, downlinkFraction, viewAll } from '../sim/systems/comms.js';
import type { ConsoleSlot } from './hotkeys.js';
import {
  type CountdownPhase,
  type MissionConfigInput,
  type MissionEvent,
  type MissionState,
  allChecklistItemsGo,
  countdownDisplay_s,
  createMissionSimulation,
  createMissionState,
} from '../sim/countdown.js';
import { type Command, Engine, MAX_NUMERIC_WARP, TICKS_PER_SECOND } from '../sim/engine.js';
import {
  currentSensedG,
  isThrusting,
  missionTime_s,
  positionOf,
  propellantFraction,
  velocityOf,
} from '../sim/flight.js';
import { altitudeOf, environmentAt, speedOf } from '../sim/physics/ascent.js';
import { EARTH_RADIUS_M, MU_EARTH } from '../sim/physics/constants.js';
import {
  type OrbitalElements,
  apoapsisRadius_m,
  isElliptical,
  periapsisRadius_m,
  stateToElements,
} from '../sim/physics/kepler.js';
import { GAME_VERSION, type Run, computeDataVersion } from '../replay/run.js';

import { playAlert, playBeep, playIgnitionRumble, playSwitchClick, unlockAudio } from './audio/synth.js';
import { formatMissionClock } from './format.js';
import { TrailSampler } from './trail.js';

const SAVE_KEY = 'go-nogo/run';
const AUTOSAVE_INTERVAL_MS = 30000;
/** Shortest gap between two map trail samples, in simulated ticks. */
const TRAIL_INTERVAL_TICKS = 10;
/** Points the trail keeps. Reaching it halves the resolution, never the span. */
const TRAIL_LIMIT = 900;

export interface OrbitReadout {
  readonly periapsisAltitude_m: number;
  readonly apoapsisAltitude_m: number;
  readonly eccentricity: number;
  readonly elements: OrbitalElements;
}

/** One anomaly as the ENGINEERING console needs to draw it. */
export interface AnomalyView {
  readonly id: string;
  readonly symptoms: { readonly title: string; readonly strength: number }[];
  readonly candidates: CandidatePrior[];
  readonly candidateTitles: Record<string, string>;
  /** Seconds until the escalation window closes. Negative once it has. */
  readonly secondsToEscalation: number;
  readonly escalationWindow_s: number;
}

export interface MeasureView {
  readonly id: string;
  readonly title: string;
  readonly duration_s: number;
  readonly occupies: readonly string[];
  readonly kind: 'diagnosis' | 'resolution';
  /** True while this measure would tell the player nothing new. */
  readonly redundant: boolean;
}

export interface ChannelView {
  readonly capacity: number;
  readonly inUse: number;
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

  console: ConsoleSlot;
  anomalies: AnomalyView[];
  measures: MeasureView[];
  timeline: ProjectedMeasure[];
  channels: ChannelView;
  /** What each ground station can see right now (§7 ③). */
  stations: readonly StationView[];
  /** Science queued aboard, and what has reached the ground (§6.3). */
  downlink: { queued: number; delivered: number; fraction: number };
  resultOffer: { anomalyId: string; measureTitle: string } | null;

  /** The live risk budget for the vehicle as configured (§5.4). */
  risk: RiskBudget;
  /** The doctrine this campaign is flying under (§6.1). */
  doctrine: DoctrineDef;
  /** The campaign's books (§6). */
  campaign: CampaignState;
  /** This week's offers (§6.2), and the one that was taken. */
  board: readonly Contract[];
  contract: Contract | null;
  /** Why the drafted vehicle would not be accepted, if it would not. */
  contractShortfall: readonly string[];
  /** What the campaign has researched, and what it could buy next (§6.4). */
  tech: TechState;
  /** Who is on the payroll, and who could be (§6.5). */
  staff: StaffState;
  staffPool: readonly Engineer[];
  weeklySalaries: number;
  /** The opening this campaign was started from (§9). */
  scenario: ScenarioDef;
  /** The free mode, and whether it has been earned yet (§6.7). */
  sandbox: SandboxState;
  /** Wall-clock note of the last auto-save, for the mid-mission save (§8.2). */
  savedAt: string | null;
  /** Where the campaign stands with its investor (§6.6). */
  finances: BankruptcyState;
  frozenBranchIds: readonly string[];
  /** The vehicle the planner is editing, and whether it is open. */
  plannerOpen: boolean;
  vehicle: VehicleConfig;
  /** Slots the planner has changed but not yet applied — these will re-roll. */
  pendingChanges: string[];
  /** True while the console is showing a flight restored from the auto-save. */
  resumedFromSave: boolean;
  /** True once the flight has an outcome to review — lost, or in orbit. */
  missionOver: boolean;
  /** The post-mortem, derived on demand. Null while the mission is running. */
  report: MissionReport | null;
  verdict: string;
}

export const checklistItems = checklist.items;
export const maxDynamicPressureLimit_Pa = rocket.maxDynamicPressure_Pa;
export const targetOrbit = rocket.targetOrbit;

/**
 * Consoles that exist. The rest of §7's six are drawn in the tab bar and
 * inert.
 *
 * One list, read by both the shell and `switchConsole` — it was two, they
 * drifted the moment COMMS was added, and the console silently refused to
 * open while its tab looked enabled.
 */
export const AVAILABLE_CONSOLES: readonly ConsoleSlot[] = ['launch', 'comms', 'engineering'];


export class Mission {
  telemetry = $state<Telemetry>(emptyTelemetry());

  /**
   * The mission being flown. An instance field rather than a module constant
   * because §5.4's second retry path hands the player a different mission, and
   * the graph, priors and capacities all come out of here.
   */
  private config: MissionConfigInput = createMissionConfig();
  /**
   * Rebuilds the mission for where the campaign now stands.
   *
   * The key comes from the campaign, so mission 2 is a different flight from
   * mission 1 — while the campaign seed keeps every part serial stable across
   * all of them, which is what §5.4's re-roll and the post-mortem's what-if
   * both need.
   */
  private reconfigure(): void {
    this.config = createMissionConfig({
      seed: this.campaign.seed,
      missionKey: nextMissionKey(this.campaign),
      vehicle: this.vehicleConfig,
      tech: this.tech,
      measureDurations: measureDurationOverrides(staffTable, this.staff, (measureId) =>
        baseMeasureDuration(measureId),
      ),
      researchData: this.contract?.researchData ?? 0,
    });
  }
  /** Counts the missions this session has rolled, for the mission key. */
  private missionSerial = 1;

  /** What the vehicle currently flying was built to. */
  private vehicleConfig: VehicleConfig = defaultVehicle;
  /** The planner's working copy. Applied, or thrown away, as one decision. */
  private draft: VehicleConfig = defaultVehicle;
  private plannerOpen = false;
  /** Chosen once per campaign (§6.1). Defaults until a campaign picks one. */
  private doctrine: DoctrineDef = doctrines[0];
  private campaign: CampaignState = createCampaign(doctrines[0], 42, defaultVehicle);
  private contract: Contract | null = null;
  private tech: TechState = createTechState();
  private staff: StaffState = createStaffState();
  private finances: BankruptcyState = createBankruptcyState();
  private scenario: ScenarioDef = scenarios[0];
  private sandbox: SandboxState = createSandboxState();
  private savedAt: string | null = null;
  /** Set once the flown contract has been booked, so it is booked once. */
  private settled = false;

  private engine = new Engine(createMissionSimulation(this.config), createMissionState(this.config));
  private commands: Command[] = [];
  private trailSampler = new TrailSampler(TRAIL_INTERVAL_TICKS, TRAIL_LIMIT);
  private frameHandle = 0;
  private lastFrameMs = 0;
  private lastAutosaveMs = 0;
  private announcedEvents = 0;
  private resumedFromSave = false;

  start(): void {
    if (this.frameHandle !== 0) return;
    this.lastFrameMs = performance.now();
    this.lastAutosaveMs = this.lastFrameMs;
    const loop = (now: number): void => {
      const elapsed = now - this.lastFrameMs;
      this.lastFrameMs = now;

      this.engine.advance(elapsed);
      // A destroyed vehicle has nothing left to simulate. Stopping the clock is
      // the honest reading — and it means the post-mortem opens on a still
      // frame instead of over a counter that keeps climbing.
      if (this.state.missionLost && !this.engine.isPaused) this.engine.pause();
      this.captureTrail();
      this.announce();
      this.settleIfFlown(this.state);
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

  /** The console the player is looking at. Presentation, not simulation. */
  private console: ConsoleSlot = 'launch';

  /** Only consoles that exist in this phase can be switched to. */
  switchConsole(slot: ConsoleSlot): boolean {
    if (!AVAILABLE_CONSOLES.includes(slot)) return false;
    this.console = slot;
    this.telemetry = this.snapshot();
    return true;
  }

  /** Queues a measure against an anomaly — a tick-stamped command like any other. */
  queueMeasure(measureId: string, anomalyId: string): void {
    unlockAudio();
    this.commands.push(this.engine.submit('queueMeasure', { measureId, anomalyId }));
    playSwitchClick();
  }

  /** The tick the console is drawing. */
  get currentTick(): number {
    return this.engine.tick;
  }

  /** The anomaly the panel acts on, or null when nothing is open. */
  get focusedAnomaly(): string | null {
    return this.focusedAnomalyId(this.state, this.engine.tick);
  }

  acceptResultOffer(): void {
    this.engine.pause();
    dismissOffer(this.state.diagnosis.pause);
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
    this.engine = new Engine(createMissionSimulation(this.config), createMissionState(this.config));
    this.commands = [];
    this.trailSampler.reset();
    this.announcedEvents = 0;
    this.console = 'launch';
    this.resumedFromSave = false;
    this.plannerOpen = false;
    this.settled = false;
    this.telemetry = this.snapshot();
  }

  // ---------- The planner (§5.4) ----------

  /**
   * Opens the planner on a copy of what is currently built.
   *
   * Only on the pad: the vehicle decides which anomalies the mission has, so
   * editing it in flight would rewrite a crisis the player is already inside.
   */
  openPlanner(): void {
    if (this.state.phase !== 'HOLD' && !this.telemetry.missionOver) return;
    this.draft = this.vehicleConfig;
    this.plannerOpen = true;
    this.telemetry = this.snapshot();
  }

  closePlanner(): void {
    this.plannerOpen = false;
    this.draft = this.vehicleConfig;
    this.telemetry = this.snapshot();
  }

  private editSlot(slotId: string, change: Partial<SlotChoice>): void {
    this.draft = {
      slots: this.draft.slots.map((slot) =>
        slot.slotId === slotId ? { ...slot, ...change } : slot,
      ),
    };
    this.telemetry = this.snapshot();
  }

  setSlotQa(slotId: string, qaLevel: QaLevel): void {
    // A locked level is not offered, so reaching one means the doctrine
    // changed under a saved vehicle. Take the nearest it does allow rather
    // than refusing the click with no explanation.
    this.editSlot(slotId, {
      qaLevel: qaLocked(this.doctrine, qaLevel)
        ? nearestAllowedQa(this.doctrine, qaLevel, QA_LEVELS)
        : qaLevel,
    });
  }

  /**
   * Switches doctrine and restarts (§6.1).
   *
   * Once per campaign in the finished game; here it is how the player picks
   * one at all. Any slot on a level the new doctrine forbids moves to the
   * nearest allowed one — refusing to load would be the wrong answer to a
   * choice the player is allowed to make.
   */
  setSlotUnits(slotId: string, units: number): void {
    this.editSlot(slotId, { units: Math.max(1, Math.min(3, units)) });
  }

  /**
   * Flies the drafted vehicle — §5.4's second retry path, done properly.
   *
   * Same seed, same mission key: only the slots the player actually touched
   * get new hardware, because every part is keyed by its slot. A cause whose
   * parts did not change is compared against the same draw at the same
   * threshold and therefore behaves identically. That is what makes the
   * re-plan surgical rather than a new mission wearing the old one's name.
   */
  applyPlan(): void {
    this.vehicleConfig = this.draft;
    this.plannerOpen = false;
    this.reconfigure();
    this.clearSave();
    this.reset();
  }

  /**
   * Retry path 1 (§5.4): same seed, same configuration.
   *
   * The identical run — same anomalies, same onset times, same symptom
   * strengths. This is the learning path: the crisis that just killed the
   * vehicle comes back unchanged, and the player gets to diagnose it properly.
   */
  retrySameMission(): void {
    this.clearSave();
    this.reset();
  }

  /**
   * Retry path 2 (§5.4): the planner reopens with the last configuration.
   *
   * "Only changed parts re-roll" is not a special case here — it is what the
   * serial keying already does. The player changes a valve; that slot builds
   * new units and every other slot keeps the exact hardware it flew with.
   */
  retryNewConfiguration(): void {
    // The campaign has moved on: the flown contract is booked, the week has
    // turned, and the next mission is a new flight rather than the same one.
    this.reconfigure();
    this.contract = null;
    this.draft = this.vehicleConfig;
    this.plannerOpen = true;
    this.clearSave();
    this.reset();
    this.plannerOpen = true;
    this.telemetry = this.snapshot();
  }

  /** Starts a campaign on a scenario (§9). Like the doctrine, once per run. */
  chooseScenario(scenarioId: string): void {
    this.scenario = scenarioById(scenarioId);
    this.startCampaign();
  }

  /** Enters or leaves the free mode (§6.7). */
  toggleSandbox(): void {
    if (this.sandbox.active) leaveSandbox(this.sandbox);
    else if (!enterSandbox(this.sandbox)) return;
    this.contract = null;
    this.reconfigure();
    this.clearSave();
    this.reset();
    this.plannerOpen = true;
    this.telemetry = this.snapshot();
  }

  chooseDoctrine(doctrineId: string): void {
    this.doctrine = doctrineById(doctrineId);
    this.startCampaign();
  }

  /**
   * Restarts the campaign on the current doctrine and scenario.
   *
   * Doctrine first, then scenario: the doctrine decides what kind of company
   * this is, the scenario decides what it is standing in — so "Inherited
   * Hardware" dents a Science company's already negative commercial standing
   * rather than replacing it.
   */
  private startCampaign(): void {
    const legal = (vehicle: VehicleConfig): VehicleConfig => ({
      slots: vehicle.slots.map((slot) => ({
        ...slot,
        qaLevel: nearestAllowedQa(this.doctrine, slot.qaLevel, QA_LEVELS),
      })),
    });

    this.vehicleConfig = legal(startingVehicle(this.scenario, defaultVehicle));
    this.draft = this.vehicleConfig;
    this.campaign = createCampaign(this.doctrine, this.campaign.seed, this.vehicleConfig);
    applyScenario(this.campaign, this.scenario);

    this.contract = null;
    // A doctrine is chosen once per campaign, so switching starts a new one —
    // including its research, which was bought under the old one's prices, its
    // payroll and its standing with the investor.
    this.tech = createTechState();
    this.staff = createStaffState();
    this.finances = createBankruptcyState();
    this.sandbox = createSandboxState();

    this.reconfigure();
    this.clearSave();
    this.reset();
    this.plannerOpen = true;
    this.telemetry = this.snapshot();
  }

  // ---------- Save and resume: a run truncated at a tick (§8.2 rule 9) ----------

  /**
   * Writes the save and notes when.
   *
   * §9 asks for the mid-mission save to be *prominent*, and the auto-save was
   * already running silently — which is the worst of both, because a player
   * who cannot see it happen does not trust it and quits at a milestone
   * instead of when they want to.
   */
  save(): void {
    if (typeof localStorage === 'undefined') return;
    const run: Run = {
      gameVersion: GAME_VERSION,
      dataVersion: computeDataVersion(rocket, pitchProgram, checklist),
      seed: this.config.seed,
      configuration: { rocketName: rocket.name, missionKey: this.config.missionKey },
      commands: this.commands,
      stateHashes: [],
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ run, tick: this.engine.tick }));
      this.savedAt = formatMissionClock(this.telemetry.clock_s);
      this.telemetry = this.snapshot();
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
      if (typeof saved.run.configuration?.missionKey !== 'string') {
        // Saved before the mission key was recorded: which crisis it was flying
        // is no longer knowable, so resuming it would be a guess.
        return false;
      }
      if (saved.run.commands.length === 0) {
        // Nothing was ever commanded, so the save restores a vehicle sitting on
        // the pad — no different from starting fresh, and not worth announcing.
        return false;
      }
      // The mission key decides the anomalies, so a save flown under a
      // different one would resume into a different crisis.
      this.config = createMissionConfig({
        seed: saved.run.seed,
        missionKey: saved.run.configuration.missionKey,
      });
      this.reset();
      for (const command of saved.run.commands) this.engine.inject(command);
      // Keep the serial ahead of the restored key, so "new mission" does not
      // hand back a mission this session has already flown.
      const serial = Number(saved.run.configuration.missionKey.replace(/^mission-/, ''));
      if (Number.isFinite(serial) && serial >= this.missionSerial) this.missionSerial = serial;
      this.commands = [...saved.run.commands];
      this.engine.runTo(saved.tick);
      this.announcedEvents = this.state.events.length;
      this.captureTrail();
      this.resumedFromSave = true;
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
    this.trailSampler.offer(flight.tick, flight.positionX, flight.positionY);
  }

  private snapshot(): Telemetry {
    const state = this.state;
    const tick = this.engine.tick;
    const flight = state.flight;
    const position = positionOf(flight);
    const velocity = velocityOf(flight);
    const environment = environmentAt(position, velocity);
    const over = this.isOver(state);
    const report = over
      ? buildMissionReport(
          this.config.causeGraph,
          state.diagnosis.anomalies,
          state.diagnosis.results,
          state.missionLost,
          headlineRisk(this.riskBudget(this.vehicleConfig)),
          TICKS_PER_SECOND,
        )
      : null;

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
      trail: [...this.trailSampler.trail],

      console: this.console,
      anomalies: this.anomalyViews(state, tick),
      measures: this.measureViews(state, tick),
      timeline: this.projectQueued(state, tick),
      channels: this.channelView(state),
      stations: viewAll(groundStations, position, missionTime_s(state.flight)),
      downlink: {
        queued: state.comms.queued,
        delivered: state.comms.downlinked,
        fraction: downlinkFraction(state.comms),
      },
      resultOffer:
        state.diagnosis.pause.offer === null
          ? null
          : {
              anomalyId: state.diagnosis.pause.offer.anomalyId,
              measureTitle: this.config.causeGraph.measure(state.diagnosis.pause.offer.measureId).title,
            },

      risk: this.riskBudget(this.plannerOpen ? this.draft : this.vehicleConfig),
      doctrine: this.doctrine,
      campaign: this.campaign,
      board: generateBoard(contracts, this.campaign, this.campaign.week),
      contract: this.contract,
      contractShortfall: this.shortfall(this.plannerOpen ? this.draft : this.vehicleConfig),
      tech: this.tech,
      staff: this.staff,
      staffPool: offerPool(staffTable, this.campaign, this.campaign.week),
      weeklySalaries: weeklySalaries(this.staff),
      scenario: this.scenario,
      sandbox: this.sandbox,
      savedAt: this.savedAt,
      finances: this.finances,
      frozenBranchIds: techTree.branches
        .filter((branch) => isFrozen(this.finances, branch.id))
        .map((branch) => branch.id),
      plannerOpen: this.plannerOpen,
      vehicle: this.plannerOpen ? this.draft : this.vehicleConfig,
      pendingChanges: changedSlots(this.vehicleConfig, this.draft),
      resumedFromSave: this.resumedFromSave,
      missionOver: over,
      report,
      verdict: report === null ? '' : verdictLine(report),
    };
  }

  /** What the accepted contract would refuse about this vehicle (§6.2). */
  private shortfall(vehicle: VehicleConfig): string[] {
    if (this.contract === null) return [];
    return [
      ...meetsRequirements(
        this.contract,
        vehicle.slots.map((slot) => slot.qaLevel),
        QA_LEVELS,
        headlineRisk(this.riskBudget(vehicle)),
      ).reasons,
    ];
  }

  /** Puts an engineer on the payroll (§6.5). */
  hireEngineer(engineerId: string): void {
    const engineer = offerPool(staffTable, this.campaign, this.campaign.week).find(
      (entry) => entry.id === engineerId,
    );
    if (engineer === undefined) return;
    if (!hire(staffTable, this.staff, engineer)) return;
    this.reconfigure();
    this.telemetry = this.snapshot();
  }

  dismissEngineer(engineerId: string): void {
    dismiss(this.staff, engineerId);
    this.reconfigure();
    this.telemetry = this.snapshot();
  }

  /** Buys the next thing a branch offers, level or fork (§6.4). */
  research(branchId: string, optionId?: string): void {
    const branch = techTree.branches.find((entry) => entry.id === branchId);
    if (branch === undefined) return;
    // A frozen branch is the investor's condition, not a suggestion (§6.6).
    if (isFrozen(this.finances, branchId)) return;
    const step = nextStep(branch, this.tech);
    if (step === null) return;
    if (step.kind === 'level') researchLevel(branch, this.tech);
    else if (optionId !== undefined) takeFork(branch, this.tech, optionId);
    // Research changes the hardware, so the mission has to be rebuilt on it.
    this.reconfigure();
    this.telemetry = this.snapshot();
  }

  /** Takes an offer off this week's board. */
  acceptContract(templateId: string): void {
    const board = generateBoard(contracts, this.campaign, this.campaign.week);
    this.contract = board.find((entry) => entry.templateId === templateId) ?? null;
    // The mission has to know how much science it is carrying, so the link
    // has something to fail to deliver.
    this.reconfigure();
    this.telemetry = this.snapshot();
  }

  /**
   * Books the flown contract, once.
   *
   * A mission counts as delivered when the vehicle survived to the orbit
   * check. Anything else is a failure the customer pays nothing for and fines
   * on top — §6.2's penalty clause is what makes a cheap vehicle a decision
   * rather than a free ride.
   */
  private settleIfFlown(state: MissionState): void {
    if (this.settled || !this.isOver(state)) return;

    // §6.7's unlock, read literally: the vehicle still exists and the orbit
    // closes. A suborbital arc that came down intact is not it, and neither is
    // an orbit reached by something that then broke up.
    const orbit = readOrbit(
      state.flight.positionX,
      state.flight.positionY,
      state.flight.velocityX,
      state.flight.velocityY,
    );
    noteOrbitReached(
      this.sandbox,
      !state.missionLost && orbit !== null && orbit.periapsisAltitude_m > 0,
    );

    if (this.contract === null) {
      this.settled = true;
      return;
    }
    this.settled = true;
    const outcome = settleContract(contracts, this.campaign, this.contract, !state.missionLost);
    // §6.3: downlink limited by comms. Science that never reached a station
    // never happened, whatever the instrument recorded.
    this.tech.data += outcome.researchData * downlinkFraction(state.comms);
    this.campaign.vehicle = this.vehicleConfig;

    // The week turned inside settleContract, so the fixed costs are due and
    // the investor gets to look at the books (§6.5, §6.6). The sandbox has
    // neither — that one line is what makes it a mode (§6.7).
    this.campaign.capital -= weeklyFixedCosts(
      this.scenario,
      weeklySalaries(this.staff),
      this.sandbox.active,
    );
    recordContractFlown(this.finances);
    if (!this.sandbox.active) {
      reviewFinances(this.finances, this.campaign, techTree.branches, this.tech);
    }
  }

  /** The risk budget for a configuration, priced for this mission. */
  private riskBudget(vehicle: VehicleConfig): RiskBudget {
    return computeRiskBudget(
      buildVehicle(vehicle, qaLevels, this.config.seed, this.doctrine, (id) =>
        effectivePartDef(id, techEffects(this.tech)),
      ),
      effectiveExposure(techEffects(this.tech)),
      rocket.nominalMissionDuration_s,
      partLethality,
    );
  }

  /**
   * The mission has an outcome once the vehicle is lost or the orbit check has
   * run. Both are simulation states, not screen states — the post-mortem opens
   * because the flight ended, not because a timer fired.
   */
  private isOver(state: MissionState): boolean {
    return state.missionLost || state.phase === 'ORBIT_CHECK';
  }

  /** One view per anomaly the player can still act on. */
  private anomalyViews(state: MissionState, tick: number): AnomalyView[] {
    return openAnomalies(state.diagnosis, tick).map((anomalyId) => {
      const anomaly = state.diagnosis.anomalies.anomalies.find((entry) => entry.id === anomalyId)!;
      const candidates = candidateBars(
        state.diagnosis,
        this.config.causeGraph,
        this.config.priorSettings,
        anomalyId,
        state.phase,
        tick,
      );
      const titles: Record<string, string> = {};
      for (const candidate of candidates) {
        titles[candidate.causeId] = this.config.causeGraph.cause(candidate.causeId).title;
      }
      return {
        id: anomalyId,
        symptoms: observedSymptoms(state.diagnosis, anomalyId, tick).map((symptomId) => ({
          title: this.config.causeGraph.symptom(symptomId).title,
          strength:
            anomaly.symptoms.find((symptom) => symptom.symptomId === symptomId)?.strength ?? 0,
        })),
        candidates,
        candidateTitles: titles,
        secondsToEscalation: ticksToEscalation(anomaly, tick) / TICKS_PER_SECOND,
        escalationWindow_s: this.config.causeGraph.escalationWindow_s(anomaly.causeId),
      };
    });
  }

  /**
   * The measures on offer for the focused anomaly.
   *
   * A diagnosis is marked redundant once it can no longer separate any two
   * surviving candidates. The panel greys it rather than hiding it, so the
   * player can see they have already bought that answer instead of wondering
   * where the button went.
   */
  private measureViews(state: MissionState, tick: number): MeasureView[] {
    const focus = this.focusedAnomalyId(state, tick);
    const candidates =
      focus === null ? [] : candidatesFor(state.diagnosis, this.config.causeGraph, focus, tick);
    const useful = new Set(this.config.causeGraph.usefulDiagnoses(candidates));

    return this.config.causeGraph.measureIds.map((measureId) => {
      const measure = this.config.causeGraph.measure(measureId);
      return {
        id: measureId,
        title: measure.title,
        duration_s: measure.duration_s,
        occupies: measure.occupies,
        kind: measure.type,
        redundant: measure.type === 'diagnosis' && !useful.has(measureId),
      };
    });
  }

  /**
   * The command timeline, including commands still sitting in the engine
   * queue.
   *
   * While paused no tick runs, so a measure the player just queued has not
   * reached the scheduler yet — it is a pending command. Projecting only the
   * scheduler would show an empty timeline at exactly the moment the player is
   * planning against it, which is the one moment it has to be right (§5.7).
   */
  private projectQueued(state: MissionState, tick: number): ProjectedMeasure[] {
    const pendingCommands = this.engine.pending.filter(
      (command) => command.type === 'queueMeasure',
    );
    if (pendingCommands.length === 0) {
      return projectSchedule(
        state.diagnosis.schedule,
        tick,
        this.config.causeGraph.specs,
        this.config.causeGraph.capacities,
      );
    }

    const merged = {
      running: [...state.diagnosis.schedule.running],
      completed: [...state.diagnosis.schedule.completed],
      pending: [
        ...state.diagnosis.schedule.pending,
        ...pendingCommands.map((command) => {
          const payload = command.payload as { measureId: string; anomalyId: string };
          return {
            measureId: payload.measureId,
            targetId: payload.anomalyId,
            queuedTick: command.tick,
          };
        }),
      ],
    };
    return projectSchedule(merged, tick, this.config.causeGraph.specs, this.config.causeGraph.capacities);
  }

  private channelView(state: MissionState): ChannelView {
    const capacity = this.config.causeGraph.capacities['channel:any'] ?? 1;
    let inUse = 0;
    for (const running of state.diagnosis.schedule.running) {
      const spec = this.config.causeGraph.specs.get(running.measureId);
      for (const resource of spec?.occupies ?? []) {
        if (resource === 'channel:any') inUse += 1;
      }
    }
    return { capacity, inUse };
  }

  /** The anomaly the console acts on: whichever is closest to escalating. */
  private focusedAnomalyId(state: MissionState, tick: number): string | null {
    const open = openAnomalies(state.diagnosis, tick);
    if (open.length === 0) return null;
    let focus = open[0];
    let soonest = Number.POSITIVE_INFINITY;
    for (const anomalyId of open) {
      const anomaly = state.diagnosis.anomalies.anomalies.find((entry) => entry.id === anomalyId)!;
      const remaining = ticksToEscalation(anomaly, tick);
      if (remaining < soonest) {
        soonest = remaining;
        focus = anomalyId;
      }
    }
    return focus;
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
    console: 'launch',
    anomalies: [],
    measures: [],
    timeline: [],
    channels: { capacity: 0, inUse: 0 },
    stations: [],
    downlink: { queued: 0, delivered: 0, fraction: 1 },
    resultOffer: null,
    risk: { lossOfMission: [0, 0], lines: [], mass_kg: 0, redundancyMass_kg: 0, cost: 0 },
    doctrine: doctrines[0],
    campaign: createCampaign(doctrines[0], 42, { slots: [] }),
    board: [],
    contract: null,
    contractShortfall: [],
    tech: createTechState(),
    staff: createStaffState(),
    staffPool: [],
    weeklySalaries: 0,
    scenario: scenarios[0],
    sandbox: createSandboxState(),
    savedAt: null,
    finances: createBankruptcyState(),
    frozenBranchIds: [],
    plannerOpen: false,
    vehicle: { slots: [] },
    pendingChanges: [],
    resumedFromSave: false,
    missionOver: false,
    report: null,
    verdict: '',
  };
}
