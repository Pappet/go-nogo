/**
 * Ground stations and the downlink (§7 ③, §6.3).
 *
 * The point of the module is that visibility is not decoration: it comes out
 * of the same positions the ascent integrates. So the tests are geometry
 * first — a station under the vehicle sees it, one on the far side does not,
 * and the Earth turning changes who is looking.
 */
import { describe, expect, it } from 'vitest';

import { groundStations } from '../../missionConfig.js';
import { EARTH_RADIUS_M } from '../physics/constants.js';

import {
  bestLink,
  createCommsState,
  downlinkFraction,
  stationPosition,
  stepDownlink,
  viewAll,
  viewFrom,
} from './comms.js';

const data = groundStations;
const pad = data.stations[0];
/** Straight up from the launch meridian, 400 km high. */
const overhead = { x: EARTH_RADIUS_M + 400000, y: 0 };

describe('a station sees what the geometry says it sees', () => {
  it('sees a vehicle directly overhead, at the zenith', () => {
    const view = viewFrom(pad, data, overhead, 0);
    expect(view.visible).toBe(true);
    expect(view.elevation_deg).toBeCloseTo(90, 6);
    expect(view.range_m).toBeCloseTo(400000, 3);
  });

  it('cannot see one on the other side of the planet', () => {
    const view = viewFrom(pad, data, { x: -(EARTH_RADIUS_M + 400000), y: 0 }, 0);
    expect(view.visible).toBe(false);
    expect(view.signal).toBe(0);
    expect(view.elevation_deg).toBeLessThan(0);
  });

  it('puts a distant vehicle on the horizon near zero elevation, not over it', () => {
    // Tangent point: perpendicular to the station's radial, at orbit altitude.
    const view = viewFrom(pad, data, { x: EARTH_RADIUS_M, y: 400000 }, 0);
    expect(view.elevation_deg).toBeCloseTo(0, 6);
    expect(view.visible).toBe(false);
  });

  it('calls a vehicle standing on the station contact, not loss of it', () => {
    // Degenerate for the elevation maths, unambiguous for everyone else — and
    // it is exactly where a countdown starts.
    const view = viewFrom(pad, data, stationPosition(pad, data, 0), 0);
    expect(view.visible).toBe(true);
    expect(view.signal).toBe(1);
  });

  it('keeps range control talking to a vehicle still on the pad', () => {
    // The elevation rule is a radio horizon for a distant station, and it says
    // a rocket at zero altitude is below it. Range control can see it out of
    // the window; the local range is what says so.
    const onThePad = viewFrom(pad, data, { x: EARTH_RADIUS_M, y: 200 }, 8);
    expect(onThePad.elevation_deg).toBeLessThan(data.minElevation_deg);
    expect(onThePad.visible).toBe(true);
    expect(onThePad.signal).toBeGreaterThan(0);

    // And it is the local range doing it, not a hole in the horizon rule: the
    // same geometry at a station without one stays dark.
    const distant = data.stations.find((entry) => entry.localRange_m === undefined);
    expect(distant).toBeDefined();
    if (distant !== undefined) {
      expect(viewFrom(distant, data, { x: EARTH_RADIUS_M, y: 200 }, 8).visible).toBe(false);
    }
  });

  it('turns the planet, so who is looking changes with time', () => {
    const start = stationPosition(pad, data, 0);
    const quarter = stationPosition(pad, data, data.earthRotationPeriod_s / 4);
    expect(quarter.y).toBeGreaterThan(start.y);
    expect(quarter.x).toBeLessThan(start.x);

    // A full turn brings it back where it started.
    const full = stationPosition(pad, data, data.earthRotationPeriod_s);
    expect(full.x).toBeCloseTo(start.x, 3);
    expect(full.y).toBeCloseTo(start.y, 3);
  });

  it('loses the vehicle once the planet has turned under it', () => {
    expect(viewFrom(pad, data, overhead, 0).visible).toBe(true);
    expect(viewFrom(pad, data, overhead, data.earthRotationPeriod_s / 2).visible).toBe(false);
  });

  it('keeps every station on the surface, wherever it is pointed', () => {
    for (const station of data.stations) {
      for (const time of [0, 1000, 40000, 86164]) {
        const position = stationPosition(station, data, time);
        const radius = Math.sqrt(position.x * position.x + position.y * position.y);
        expect(radius).toBeCloseTo(EARTH_RADIUS_M, 3);
      }
    }
  });

  it('prefers the station with the better link, not merely a visible one', () => {
    const views = viewAll(data, overhead, 0);
    const best = bestLink(views);
    expect(best?.id).toBe(pad.id);
    expect(bestLink(viewAll(data, { x: 0, y: 0 }, 0))).toBeNull();
  });
});

describe('data only counts once it is on the ground', () => {
  it('moves nothing when nobody can see the vehicle', () => {
    const state = { ...createCommsState(), queued: 10 };
    const buried = viewAll(data, { x: 0, y: 0 }, 0);
    expect(stepDownlink(state, data, buried, 4, 0.05)).toBe(0);
    expect(state.queued).toBe(10);
  });

  it('moves nothing when the diagnosis panel has taken every channel', () => {
    // The trade §6.3 and §7 ③ are really about: a cross-check is a channel
    // not carrying science.
    const state = { ...createCommsState(), queued: 10 };
    expect(stepDownlink(state, data, viewAll(data, overhead, 0), 0, 0.05)).toBe(0);
    expect(state.queued).toBe(10);
  });

  it('moves more with more channels free', () => {
    const one = { ...createCommsState(), queued: 100 };
    const four = { ...createCommsState(), queued: 100 };
    const views = viewAll(data, overhead, 0);
    stepDownlink(one, data, views, 1, 1);
    stepDownlink(four, data, views, 4, 1);
    expect(four.downlinked).toBeGreaterThan(one.downlinked);
  });

  it('never downlinks more than was queued', () => {
    const state = { ...createCommsState(), queued: 0.3 };
    stepDownlink(state, data, viewAll(data, overhead, 0), 4, 100);
    expect(state.queued).toBe(0);
    expect(state.downlinked).toBeCloseTo(0.3, 12);
  });

  it('reports the share that made it, and calls an empty queue complete', () => {
    expect(downlinkFraction(createCommsState())).toBe(1);
    expect(downlinkFraction({ queued: 3, downlinked: 1 })).toBeCloseTo(0.25, 12);
    expect(downlinkFraction({ queued: 0, downlinked: 4 })).toBe(1);
  });
});
