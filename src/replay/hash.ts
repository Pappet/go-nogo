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
  writer.boolean(state.separated);
  writer.boolean(state.cutoff);
  writer.float64(state.maxDynamicPressure_Pa, 'maxDynamicPressure_Pa');
  writer.float64(state.maxSensedG, 'maxSensedG');
}

/** SHA-256 over the canonical encoding of a flight state. */
export function hashFlightState(state: FlightState): string {
  const writer = new CanonicalWriter();
  encodeFlightState(state, writer);
  return sha256(writer.toBytes());
}
