import { describe, expect, it } from 'vitest';

import { formatAltitude, formatG, formatMissionClock, formatSpeed } from './format.js';
import { CONSOLE_SLOTS, consoleHotkey, panelActionHotkey, resolveHotkey } from './hotkeys.js';

describe('mission clock', () => {
  it('counts down with a minus and up with a plus', () => {
    expect(formatMissionClock(-10)).toBe('T-00:10.0');
    expect(formatMissionClock(0)).toBe('T+00:00.0');
    expect(formatMissionClock(9.85)).toBe('T+00:09.8');
  });

  it('rolls over into minutes', () => {
    expect(formatMissionClock(146.45)).toBe('T+02:26.4');
    expect(formatMissionClock(-63.2)).toBe('T-01:03.2');
  });

  it('keeps a fixed width so the digits do not jump', () => {
    const widths = new Set(
      [-600, -61, -9.9, 0, 9.9, 61, 600].map((value) => formatMissionClock(value).length),
    );
    expect(widths.size).toBe(1);
  });
});

describe('telemetry readouts', () => {
  it('gives altitude a decimal only while it still matters', () => {
    expect(formatAltitude(1500)).toBe('1.5');
    expect(formatAltitude(204000)).toBe('204');
  });

  it('groups speed so four digits stay readable', () => {
    expect(formatSpeed(7834.79)).toBe('7,835');
    expect(formatSpeed(0)).toBe('0');
  });

  it('shows G to two decimals', () => {
    expect(formatG(5.164)).toBe('5.16');
  });
});

describe('hotkeys', () => {
  it('gives 1-5 to the consoles, as §7.7 requires from Phase 1', () => {
    expect(resolveHotkey('1')).toEqual({ kind: 'switchConsole', slot: 'launch', index: 0 });
    expect(resolveHotkey('4')).toEqual({ kind: 'switchConsole', slot: 'engineering', index: 3 });
    expect(resolveHotkey('5')).toEqual({ kind: 'switchConsole', slot: 'eventLog', index: 4 });
  });

  it('gives Q W E to the focused panel, with R and T following', () => {
    expect(resolveHotkey('q')).toEqual({ kind: 'panelAction', index: 0 });
    expect(resolveHotkey('w')).toEqual({ kind: 'panelAction', index: 1 });
    expect(resolveHotkey('e')).toEqual({ kind: 'panelAction', index: 2 });
    expect(resolveHotkey('t')).toEqual({ kind: 'panelAction', index: 4 });
  });

  it('does not care about shift', () => {
    expect(resolveHotkey('Q')).toEqual(resolveHotkey('q'));
    expect(resolveHotkey('D')).toEqual(resolveHotkey('d'));
  });

  it('keeps Space, Enter and the warp keys on their §7.7 meanings', () => {
    expect(resolveHotkey(' ')).toEqual({ kind: 'togglePause' });
    expect(resolveHotkey('Enter')).toEqual({ kind: 'confirm' });
    expect(resolveHotkey('+')).toEqual({ kind: 'warpUp' });
    expect(resolveHotkey('-')).toEqual({ kind: 'warpDown' });
  });

  it('binds the focus keys', () => {
    expect(resolveHotkey('d')).toEqual({ kind: 'focusDiagnosis' });
    expect(resolveHotkey('l')).toEqual({ kind: 'focusEventLog' });
  });

  it('leaves everything else unbound', () => {
    for (const key of ['a', '0', '6', 'Escape', 'Tab', 'F5', 'z']) {
      expect(resolveHotkey(key)).toBeNull();
    }
  });

  it('prints a hint for every binding, so none of them is a secret', () => {
    expect(panelActionHotkey(0)).toBe('Q');
    expect(panelActionHotkey(4)).toBe('T');
    expect(panelActionHotkey(9)).toBe('');
    expect(consoleHotkey(0)).toBe('1');
    expect(consoleHotkey(3)).toBe('4');
    expect(consoleHotkey(9)).toBe('');
  });

  it('resolves every console slot §7 numbers, whether or not it exists yet', () => {
    // The table does not need to know which phase the game is in; the caller
    // decides what is available.
    expect(CONSOLE_SLOTS).toHaveLength(5);
    for (let index = 0; index < CONSOLE_SLOTS.length; index++) {
      expect(resolveHotkey(`${index + 1}`)).toEqual({
        kind: 'switchConsole',
        slot: CONSOLE_SLOTS[index],
        index,
      });
    }
  });
});

