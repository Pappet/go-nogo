/**
 * The countdown state machine (concept §9, Phase 0).
 *
 * HOLD → ARMED → IGNITION → LIFTOFF → MAX_Q → MECO → SEP → ORBIT_CHECK.
 *
 * Every transition is decided at a tick from simulation state — never from a
 * UI timer (concept §8.2 rule 6). The player's only inputs are tick-stamped
 * commands: flip a checklist switch, and arm the vehicle once they all read
 * GO. After that the sequence runs itself and the milestones fall out of the
 * physics rather than being scheduled.
 */
import { DT_MS, type Command, type Simulation } from './engine.js';
import {
  type FlightConfig,
  type FlightState,
  canCoastNow,
  createFlightSimulation,
  createFlightState,
  missionTime_s,
  positionOf,
  velocityOf,
} from './flight.js';
import { altitudeOf, environmentAt } from './physics/ascent.js';
import { EARTH_RADIUS_M, MU_EARTH } from './physics/constants.js';
import { apoapsisRadius_m, isElliptical, periapsisRadius_m, stateToElements } from './physics/kepler.js';

const DT_S = DT_MS / 1000;

export const COUNTDOWN_PHASES = [
  'HOLD',
  'ARMED',
  'IGNITION',
  'LIFTOFF',
  'MAX_Q',
  'MECO',
  'SEP',
  'ORBIT_CHECK',
] as const;

export type CountdownPhase = (typeof COUNTDOWN_PHASES)[number];

/** Altitude at which the vehicle has visibly left the pad. */
const LIFTOFF_ALTITUDE_M = 0.5;

/** Below this, dynamic pressure is too small for a peak to mean anything. */
const MAX_Q_FLOOR_PA = 1000;

export interface MissionEvent {
  readonly tick: number;
  readonly missionTime_s: number;
  readonly type: string;
  readonly message: string;
}

export interface MissionState {
  readonly flight: FlightState;
  phase: CountdownPhase;
  /** One flag per checklist item, in the order the data file lists them. */
  checklist: boolean[];
  /**
   * Tick the engines light at, or -1 while not counting. Stored as an absolute
   * tick rather than a remaining count: a counter decremented inside the same
   * tick that starts it is off by one, and this cannot be.
   */
  ignitionTick: number;
  events: MissionEvent[];
  /** Dynamic pressure at the previous tick, for detecting the max-Q peak. */
  previousDynamicPressure_Pa: number;
}

export interface ChecklistItem {
  readonly id: string;
  readonly label: string;
  readonly hotkey: string;
}

export interface ChecklistDef {
  readonly items: readonly ChecklistItem[];
  readonly countdownSeconds: number;
}

export interface MissionConfigInput extends FlightConfig {
  readonly checklist: ChecklistDef;
}

export function createMissionState(checklist: ChecklistDef): MissionState {
  return {
    flight: createFlightState(),
    phase: 'HOLD',
    checklist: checklist.items.map(() => false),
    ignitionTick: -1,
    events: [],
    previousDynamicPressure_Pa: 0,
  };
}

export function allChecklistItemsGo(state: MissionState): boolean {
  return state.checklist.every((item) => item);
}

/**
 * The number on the countdown clock: negative while counting down, positive
 * once the vehicle has lifted off, zero while holding.
 */
export function countdownDisplay_s(state: MissionState): number {
  if (state.flight.liftoffTick >= 0) return missionTime_s(state.flight);
  if (state.ignitionTick >= 0) return (state.flight.tick - state.ignitionTick) * DT_S;
  return 0;
}

export function phaseIndex(phase: CountdownPhase): number {
  return COUNTDOWN_PHASES.indexOf(phase);
}

