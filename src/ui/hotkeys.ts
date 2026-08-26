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
export function resolveHotkey(key: string): HotkeyAction | null {
  if (key >= '1' && key <= '5') {
    const index = Number(key) - 1;
    return { kind: 'switchConsole', slot: CONSOLE_SLOTS[index], index };
  }

  const lower = key.toLowerCase();
  const panelIndex = PANEL_ACTION_KEYS.indexOf(lower as (typeof PANEL_ACTION_KEYS)[number]);
  if (panelIndex >= 0) return { kind: 'panelAction', index: panelIndex };

  switch (lower) {
    case ' ':
    case 'spacebar':
      return { kind: 'togglePause' };
    case 'd':
      return { kind: 'focusDiagnosis' };
    case 'l':
      return { kind: 'focusEventLog' };
    case 'p':
      return { kind: 'togglePlanner' };
    case 'enter':
      return { kind: 'confirm' };
    case '+':
    case '=':
      return { kind: 'warpUp' };
    case '-':
      return { kind: 'warpDown' };
    default:
      return null;
  }
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
