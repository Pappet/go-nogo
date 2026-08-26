/**
 * A vehicle as a set of slots (concept §4, §4.2).
 *
 * A slot is a job the vehicle needs done — hold the propellant line, run the
 * power bus — and it is filled by one or more units of a part. More than one
 * is redundancy: the slot survives as long as any unit does, and every extra
 * unit costs its mass, which the ascent then has to lift (§4.2).
 *
 * This is the object the configurator edits and the risk budget prices. It is
 * deliberately not simulation state: the vehicle is decided before the clock
 * starts, and from there the mission only reads it.
 */
import {
  type PartInstance,
  type QaLevel,
  type QaLevelTable,
  buildPart,
} from '../sim/parts/partInstance.js';
import { partDef } from '../missionConfig.js';

/** What the player chose for one slot. The configurator's unit of editing. */
export interface SlotChoice {
  readonly slotId: string;
  readonly partId: string;
  readonly qaLevel: QaLevel;
  /** How many units fill the slot. 1 is no redundancy (§4.2). */
  readonly units: number;
}

export interface VehicleConfig {
  readonly slots: readonly SlotChoice[];
}

export interface BuiltSlot {
  readonly slotId: string;
  readonly partId: string;
  readonly title: string;
  readonly system: string;
  readonly units: readonly PartInstance[];
  readonly mass_kg: number;
  readonly cost: number;
}

export interface BuiltVehicle {
  readonly slots: readonly BuiltSlot[];
  readonly mass_kg: number;
  /**
   * What redundancy costs the vehicle (§4.2).
   *
   * The baseline hull already carries one of everything — that mass is in the
   * stage's dry mass and must not be counted twice. What a configuration adds
   * is the second and third unit, and that is the number the ascent has to
   * lift and the Δv has to pay for.
   */
  readonly redundancyMass_kg: number;
  readonly cost: number;
}

/**
 * Instantiates a configuration.
 *
 * Each unit in a slot gets its own serial line, so a redundant pair is two
 * genuinely different parts rather than the same draw twice — which is the
 * entire point of redundancy and would be silently broken by keying both on
 * the slot alone.
 */
export function buildVehicle(
  config: VehicleConfig,
  qaTable: QaLevelTable,
  seed: number,
): BuiltVehicle {
  const slots = config.slots.map((choice) => {
    const def = partDef(choice.partId);
    const units: PartInstance[] = [];
    for (let index = 0; index < Math.max(1, choice.units); index += 1) {
      units.push(buildPart(def, `${choice.slotId}/u${index}`, choice.qaLevel, qaTable, seed));
    }
    return {
      slotId: choice.slotId,
      partId: choice.partId,
      title: def.title,
      system: def.system,
      units,
      mass_kg: def.mass_kg * units.length,
      cost: Math.round(def.cost * qaTable[choice.qaLevel].costMultiplier * units.length),
    };
  });

  return {
    slots,
    mass_kg: slots.reduce((sum, slot) => sum + slot.mass_kg, 0),
    redundancyMass_kg: slots.reduce(
      (sum, slot) => sum + (slot.mass_kg / slot.units.length) * (slot.units.length - 1),
      0,
    ),
    cost: slots.reduce((sum, slot) => sum + slot.cost, 0),
  };
}

/** Longest build time on the critical path — QA costs days, not just money (§4.1). */
export function buildDays(config: VehicleConfig, qaTable: QaLevelTable): number {
  return config.slots.reduce(
    (longest, choice) => Math.max(longest, qaTable[choice.qaLevel].buildDays),
    0,
  );
}

/**
 * Which slots differ between two configurations.
 *
 * This is what makes §5.4's second retry path surgical: only the slots named
 * here get new units, and everything the player did not touch keeps the exact
 * parts it flew with. Comparing the choices rather than the built vehicle is
 * deliberate — two builds of the same choice are the same parts by
 * construction, and comparing instances would find spurious differences the
 * moment anything about instantiation changes.
 */
export function changedSlots(before: VehicleConfig, after: VehicleConfig): string[] {
  const previous = new Map(before.slots.map((slot) => [slot.slotId, slot]));
  const changed: string[] = [];

  for (const slot of after.slots) {
    const was = previous.get(slot.slotId);
    if (
      was === undefined ||
      was.partId !== slot.partId ||
      was.qaLevel !== slot.qaLevel ||
      was.units !== slot.units
    ) {
      changed.push(slot.slotId);
    }
  }
  // A slot that was removed changed too — the vehicle no longer carries it.
  for (const slot of before.slots) {
    if (!after.slots.some((entry) => entry.slotId === slot.slotId)) changed.push(slot.slotId);
  }
  return changed;
}
