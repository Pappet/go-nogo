/**
 * The tech tree (concept §6.4).
 *
 * Levels 1 and 2 are linear; level 3 is one exclusive choice per branch, taken
 * once per campaign and never taken back. §6.4 is explicit that the forks are
 * "different risk profiles instead of better/worse", which is a constraint on
 * the data rather than on this module: every fork here moves risk somewhere
 * else rather than removing it, and there is a test that says so.
 *
 * Effects compose additively for band shifts and multiplicatively for
 * multipliers, so a branch's levels and its fork stack without either one
 * having to know about the other.
 */
import type { QaLevel } from '../sim/parts/partInstance.js';

export interface TechEffects {
  /** Added to a part's reliability band ends, by system. Can be negative. */
  readonly reliabilityShift?: Readonly<Record<string, readonly [number, number]>>;
  readonly costBySystem?: Readonly<Record<string, number>>;
  /** Multiplies the risk budget's phase exposure, by system (§5.4). */
  readonly exposureBySystem?: Readonly<Record<string, number>>;
  readonly ispMultiplier?: number;
  /** QA levels this makes available even where the doctrine locked them. */
  readonly unlocksQa?: readonly QaLevel[];
}

export interface TechLevel {
  readonly level: number;
  readonly title: string;
  readonly cost: number;
  readonly summary: string;
  readonly effects: TechEffects;
}

export interface ForkOption {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** What this option asks the player to accept, in one sentence. */
  readonly risk: string;
  readonly effects: TechEffects;
}

export interface TechBranch {
  readonly id: string;
  readonly title: string;
  readonly levels: readonly TechLevel[];
  readonly fork: {
    readonly level: number;
    readonly cost: number;
    readonly options: readonly ForkOption[];
  };
}

export interface TechTreeData {
  readonly branches: readonly TechBranch[];
}

/** What a campaign has researched. Levels reached, and forks taken. */
export interface TechState {
  /** Branch id → highest linear level reached. */
  levels: Record<string, number>;
  /** Branch id → the fork option taken, once and for good. */
  forks: Record<string, string>;
  /** Unspent research data (§6.3). */
  data: number;
}

export function createTechState(): TechState {
  return { levels: {}, forks: {}, data: 0 };
}

export function levelOf(tech: TechState, branchId: string): number {
  return tech.levels[branchId] ?? 0;
}

/** The next thing this branch can buy, or null when it is finished. */
export function nextStep(
  branch: TechBranch,
  tech: TechState,
): { readonly kind: 'level'; readonly level: TechLevel } | { readonly kind: 'fork' } | null {
  const reached = levelOf(tech, branch.id);
  const next = branch.levels.find((entry) => entry.level === reached + 1);
  if (next !== undefined) return { kind: 'level', level: next };
  if (tech.forks[branch.id] === undefined) return { kind: 'fork' };
  return null;
}

export function canAfford(cost: number, tech: TechState): boolean {
  return tech.data >= cost;
}

/** Buys the next linear level. Refuses to skip one, or to buy it twice. */
export function researchLevel(branch: TechBranch, tech: TechState): boolean {
  const step = nextStep(branch, tech);
  if (step === null || step.kind !== 'level' || !canAfford(step.level.cost, tech)) return false;
  tech.data -= step.level.cost;
  tech.levels[branch.id] = step.level.level;
  return true;
}

/**
 * Takes a fork.
 *
 * Refuses once one is taken: §6.6 says a fork already taken is never changed
 * retroactively, and the same holds for the player changing their own mind —
 * an exclusive choice that can be undone is not exclusive.
 */
export function takeFork(branch: TechBranch, tech: TechState, optionId: string): boolean {
  if (tech.forks[branch.id] !== undefined) return false;
  if (nextStep(branch, tech)?.kind !== 'fork') return false;
  const option = branch.fork.options.find((entry) => entry.id === optionId);
  if (option === undefined || !canAfford(branch.fork.cost, tech)) return false;
  tech.data -= branch.fork.cost;
  tech.forks[branch.id] = optionId;
  return true;
}

/** Every effect a campaign has bought, in the order it bought them. */
export function activeEffects(data: TechTreeData, tech: TechState): TechEffects[] {
  const effects: TechEffects[] = [];
  for (const branch of data.branches) {
    for (const level of branch.levels) {
      if (level.level <= levelOf(tech, branch.id)) effects.push(level.effects);
    }
    const forkId = tech.forks[branch.id];
    const option = branch.fork.options.find((entry) => entry.id === forkId);
    if (option !== undefined) effects.push(option.effects);
  }
  return effects;
}

/** One effect, folded from many. Band shifts add; multipliers multiply. */
export function combineEffects(effects: readonly TechEffects[]): Required<TechEffects> {
  const reliabilityShift: Record<string, [number, number]> = {};
  const costBySystem: Record<string, number> = {};
  const exposureBySystem: Record<string, number> = {};
  let ispMultiplier = 1;
  const unlocksQa = new Set<QaLevel>();

  for (const effect of effects) {
    for (const [system, shift] of Object.entries(effect.reliabilityShift ?? {})) {
      const current = reliabilityShift[system] ?? [0, 0];
      reliabilityShift[system] = [current[0] + shift[0], current[1] + shift[1]];
    }
    for (const [system, factor] of Object.entries(effect.costBySystem ?? {})) {
      costBySystem[system] = (costBySystem[system] ?? 1) * factor;
    }
    for (const [system, factor] of Object.entries(effect.exposureBySystem ?? {})) {
      exposureBySystem[system] = (exposureBySystem[system] ?? 1) * factor;
    }
    ispMultiplier *= effect.ispMultiplier ?? 1;
    for (const level of effect.unlocksQa ?? []) unlocksQa.add(level);
  }

  return {
    reliabilityShift,
    costBySystem,
    exposureBySystem,
    ispMultiplier,
    unlocksQa: [...unlocksQa],
  };
}

/** A part's band after research, clamped so it stays a probability. */
export function shiftedBand(
  band: readonly [number, number],
  system: string,
  effects: Required<TechEffects>,
): readonly [number, number] {
  const shift = effects.reliabilityShift[system] ?? [0, 0];
  const low = Math.max(0.01, Math.min(0.99, band[0] + shift[0]));
  const high = Math.max(low + 0.01, Math.min(0.999, band[1] + shift[1]));
  return [low, high];
}
