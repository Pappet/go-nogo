/**
 * Canonical binary encoding and state hashing (concept §8.2 rule 8).
 *
 * The hash never runs over `JSON.stringify`. Float formatting differs between
 * engines, which is the same bug class as `Math.sin`: it passes locally and
 * breaks on the first cross-browser daily. Instead every value is written in a
 * fixed schema order as raw little-endian bytes and those bytes are hashed.
 *
 * Two values are refused outright: NaN and Infinity. Either one in the state
 * means the simulation has already gone wrong, and hashing it would preserve
 * the wreckage instead of reporting it.
 */
import { type MissionState, phaseIndex } from '../sim/countdown.js';
import type { DiagnosisState } from '../sim/diagnosis/diagnosis.js';
import { pauseModelIndex } from '../sim/pauseModel.js';
import type { FlightState } from '../sim/flight.js';

import { sha256 } from './sha256.js';

export class CanonicalWriter {
  private bytes: number[] = [];
  private readonly scratch = new DataView(new ArrayBuffer(8));

  float64(value: number, field: string): void {
    if (Number.isNaN(value)) {
      throw new Error(`Canonical encoding refused NaN in field '${field}'`);
    }
    if (!Number.isFinite(value)) {
      throw new Error(`Canonical encoding refused ${value} in field '${field}'`);
    }
    // -0 and +0 are the same number but different bytes. Normalising here means
    // an incidental sign on a zero can never move a replay hash.
    this.scratch.setFloat64(0, value === 0 ? 0 : value, true);
    this.pushScratch(8);
  }

  int32(value: number, field: string): void {
    if (!Number.isInteger(value)) {
      throw new Error(`Canonical encoding refused a non-integer in field '${field}': ${value}`);
    }
    this.scratch.setInt32(0, value, true);
    this.pushScratch(4);
  }

  boolean(value: boolean): void {
    this.bytes.push(value ? 1 : 0);
  }

  string(value: string): void {
    const encoded = new TextEncoder().encode(value);
    this.scratch.setUint32(0, encoded.length, true);
    this.pushScratch(4);
    for (const byte of encoded) this.bytes.push(byte);
  }

  private pushScratch(length: number): void {
    for (let i = 0; i < length; i++) {
      this.bytes.push(this.scratch.getUint8(i));
    }
  }

  toBytes(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/**
 * Writes the flight state in a fixed order.
 *
 * The order is the schema. Adding, removing or reordering a field changes
 * every hash from that point on — a deliberate breaking change that has to be
 * justified when the reference fixtures are regenerated.
 */
export function encodeFlightState(state: FlightState, writer: CanonicalWriter): void {
  writer.int32(state.tick, 'tick');
  writer.int32(state.liftoffTick, 'liftoffTick');
  writer.float64(state.positionX, 'positionX');
  writer.float64(state.positionY, 'positionY');
  writer.float64(state.velocityX, 'velocityX');
  writer.float64(state.velocityY, 'velocityY');
  writer.int32(state.stageIndex, 'stageIndex');
  writer.float64(state.propellantRemaining_kg, 'propellantRemaining_kg');
  writer.boolean(state.ignited);
  writer.int32(state.mecoTick, 'mecoTick');
  writer.boolean(state.separated);
  writer.boolean(state.cutoff);
  writer.float64(state.maxDynamicPressure_Pa, 'maxDynamicPressure_Pa');
  writer.float64(state.maxSensedG, 'maxSensedG');
}

/**
 * Writes the mission state: the countdown machine, then the flight beneath it.
 *
 * Event *messages* are deliberately not hashed — they are presentation, and a
 * reworded log line must not invalidate every stored replay. The number of
 * events is hashed, so an event appearing or going missing still shows up.
 */
export function encodeMissionState(state: MissionState, writer: CanonicalWriter): void {
  writer.int32(phaseIndex(state.phase), 'phase');
  writer.int32(state.checklist.length, 'checklist.length');
  for (const item of state.checklist) writer.boolean(item);
  writer.int32(state.ignitionTick, 'ignitionTick');
  writer.int32(state.events.length, 'events.length');
  writer.float64(state.previousDynamicPressure_Pa, 'previousDynamicPressure_Pa');
  writer.boolean(state.pauseRequested);
  encodeDiagnosisState(state.diagnosis, writer);
  encodeFlightState(state.flight, writer);
}

/**
 * Writes the diagnosis runtime.
 *
 * Anomalies are written in full rather than counted: a desync that moved one
 * anomaly's onset by a tick, or resolved the wrong one, has to be caught. The
 * schedule and results are counted with their identifying fields for the same
 * reason — a queue that drifted apart between two runs is exactly the failure
 * the 600-tick sampling exists to localise.
 */
export function encodeDiagnosisState(state: DiagnosisState, writer: CanonicalWriter): void {
  writer.int32(pauseModelIndex(state.pause.model), 'pause.model');
  writer.boolean(state.pause.paused);
  writer.int32(state.pause.actionsThisPause, 'pause.actionsThisPause');
  writer.int32(state.pause.autoPausedFor.length, 'pause.autoPausedFor.length');
  writer.boolean(state.pause.offer !== null);

  writer.int32(state.missionTags.length, 'missionTags.length');
  for (const tag of state.missionTags) writer.string(tag);

  writer.int32(state.anomalies.anomalies.length, 'anomalies.length');
  for (const anomaly of state.anomalies.anomalies) {
    writer.string(anomaly.id);
    writer.string(anomaly.causeId);
    writer.int32(anomaly.onsetTick, 'anomaly.onsetTick');
    writer.int32(anomaly.escalationTick, 'anomaly.escalationTick');
    writer.int32(anomaly.resolvedTick, 'anomaly.resolvedTick');
    writer.int32(anomaly.escalatedTick, 'anomaly.escalatedTick');
    writer.int32(anomaly.applied.length, 'anomaly.applied.length');
    for (const applied of anomaly.applied) {
      writer.string(applied.measureId);
      writer.int32(applied.tick, 'applied.tick');
      writer.boolean(applied.correct);
    }
  }
  writer.int32(state.anomalies.nextChainSerial, 'anomalies.nextChainSerial');

  writer.int32(state.schedule.running.length, 'schedule.running.length');
  for (const running of state.schedule.running) {
    writer.string(running.measureId);
    writer.string(running.targetId);
    writer.int32(running.startTick, 'running.startTick');
    writer.int32(running.endTick, 'running.endTick');
  }
  writer.int32(state.schedule.pending.length, 'schedule.pending.length');
  for (const pending of state.schedule.pending) {
    writer.string(pending.measureId);
    writer.string(pending.targetId);
    writer.int32(pending.queuedTick, 'pending.queuedTick');
  }
  writer.int32(state.schedule.completed.length, 'schedule.completed.length');

  writer.int32(state.results.length, 'results.length');
  for (const result of state.results) {
    writer.string(result.measureId);
    writer.int32(result.tick, 'result.tick');
    writer.boolean(result.confirmed !== null);
    writer.int32(result.excluded.length, 'result.excluded.length');
  }
}

/** SHA-256 over the canonical encoding of a flight state. */
export function hashFlightState(state: FlightState): string {
  const writer = new CanonicalWriter();
  encodeFlightState(state, writer);
  return sha256(writer.toBytes());
}

/** SHA-256 over the canonical encoding of a whole mission state. */
export function hashMissionState(state: MissionState): string {
  const writer = new CanonicalWriter();
  encodeMissionState(state, writer);
  return sha256(writer.toBytes());
}
