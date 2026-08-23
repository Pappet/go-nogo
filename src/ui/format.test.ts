import { describe, expect, it } from 'vitest';

import { formatAltitude, formatG, formatMissionClock, formatSpeed } from './format.js';
import { resolveHotkey } from './hotkeys.js';

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
  it('maps 1-5 to the checklist switches', () => {
    expect(resolveHotkey('1')).toEqual({ kind: 'toggleChecklist', index: 0 });
    expect(resolveHotkey('5')).toEqual({ kind: 'toggleChecklist', index: 4 });
  });

  it('keeps Space on pause and Enter on arm, as §7.7 requires', () => {
    expect(resolveHotkey(' ')).toEqual({ kind: 'togglePause' });
    expect(resolveHotkey('Enter')).toEqual({ kind: 'arm' });
  });

  it('binds warp to plus and minus', () => {
    expect(resolveHotkey('+')).toEqual({ kind: 'warpUp' });
    expect(resolveHotkey('-')).toEqual({ kind: 'warpDown' });
  });

  it('leaves everything else unbound', () => {
    for (const key of ['a', '0', '6', 'Escape', 'Tab', 'F5']) {
      expect(resolveHotkey(key)).toBeNull();
    }
  });
});
