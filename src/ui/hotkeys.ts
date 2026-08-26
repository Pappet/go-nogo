/**
 * The central hotkey scheme (concept §7.7, mandatory from Phase 1).
 *
 * When a crisis lasts sixty sim seconds, the keyboard decides how the game
 * feels. §7.7 fixes the scheme:
 *
 *   1–5      switch console
 *   Space    pause / resume
 *   + / -    time warp
 *   Q W E    measures in the diagnosis panel, in a frozen order
 *   P        open / close the planner
 *   D        focus the diagnosis menu
 *   L        focus the event log
 *   Enter    GO in the poll / confirm measure
 *
 * One extension: `Q W E` is read as "the actions of the focused panel", and
 * two more slots (`R T`) follow it. §7.7 names the keys for the diagnosis
 * panel, which has three; the LAUNCH checklist has five switches and lost its
 * number keys to console switching. Giving it the same idiom keeps one mental
 * model instead of inventing a second scheme for the same gesture.
 *
 * `P` for the planner is an addition, not a change: §7.7 fixes the in-flight
 * keys and the planner is a pre-flight screen, so it needed one of its own
 * rather than a number that would have displaced a console.
 *
 * Resolution stays a pure function of the key, so the binding is testable and
 * the consoles keep no keyboard logic of their own.
 */

/**
 * Actions a key can be bound to (§7.7, rebinding from Phase 2).
 *
 * Console switching is deliberately not in here. §7.7 fixes `1`–`5` to the
 * numbered consoles, and a player who rebinds `3` to something else has no way
 * back to a console the tab bar labels `3`. The keys that *are* rebindable are
 * the verbs.
 */
export const BINDABLE_ACTIONS = [
  'togglePause',
  'warpUp',
  'warpDown',
  'focusDiagnosis',
  'focusEventLog',
  'togglePlanner',
  'confirm',
] as const;
export type BindableAction = (typeof BINDABLE_ACTIONS)[number];

export type Bindings = Readonly<Record<BindableAction, string>>;

/** The scheme §7.7 specifies. Rebinding starts from here and can return to it. */
export const DEFAULT_BINDINGS: Bindings = {
  togglePause: ' ',
  warpUp: '+',
  warpDown: '-',
  focusDiagnosis: 'd',
  focusEventLog: 'l',
  togglePlanner: 'p',
  confirm: 'enter',
};

/** Human-readable labels, so a rebinding screen is not a list of identifiers. */
export const ACTION_LABELS: Readonly<Record<BindableAction, string>> = {
  togglePause: 'Pause / resume',
  warpUp: 'Time warp up',
  warpDown: 'Time warp down',
  focusDiagnosis: 'Focus diagnosis',
  focusEventLog: 'Focus event log',
  togglePlanner: 'Open / close planner',
  confirm: 'GO in the poll / confirm measure',
};

/** How a key reads on a button. Space and Enter have no printable glyph. */
export function keyLabel(key: string): string {
  if (key === ' ') return 'Space';
  if (key === 'enter') return 'Enter';
  return key.length === 1 ? key.toUpperCase() : key;
}

/**
 * Normalises a KeyboardEvent key into the form bindings are stored in.
 *
 * Case is folded because a player holding shift is still pressing that key,
 * and `Spacebar` is normalised because older engines report it that way.
 */
export function normaliseKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === 'spacebar') return ' ';
  if (lower === '=') return '+';
  return lower;
}

/** Keys that cannot be taken: §7.7 fixes the console numbers. */
export function isReserved(key: string): boolean {
  return key >= '1' && key <= '5';
}

/**
 * Applies one rebinding, moving any action that already held the key.
 *
 * Two actions on one key is the failure mode a rebinding screen has to make
 * impossible rather than merely discourage — so the previous holder is unset
 * and the screen shows it as unbound, which the player can see and fix.
 */
export function rebind(
  bindings: Bindings,
  action: BindableAction,
  key: string,
): Bindings {
  const normalised = normaliseKey(key);
  if (isReserved(normalised)) return bindings;

  const next: Record<BindableAction, string> = { ...bindings };
  for (const other of BINDABLE_ACTIONS) {
    if (other !== action && next[other] === normalised) next[other] = '';
  }
  next[action] = normalised;
  return next;
}

/** Console slots in the order §7 numbers them. Not all exist yet. */
export const CONSOLE_SLOTS = ['launch', 'flight', 'comms', 'engineering', 'eventLog'] as const;
export type ConsoleSlot = (typeof CONSOLE_SLOTS)[number];

/** Keys for the focused panel's actions. §7.7 names the first three. */
export const PANEL_ACTION_KEYS = ['q', 'w', 'e', 'r', 't'] as const;

export type HotkeyAction =
  | { kind: 'switchConsole'; slot: ConsoleSlot; index: number }
  | { kind: 'panelAction'; index: number }
  | { kind: 'focusDiagnosis' }
  | { kind: 'togglePlanner' }
  | { kind: 'focusEventLog' }
  | { kind: 'confirm' }
  | { kind: 'togglePause' }
  | { kind: 'warpUp' }
  | { kind: 'warpDown' };

/**
 * Maps a KeyboardEvent key to an action, or null when the key is unbound.
 *
 * A slot with no console behind it still resolves: the caller decides what is
 * available, so this table does not have to know which phase the game is in.
 */
export function resolveHotkey(
  key: string,
  bindings: Bindings = DEFAULT_BINDINGS,
): HotkeyAction | null {
  if (key >= '1' && key <= '5') {
    const index = Number(key) - 1;
    return { kind: 'switchConsole', slot: CONSOLE_SLOTS[index], index };
  }

  const lower = normaliseKey(key);

  // Bindings win over the panel keys: a player who put pause on `Q` meant it,
  // and silently keeping the old meaning would be the worse surprise.
  for (const action of BINDABLE_ACTIONS) {
    if (bindings[action] !== '' && bindings[action] === lower) return { kind: action };
  }

  const panelIndex = PANEL_ACTION_KEYS.indexOf(lower as (typeof PANEL_ACTION_KEYS)[number]);
  if (panelIndex >= 0) return { kind: 'panelAction', index: panelIndex };

  return null;
}

/**
 * The key hint printed on a panel action, so the binding is never a secret
 * (§7.7: "key hints inline on every button").
 */
export function panelActionHotkey(index: number): string {
  const key = PANEL_ACTION_KEYS[index];
  return key === undefined ? '' : key.toUpperCase();
}

/** The key hint printed on a console tab. */
export function consoleHotkey(index: number): string {
  return index >= 0 && index < CONSOLE_SLOTS.length ? `${index + 1}` : '';
}
