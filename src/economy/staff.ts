/**
 * Engineers (concept §6.5).
 *
 * Minimally specified on purpose. §6.5 is explicit that this is "no
 * Sims-style management, just a diagnosis modifier with fixed costs" — no
 * skill trees, no morale, no name drama. The whole mechanic is: hiring in a
 * specialty makes asking that team faster, and makes their guesses sharper.
 *
 * That is the one place the economy reaches into a crisis. Everything else the
 * campaign buys changes the vehicle before launch; an engineer changes what
 * the player can do at T+94 seconds with the clock running, which is why it is
 * worth having at all.
 */
import { hashUnit } from '../sim/rng.js';

import type { CampaignState } from './campaign.js';

export type Specialty = 'prop' | 'avionics' | 'comms' | 'power';

export interface StaffData {
  readonly maxEngineers: number;
  readonly poolSize: number;
  readonly weeksPerPoolRefresh: number;
  readonly specialties: readonly Specialty[];
  readonly salaryBand: readonly [number, number];
  /** What an engineer does to their own team query's duration (§6.5). */
  readonly queryDurationFactor: number;
  /** How much sharper the candidate priors get in that specialty (§5.2). */
  readonly priorSharpening: number;
  readonly measuresBySpecialty: Readonly<Record<Specialty, readonly string[]>>;
  readonly names: readonly string[];
}

export interface Engineer {
  readonly id: string;
  readonly name: string;
  readonly specialty: Specialty;
  /** Fixed cost per week, for as long as they are employed. */
  readonly salary: number;
}

export interface StaffState {
  hired: Engineer[];
}

export function createStaffState(): StaffState {
  return { hired: [] };
}

/** Which refresh window a week falls in. The pool changes monthly (§6.5). */
export function poolGeneration(data: StaffData, week: number): number {
  return Math.floor((week - 1) / data.weeksPerPoolRefresh);
}

/**
 * Who is available to hire this month.
 *
 * Drawn from the campaign seed, so the same campaign offers the same people in
 * the same month however many times it is replayed — and two campaigns get
 * different ones.
 */
export function offerPool(
  data: StaffData,
  campaign: CampaignState,
  week: number,
): Engineer[] {
  const generation = poolGeneration(data, week);
  const pool: Engineer[] = [];

  for (let index = 0; index < data.poolSize; index += 1) {
    const key = `staff/${generation}/${index}`;
    const specialty =
      data.specialties[Math.floor(hashUnit(campaign.seed, key, 'specialty') * data.specialties.length) %
        data.specialties.length];
    const name = data.names[Math.floor(hashUnit(campaign.seed, key, 'name') * data.names.length) % data.names.length];
    const [low, high] = data.salaryBand;
    pool.push({
      id: key,
      name,
      specialty,
      salary: Math.round(low + hashUnit(campaign.seed, key, 'salary') * (high - low)),
    });
  }
  return pool;
}

export function canHire(data: StaffData, staff: StaffState): boolean {
  return staff.hired.length < data.maxEngineers;
}

export function hire(data: StaffData, staff: StaffState, engineer: Engineer): boolean {
  if (!canHire(data, staff)) return false;
  if (staff.hired.some((entry) => entry.id === engineer.id)) return false;
  staff.hired.push(engineer);
  return true;
}

export function dismiss(staff: StaffState, engineerId: string): void {
  staff.hired = staff.hired.filter((entry) => entry.id !== engineerId);
}

/** The wage bill, charged every week the campaign advances. */
export function weeklySalaries(staff: StaffState): number {
  return staff.hired.reduce((sum, engineer) => sum + engineer.salary, 0);
}

export function hasSpecialty(staff: StaffState, specialty: Specialty): boolean {
  return staff.hired.some((engineer) => engineer.specialty === specialty);
}

/**
 * What the hired staff do to measure durations (§6.5).
 *
 * Returned as a table rather than applied here: `src/sim` takes the numbers
 * and never learns that a payroll exists. Two engineers in one specialty do
 * not stack — §6.5 buys coverage, not a stacking discount, and letting it
 * stack would turn hiring into the only decision in the game.
 */
export function measureDurationOverrides(
  data: StaffData,
  staff: StaffState,
  baseDuration: (measureId: string) => number,
): Record<string, number> {
  const overrides: Record<string, number> = {};
  for (const specialty of data.specialties) {
    if (!hasSpecialty(staff, specialty)) continue;
    for (const measureId of data.measuresBySpecialty[specialty] ?? []) {
      overrides[measureId] = Math.max(1, Math.round(baseDuration(measureId) * data.queryDurationFactor));
    }
  }
  return overrides;
}
