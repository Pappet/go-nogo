<script lang="ts">
  /**
   * The COMMS console (concept §7 ③).
   *
   * Signal strengths, visibility windows, downlink, channel matrix. None of it
   * is decoration: a station sees the vehicle because the geometry says so,
   * and the data on the ground is the data that will be paid for.
   *
   * The console exists to make one trade legible. The four channels the
   * diagnosis panel spends on cross-checks and team queries are the same four
   * that carry science home, so working a crisis costs research — in the
   * currency the tech tree runs on. That sentence is the console.
   */
  import type { Mission } from '../../mission.svelte.js';

  interface Props {
    mission: Mission;
  }

  const { mission }: Props = $props();
  const telemetry = $derived(mission.telemetry);

  const freeChannels = $derived(
    Math.max(0, telemetry.channels.capacity - telemetry.channels.inUse),
  );
  const inContact = $derived(telemetry.stations.filter((station) => station.visible));
  const best = $derived(
    inContact.length === 0
      ? null
      : inContact.reduce((a, b) => (b.signal > a.signal ? b : a)),
  );
  const total = $derived(telemetry.downlink.queued + telemetry.downlink.delivered);
  const range = (metres: number): string =>
    metres >= 1000 ? `${(metres / 1000).toFixed(0)} km` : `${metres.toFixed(0)} m`;
</script>

<section class="comms">
  <header class="link" class:dark={best === null}>
    <div class="state">
      <span class="label">LINK</span>
      <span class="value">
        {#if best === null}
          ■ NO CONTACT
        {:else}
          {best.title}
        {/if}
      </span>
      {#if best !== null}
        <span class="detail">
          {(best.signal * 100).toFixed(0)} % · {best.elevation_deg.toFixed(0)}° · {range(
            best.range_m,
          )}
        </span>
      {:else}
        <span class="detail">Nothing above the horizon. Data stays aboard.</span>
      {/if}
    </div>

    <div class="channels">
      <span class="label">CHANNELS</span>
      <div class="matrix">
        {#each Array(telemetry.channels.capacity) as _, index (index)}
          <span
            class="channel"
            class:busy={index < telemetry.channels.inUse}
            class:carrying={index >= telemetry.channels.inUse &&
              best !== null &&
              telemetry.downlink.queued > 0}
          ></span>
        {/each}
      </div>
      <span class="count">{freeChannels} free of {telemetry.channels.capacity}</span>
    </div>
  </header>

  <div class="grid">
    <section class="panel stations">
      <h2>GROUND STATIONS</h2>
      <ul>
        {#each telemetry.stations as station (station.id)}
          <li class:visible={station.visible}>
            <span class="name">
              {station.visible ? '▲' : '·'}
              {station.title}
            </span>
            <span class="bar">
              <span class="fill" style="width: {Math.max(0, station.signal) * 100}%"></span>
            </span>
            <span class="numbers">
              {#if station.visible}
                {station.elevation_deg.toFixed(0)}° · {range(station.range_m)}
              {:else}
                below horizon
              {/if}
            </span>
          </li>
        {/each}
      </ul>
    </section>

    <section class="panel downlink">
      <h2>DOWNLINK</h2>
      {#if total <= 0}
        <p class="quiet">No science aboard. This contract pays in money alone.</p>
      {:else}
        <p class="headline">
          {(telemetry.downlink.fraction * 100).toFixed(0)}<small>% delivered</small>
        </p>
        <div class="track">
          <div class="fill" style="width: {telemetry.downlink.fraction * 100}%"></div>
        </div>
        <dl>
          <div>
            <dt>ON THE GROUND</dt>
            <dd>{telemetry.downlink.delivered.toFixed(2)}</dd>
          </div>
          <div>
            <dt>STILL ABOARD</dt>
            <dd class:bad={telemetry.downlink.queued > 0}>
              {telemetry.downlink.queued.toFixed(2)}
            </dd>
          </div>
        </dl>
        <p class="note">
          Science counts when it lands, not when it is recorded. Every channel the diagnosis panel
          takes is a channel not carrying it home.
        </p>
      {/if}
    </section>
  </div>
</section>

<style>
  .comms {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .link {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1.5rem;
    border: 1px solid rgba(109, 252, 174, 0.35);
    background: rgba(109, 252, 174, 0.04);
    border-radius: 3px;
    padding: 0.8rem 1rem;
  }

  .link.dark {
    border-color: rgba(255, 138, 92, 0.45);
    background: rgba(255, 138, 92, 0.05);
  }

  .state {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .label {
    font-size: 0.55rem;
    letter-spacing: 0.22em;
    opacity: 0.45;
  }

  .state .value {
    font-size: 1.15rem;
    letter-spacing: 0.1em;
    color: #6dfcae;
  }

  .link.dark .state .value {
    color: #ff8a5c;
  }

  .state .detail {
    font-size: 0.62rem;
    opacity: 0.5;
  }

  .channels {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.3rem;
  }

  .matrix {
    display: flex;
    gap: 0.25rem;
  }

  .channel {
    width: 1.1rem;
    height: 0.55rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 1px;
  }

  .channel.busy {
    background: rgba(255, 194, 92, 0.6);
    border-color: rgba(255, 194, 92, 0.7);
  }

  .channel.carrying {
    background: rgba(109, 252, 174, 0.5);
    border-color: rgba(109, 252, 174, 0.7);
  }

  .count {
    font-size: 0.6rem;
    opacity: 0.5;
  }

  .grid {
    display: grid;
    grid-template-columns: 1.3fr 1fr;
    gap: 0.8rem;
  }

  .panel {
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.02);
    padding: 0.75rem 0.9rem;
  }

  h2 {
    margin: 0 0 0.6rem;
    font-size: 0.6rem;
    letter-spacing: 0.24em;
    opacity: 0.5;
  }

  .stations ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .stations li {
    display: grid;
    grid-template-columns: minmax(120px, 1fr) 2fr minmax(90px, auto);
    align-items: center;
    gap: 0.7rem;
    font-size: 0.66rem;
    opacity: 0.45;
  }

  .stations li.visible {
    opacity: 1;
  }

  .stations .name {
    letter-spacing: 0.06em;
  }

  .stations li.visible .name {
    color: #6dfcae;
  }

  .bar {
    height: 0.35rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 1px;
    overflow: hidden;
  }

  .bar .fill {
    display: block;
    height: 100%;
    background: rgba(109, 252, 174, 0.55);
  }

  .numbers {
    text-align: right;
    font-size: 0.6rem;
    opacity: 0.6;
  }

  .headline {
    margin: 0 0 0.4rem;
    font-size: 1.5rem;
    color: #6dfcae;
  }

  .headline small {
    font-size: 0.58rem;
    letter-spacing: 0.16em;
    opacity: 0.5;
    margin-left: 0.35rem;
    color: #cfe8dc;
  }

  .track {
    height: 0.4rem;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 1px;
    overflow: hidden;
    margin-bottom: 0.6rem;
  }

  .track .fill {
    height: 100%;
    background: rgba(109, 252, 174, 0.5);
  }

  .downlink dl {
    margin: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }

  .downlink dt {
    font-size: 0.55rem;
    letter-spacing: 0.18em;
    opacity: 0.45;
  }

  .downlink dd {
    margin: 0.2rem 0 0;
    font-size: 1rem;
  }

  .downlink dd.bad {
    color: #ffc25c;
  }

  .note,
  .quiet {
    margin: 0.6rem 0 0;
    font-size: 0.6rem;
    line-height: 1.5;
    opacity: 0.4;
  }
</style>
