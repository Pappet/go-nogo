/**
 * The central hotkey scheme (concept §7.7).
 *
 * Phase 0 has a single console, so `1`–`5` throw the five checklist switches
 * rather than switching consoles — there is nothing to switch to yet. `Space`
 * and `Enter` keep their §7.7 meanings.
 *
 * Resolution is a pure function of the key, which keeps the binding testable
 * and keeps the console free of a keyboard switch statement.
 */

export type HotkeyAction =
  | { kind: 'toggleChecklist'; index: number }
  | { kind: 'arm' }
  | { kind: 'togglePause' }
  | { kind: 'warpUp' }
  | { kind: 'warpDown' };

/** Maps a KeyboardEvent key to an action, or null when the key is unbound. */
export function resolveHotkey(key: string): HotkeyAction | null {
  if (key >= '1' && key <= '5') {
    return { kind: 'toggleChecklist', index: Number(key) - 1 };
  }
  switch (key) {
    case ' ':
    case 'Spacebar':
      return { kind: 'togglePause' };
    case 'Enter':
      return { kind: 'arm' };
    case '+':
    case '=':
      return { kind: 'warpUp' };
    case '-':
      return { kind: 'warpDown' };
    default:
      return null;
  }
}

/** The key hint shown on a control, so the binding is never a secret. */
export function checklistHotkey(index: number): string {
  return `${index + 1}`;
}
