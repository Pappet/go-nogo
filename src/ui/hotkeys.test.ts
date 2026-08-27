/**
 * The hotkey scheme and its rebinding (§7.7).
 *
 * §7.7 says "rebinding from Phase 2", and the interesting cases are the ones a
 * rebinding screen has to make impossible rather than merely discourage: two
 * actions on one key, and a player locking themselves out of a console.
 */
import { describe, expect, it } from 'vitest';

import {
  BINDABLE_ACTIONS,
  DEFAULT_BINDINGS,
  isReserved,
  keyLabel,
  normaliseKey,
  rebind,
  resolveHotkey,
} from './hotkeys.js';

describe('the default scheme is §7.7', () => {
  it('switches console on 1 to 5', () => {
    expect(resolveHotkey('1')).toEqual({ kind: 'switchConsole', slot: 'launch', index: 0 });
    expect(resolveHotkey('4')).toEqual({ kind: 'switchConsole', slot: 'engineering', index: 3 });
  });

  it('keeps the verbs where §7.7 put them', () => {
    expect(resolveHotkey(' ')?.kind).toBe('togglePause');
    expect(resolveHotkey('d')?.kind).toBe('focusDiagnosis');
    expect(resolveHotkey('l')?.kind).toBe('focusEventLog');
    expect(resolveHotkey('Enter')?.kind).toBe('confirm');
    expect(resolveHotkey('+')?.kind).toBe('warpUp');
    expect(resolveHotkey('-')?.kind).toBe('warpDown');
  });

  it('leaves Q W E R T to the focused panel', () => {
    expect(resolveHotkey('q')).toEqual({ kind: 'panelAction', index: 0 });
    expect(resolveHotkey('T')).toEqual({ kind: 'panelAction', index: 4 });
  });

  it('says nothing about a key nobody bound', () => {
    expect(resolveHotkey('z')).toBeNull();
  });
});

describe('rebinding', () => {
  it('moves an action to a new key and forgets the old one', () => {
    const bound = rebind(DEFAULT_BINDINGS, 'togglePause', 'z');
    expect(resolveHotkey('z', bound)?.kind).toBe('togglePause');
    expect(resolveHotkey(' ', bound)).toBeNull();
  });

  it('never leaves two actions on one key', () => {
    // The failure a rebinding screen has to make impossible: the previous
    // holder is unset and shows as unbound, which the player can see and fix.
    const clash = rebind(DEFAULT_BINDINGS, 'warpUp', 'd');
    expect(clash.focusDiagnosis).toBe('');
    expect(resolveHotkey('d', clash)?.kind).toBe('warpUp');

    const holders = BINDABLE_ACTIONS.filter((action) => clash[action] === 'd');
    expect(holders).toEqual(['warpUp']);
  });

  it('refuses the console numbers, so nobody can lock a console away', () => {
    // §7.7 fixes 1-5 to the numbered consoles, and the tab bar prints them. A
    // player who rebound 3 would have no way back to a console labelled 3.
    for (const key of ['1', '2', '3', '4', '5']) {
      expect(isReserved(key)).toBe(true);
      expect(rebind(DEFAULT_BINDINGS, 'togglePause', key)).toEqual(DEFAULT_BINDINGS);
    }
    expect(isReserved('6')).toBe(false);
  });

  it('lets a binding take a key the panel was using, and means it', () => {
    // A player who put pause on Q meant it. Silently keeping the panel meaning
    // would be the worse surprise.
    const bound = rebind(DEFAULT_BINDINGS, 'togglePause', 'q');
    expect(resolveHotkey('q', bound)?.kind).toBe('togglePause');
    expect(resolveHotkey('w', bound)).toEqual({ kind: 'panelAction', index: 1 });
  });

  it('normalises what the browser reports, so shift and old engines still work', () => {
    expect(normaliseKey('Spacebar')).toBe(' ');
    expect(normaliseKey('D')).toBe('d');
    expect(normaliseKey('=')).toBe('+');
    expect(resolveHotkey('Spacebar')?.kind).toBe('togglePause');
  });

  it('prints a key the way a player reads it', () => {
    expect(keyLabel(' ')).toBe('Space');
    expect(keyLabel('enter')).toBe('Enter');
    expect(keyLabel('d')).toBe('D');
  });

  it('ignores an action that was left unbound', () => {
    const orphaned = { ...DEFAULT_BINDINGS, togglePause: '' };
    expect(resolveHotkey('', orphaned)).toBeNull();
  });
});