export function createMissionSimulation(config: MissionConfigInput): Simulation<MissionState> {
  const flightSimulation = createFlightSimulation(config);
  const countdownTicks = Math.round(config.checklist.countdownSeconds / DT_S);
  const target = config.rocket.targetOrbit;

  function record(state: MissionState, tick: number, type: string, message: string): void {
    state.events.push({
      tick,
      missionTime_s: missionTime_s(state.flight),
      type,
      message,
    });
  }

  function enter(state: MissionState, tick: number, phase: CountdownPhase, message: string): void {
    state.phase = phase;
    record(state, tick, phase, message);
  }

  function orbitVerdict(state: MissionState): string {
    const elements = stateToElements(
      positionOf(state.flight),
      velocityOf(state.flight),
      MU_EARTH,
    );
    if (!isElliptical(elements)) {
      return 'ORBIT CHECK — NEGATIVE: trajectory is not closed';
    }
    const periapsis_km = Math.round((periapsisRadius_m(elements) - EARTH_RADIUS_M) / 1000);
    const apoapsis_km = Math.round((apoapsisRadius_m(elements) - EARTH_RADIUS_M) / 1000);
    const targetPeriapsis_km = Math.round(target.periapsisAltitude_m / 1000);
    const verdict = periapsis_km >= targetPeriapsis_km ? 'NOMINAL' : 'LOW';
    return `ORBIT CHECK — ${verdict}: ${periapsis_km} × ${apoapsis_km} km`;
  }

  /**
   * Advances the phase at most one step per tick. Each condition reads the
   * flight state the tick just produced, so a milestone lands on the tick it
   * physically happened rather than on the tick something noticed.
   */
  function advancePhase(state: MissionState, tick: number, dynamicPressure_Pa: number): void {
    const flight = state.flight;

    switch (state.phase) {
      case 'ARMED':
        if (state.ignitionTick >= 0 && tick >= state.ignitionTick) {
          enter(state, tick, 'IGNITION', 'IGNITION — engines running');
        }
        return;

      case 'IGNITION':
        if (altitudeOf(positionOf(flight)) >= LIFTOFF_ALTITUDE_M) {
          enter(state, tick, 'LIFTOFF', 'LIFTOFF — the vehicle has cleared the pad');
        }
        return;

      case 'LIFTOFF': {
        // The peak is recognised one tick after it happens — the first tick on
        // which the pressure is falling again.
        const past =
          flight.maxDynamicPressure_Pa > MAX_Q_FLOOR_PA &&
          dynamicPressure_Pa < state.previousDynamicPressure_Pa;
        if (past) {
          enter(
            state,
            tick,
            'MAX_Q',
            `MAX Q — ${Math.round(flight.maxDynamicPressure_Pa / 1000)} kPa, through the worst of it`,
          );
        }
        return;
      }

      case 'MAX_Q':
        if (flight.mecoTick >= 0) {
          enter(state, tick, 'MECO', 'MECO — main engine cutoff');
        }
        return;

      case 'MECO':
        if (flight.separated) {
          enter(state, tick, 'SEP', 'SEP — first stage away, second stage running');
        }
        return;

      case 'SEP':
        if (flight.cutoff && canCoastNow(flight)) {
          enter(state, tick, 'ORBIT_CHECK', orbitVerdict(state));
        }
        return;

      default:
        return;
    }
  }

  function step(state: MissionState, tick: number): void {
    // The terminal count reaching zero lights the engines. It goes through the
    // same apply path a player-issued command would.
    if (state.phase === 'ARMED' && state.ignitionTick >= 0 && tick >= state.ignitionTick) {
      flightSimulation.apply(state.flight, { tick, type: 'ignite', payload: null }, tick);
    }

    flightSimulation.step(state.flight, tick);

    const dynamicPressure_Pa =
      state.flight.liftoffTick >= 0
        ? environmentAt(positionOf(state.flight), velocityOf(state.flight)).dynamicPressure_Pa
        : 0;

    advancePhase(state, tick, dynamicPressure_Pa);
    state.previousDynamicPressure_Pa = dynamicPressure_Pa;
  }

  function apply(state: MissionState, command: Command, tick: number): void {
    switch (command.type) {
      case 'toggleChecklist': {
        // Switches are frozen once the count starts: no changing your mind at T-2.
        if (state.phase !== 'HOLD') return;
        const index = (command.payload as { index: number }).index;
        if (index < 0 || index >= state.checklist.length) return;
        state.checklist[index] = !state.checklist[index];
        record(
          state,
          tick,
          'CHECKLIST',
          `${config.checklist.items[index].label} — ${state.checklist[index] ? 'GO' : 'NO GO'}`,
        );
        return;
      }

      case 'arm': {
        if (state.phase !== 'HOLD' || !allChecklistItemsGo(state)) return;
        state.ignitionTick = tick + countdownTicks;
        enter(
          state,
          tick,
          'ARMED',
          `ARMED — terminal count at T-${config.checklist.countdownSeconds}`,
        );
        return;
      }

      default:
        flightSimulation.apply(state.flight, command, tick);
    }
  }

  return {
    step,
    apply,
    canCoast: (state) => flightSimulation.canCoast(state.flight),
    coastTo: (state, tick) => {
      flightSimulation.coastTo(state.flight, tick);
      // Coasting means vacuum, so dynamic pressure is zero by definition.
      advancePhase(state, tick, 0);
    },
  };
}
