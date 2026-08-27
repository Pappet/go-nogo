/**
 * Ground stations, visibility and downlink (concept §7 ③, §6.3).
 *
 * The simulation is planar, so a station is a fixed angle on the Earth's
 * circumference that turns with it. That is less than a real ground network
 * but it is not decoration: whether a station can see the vehicle comes out of
 * the same positions the ascent integrates, so a pass arrives when the orbit
 * says it does and the console cannot flatter the player.
 *
 * The link is where §6.3's "downlink limited by comms" becomes a decision the
 * player actually makes. Research data only counts once it is on the ground,
 * the channels that carry it are the same four the diagnosis panel spends on
 * cross-checks and team queries, and a pass that is missed does not come back
 * for a while. Diagnosing a crisis costs science, in a currency the campaign
 * spends on the tech tree.
 *
 * Everything here obeys §8.2: integer ticks, positions from the flight state,
 * and trigonometry from `sim/math.ts` rather than the engine's.
 */
import { TAU, cos, sin } from '../math.js';
import { EARTH_RADIUS_M } from '../physics/constants.js';
import type { Vec2 } from '../physics/kepler.js';

export interface GroundStationDef {
  readonly id: string;
  readonly title: string;
  readonly angle_deg: number;
  /** Data units per second this station can pull down, per channel. */
  readonly downlinkRate: number;
  /**
   * Range inside which the link holds whatever the elevation says.
   *
   * The elevation rule is a radio horizon for a distant tracking station, and
   * it gives the wrong answer for the one standing next to the pad: a vehicle
   * at zero altitude sits exactly on its own horizon, so range control would
   * lose a rocket it can see out of the window.
   */
  readonly localRange_m?: number;
}

export interface CommsData {
  readonly earthRotationPeriod_s: number;
  readonly minElevation_deg: number;
  /** Range at which signal strength reads 1. Beyond it, falls off. */
  readonly referenceRange_m: number;
  readonly stations: readonly GroundStationDef[];
}

export interface StationView {
  readonly id: string;
  readonly title: string;
  readonly visible: boolean;
  /** 0..1. Zero when out of sight. */
  readonly signal: number;
  readonly range_m: number;
  /** Degrees above the local horizon. Negative when below it. */
  readonly elevation_deg: number;
}

export interface CommsState {
  /** Data produced by the mission and not yet on the ground (§6.3). */
  queued: number;
  /** Data successfully downlinked. Only this counts. */
  downlinked: number;
}

export function createCommsState(): CommsState {
  return { queued: 0, downlinked: 0 };
}

/** Where a station is at a given moment, in the same frame as the vehicle. */
export function stationPosition(
  station: GroundStationDef,
  data: CommsData,
  missionTime_s: number,
): Vec2 {
  const angle =
    (station.angle_deg / 360) * TAU + (missionTime_s / data.earthRotationPeriod_s) * TAU;
  return { x: EARTH_RADIUS_M * cos(angle), y: EARTH_RADIUS_M * sin(angle) };
}

/**
 * What one station can see.
 *
 * Elevation is the angle between the station's local zenith and the direction
 * to the vehicle, which in the plane is a single dot product — the horizon
 * falls out of the geometry rather than being a rule applied on top of it.
 */
export function viewFrom(
  station: GroundStationDef,
  data: CommsData,
  vehicle: Vec2,
  missionTime_s: number,
): StationView {
  const position = stationPosition(station, data, missionTime_s);
  const toVehicle = { x: vehicle.x - position.x, y: vehicle.y - position.y };
  const range = Math.sqrt(toVehicle.x * toVehicle.x + toVehicle.y * toVehicle.y);

  if (range === 0) {
    // The vehicle is standing on the station. Degenerate for the elevation
    // maths and unambiguous for everyone else: that is contact, not the loss
    // of it — it is where a countdown starts.
    return {
      id: station.id,
      title: station.title,
      visible: true,
      signal: 1,
      range_m: 0,
      elevation_deg: 90,
    };
  }

  // Local zenith is the station's own outward radial.
  const zenith = { x: position.x / EARTH_RADIUS_M, y: position.y / EARTH_RADIUS_M };
  const sinElevation = (zenith.x * toVehicle.x + zenith.y * toVehicle.y) / range;
  const clamped = Math.max(-1, Math.min(1, sinElevation));
  // asin is not in sim/math, and the console only needs a legible number:
  // a degree scale linear in the sine reads the same way and stays exact at
  // the horizon and the zenith, which are the two values that matter.
  const elevation_deg = clamped * 90;

  const withinLocal = station.localRange_m !== undefined && range <= station.localRange_m;
  const visible = withinLocal || elevation_deg >= data.minElevation_deg;
  const falloff = data.referenceRange_m / Math.max(data.referenceRange_m, range);

  return {
    id: station.id,
    title: station.title,
    visible,
    // A station low on the horizon is a poor link even when it is technically
    // in sight, so elevation weighs alongside range.
    signal: visible ? falloff * Math.max(0.15, withinLocal ? 1 : clamped) : 0,
    range_m: range,
    elevation_deg,
  };
}

export function viewAll(
  data: CommsData,
  vehicle: Vec2,
  missionTime_s: number,
): StationView[] {
  return data.stations.map((station) => viewFrom(station, data, vehicle, missionTime_s));
}

/** The best link available right now, or null when nobody can see the vehicle. */
export function bestLink(views: readonly StationView[]): StationView | null {
  const visible = views.filter((view) => view.visible);
  if (visible.length === 0) return null;
  return visible.reduce((best, view) => (view.signal > best.signal ? view : best));
}

/**
 * Moves data to the ground for one tick.
 *
 * `freeChannels` is what the diagnosis panel has left over: every channel
 * spent on a cross-check is a channel not carrying science. That is the whole
 * trade, and it is why this takes the number rather than looking it up.
 */
export function stepDownlink(
  state: CommsState,
  data: CommsData,
  views: readonly StationView[],
  freeChannels: number,
  dt_s: number,
): number {
  if (state.queued <= 0 || freeChannels <= 0) return 0;
  const link = bestLink(views);
  if (link === null) return 0;

  const station = data.stations.find((entry) => entry.id === link.id);
  if (station === undefined) return 0;

  const moved = Math.min(state.queued, station.downlinkRate * link.signal * freeChannels * dt_s);
  state.queued -= moved;
  state.downlinked += moved;
  return moved;
}

/** The share of a mission's data that made it down. 1 when there was none. */
export function downlinkFraction(state: CommsState): number {
  const total = state.queued + state.downlinked;
  return total <= 0 ? 1 : state.downlinked / total;
}
