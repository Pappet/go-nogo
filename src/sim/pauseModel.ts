/**
 * The pause model (concept §5.7).
 *
 * The rule that resolves the pause paradox: **pause stops the simulation, not
 * the cost.** While paused the player can read, compare candidates and queue
 * as many actions as they like — but every one of them costs sim seconds when
 * the clock starts again, and the escalation window is the same length either
 * way. Pausing buys an overview and not a single sim second, so it is never an
 * exploit and never needs to be rationed.
 *
 * Standard mode therefore has no queuing limit. The one-action variant exists
 * only as the A/B arm the Phase 1 replay test measures against (§9), and it is
 * a setting rather than a fork in the code so that both arms run the same
 * simulation.
 *
 * Everything here is a decision at a tick. Auto-pause is simulation state
 * (§8.2 rule 6), not something the console does on a timer.
 */

export type PauseModelKind = 'standard' | 'oneActionPerPause';

/** Why the simulation is asking to stop. */
export type PauseReason = 'newAnomaly' | 'manual';

export interface ResultReadyOffer {
  readonly anomalyId: string;
  readonly measureId: string;
  readonly tick: number;
}

export interface PauseState {
  readonly model: PauseModelKind;
  paused: boolean;
  /** Anomalies that have already spent their one automatic pause. */
  autoPausedFor: string[];
  /**
   * A standing offer to pause because a result landed. Soft by design: the
   * player may take it or read on. Forcing a stop here would interrupt someone
   * who is mid-plan and already knows what the result means.
   */
  offer: ResultReadyOffer | null;
  /** Actions queued since the current pause began — only the A/B arm cares. */
  actionsThisPause: number;
}

export function createPauseState(model: PauseModelKind = 'standard'): PauseState {
  return { model, paused: false, autoPausedFor: [], offer: null, actionsThisPause: 0 };
}

/**
 * Should the simulation stop because this anomaly just appeared?
 *
 * Once per anomaly, never again — a cascade that re-announces itself would
 * turn the auto-pause into a nuisance the player learns to dismiss blind.
 */
export function shouldAutoPause(state: PauseState, anomalyId: string): boolean {
  if (state.autoPausedFor.includes(anomalyId)) return false;
  state.autoPausedFor.push(anomalyId);
  return true;
}

/** Records that a diagnosis result landed, as an offer rather than a stop. */
export function offerResultReady(
  state: PauseState,
  anomalyId: string,
  measureId: string,
  tick: number,
): void {
  state.offer = { anomalyId, measureId, tick };
}

export function dismissOffer(state: PauseState): void {
  state.offer = null;
}

export function pause(state: PauseState): void {
  if (state.paused) return;
  state.paused = true;
  state.actionsThisPause = 0;
}

export function resume(state: PauseState): void {
  state.paused = false;
  state.actionsThisPause = 0;
  state.offer = null;
}

/**
 * May the player queue another action right now?
 *
 * Standard says yes, always: the escalation window already limits how much is
 * worth queuing. The A/B arm allows one action per pause, and only while
 * paused — queuing under a running clock is its own kind of pressure and needs
 * no extra rule.
 */
export function canQueueAction(state: PauseState): boolean {
  if (state.model === 'standard') return true;
  if (!state.paused) return true;
  return state.actionsThisPause === 0;
}

export function recordQueuedAction(state: PauseState): void {
  if (state.paused) state.actionsThisPause += 1;
}

/** Index of the model, for the canonical state encoding. */
export const PAUSE_MODELS: readonly PauseModelKind[] = ['standard', 'oneActionPerPause'];

export function pauseModelIndex(model: PauseModelKind): number {
  return PAUSE_MODELS.indexOf(model);
}
