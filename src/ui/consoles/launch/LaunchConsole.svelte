<script lang="ts">
  /**
   * The LAUNCH console (concept §7 ①).
   *
   * Reads a telemetry snapshot and turns player input into commands. It never
   * touches simulation state — that boundary is what keeps a replay honest.
   * The masthead, the tab bar and the keyboard live in the shell, so this file
   * is only the panels.
   */
  import {
    Mission,
    checklistItems,
    maxDynamicPressureLimit_Pa,
    targetOrbit,
  } from '../../mission.svelte.js';
  import { uncertainty } from '../../../economy/riskBudget.js';
  import { strings } from '../../strings.js';
  import { panelActionHotkey } from '../../hotkeys.js';
  import {
    formatAltitude,
    formatDynamicPressure,
    formatG,
    formatSpeed,
  } from '../../format.js';
  import EventLog from '../../widgets/EventLog.svelte';
  import Gauge from '../../widgets/Gauge.svelte';
  import OrbitMap from '../../widgets/OrbitMap.svelte';
  import ToggleSwitch from '../../widgets/ToggleSwitch.svelte';

  interface Props {
    mission: Mission;
  }

  const { mission }: Props = $props();
  const telemetry = $derived(mission.telemetry);

  /** Altitude gauge tops out a little above the target, so orbit is near full. */
  const ALTITUDE_MAX_M = targetOrbit.apoapsisAltitude_m * 1.4;

  /**
   * A trajectory whose periapsis is inside the planet is an arc, not an orbit.
   * Reporting it as "-6365 × 33 km" is arithmetically true and useless on a
   * console, so it reads SUBORBITAL until the low point clears the ground.
   */
  const hasOrbit = $derived(telemetry.orbit !== null && telemetry.orbit.periapsisAltitude_m > 0);

  const orbitLine = $derived.by(() => {
    if (telemetry.altitude_m <= 0) return '—';
    const orbit = telemetry.orbit;
    if (orbit === null || !hasOrbit) return strings.launch.suborbital;
    return `${Math.round(orbit.periapsisAltitude_m / 1000)} × ${Math.round(orbit.apoapsisAltitude_m / 1000)} km`;
  });

  const launchButtonLabel = $derived.by(() => {
    if (telemetry.phase === 'HOLD') {
      return telemetry.readyToArm ? strings.launch.armAndLaunch : strings.launch.allStationsGo;
    }
    if (telemetry.phase === 'ARMED') return strings.launch.terminalCount;
    return strings.launch.flightInProgress;
  });
</script>

<div class="launch">
  <div class="grid">
    <section class="panel checklist">
      <h2>{strings.launch.checklist}</h2>
      <div class="switches">
        {#each checklistItems as item, index (item.id)}
          <ToggleSwitch
            label={item.label}
            hotkey={panelActionHotkey(index)}
            checked={telemetry.checklist[index]}
            disabled={telemetry.phase !== 'HOLD'}
            onToggle={() => mission.toggleChecklist(index)}
          />
        {/each}
      </div>

      <button
        type="button"
        class="launch-button"
        class:ready={telemetry.readyToArm}
        disabled={!telemetry.readyToArm}
        onclick={() => mission.arm()}
      >
        {launchButtonLabel}
        {#if telemetry.phase === 'HOLD'}<kbd>Enter</kbd>{/if}
      </button>

      {#if telemetry.phase === 'HOLD' || telemetry.phase === 'ARMED'}
        <div class="risk">
          <h3>
            {strings.launch.riskBudget}
            <span class="total">
              {(telemetry.risk.lossOfMission[0] * 100).toFixed(1)}–{(
                telemetry.risk.lossOfMission[1] * 100
              ).toFixed(1)} % LOM
            </span>
          </h3>
          <ul>
            {#each telemetry.risk.lines as line (line.slotId)}
              <li>
                <span>
                  {line.label}{#if line.units > 1}<em> ×{line.units}</em>{/if}
                </span>
                <span class="value">
                  {(line.contribution[0] * 100).toFixed(1)}–{(line.contribution[1] * 100).toFixed(
                    1,
                  )} %
                </span>
              </li>
            {/each}
          </ul>
          <p>{strings.launch.riskSpread(uncertainty(telemetry.risk) * 50)}</p>
        </div>
      {/if}
    </section>

    <section class="panel telemetry">
      <h2>{strings.launch.telemetry}</h2>
      <div class="gauges">
        <Gauge
          label="ALTITUDE"
          value={telemetry.altitude_m}
          max={ALTITUDE_MAX_M}
          unit="km"
          display={formatAltitude(telemetry.altitude_m)}
        />
        <Gauge
          label="DYNAMIC PRESSURE"
          value={telemetry.dynamicPressure_Pa}
          max={maxDynamicPressureLimit_Pa}
          unit="kPa"
          display={formatDynamicPressure(telemetry.dynamicPressure_Pa)}
          caution={0.85}
        />
      </div>

      <dl class="readouts">
        <div>
          <dt>{strings.launch.velocity}</dt>
          <dd>{formatSpeed(telemetry.speed_ms)} <span>m/s</span></dd>
        </div>
        <div>
          <dt>{strings.launch.acceleration}</dt>
          <dd>{formatG(telemetry.sensedG)} <span>g</span></dd>
        </div>
        <div>
          <dt>{strings.launch.stage}</dt>
          <dd>{telemetry.stageIndex + 1} <span>{telemetry.thrusting ? strings.launch.burn : strings.launch.coast}</span></dd>
        </div>
        <div>
          <dt>{strings.launch.orbit}</dt>
          <dd class="orbit">{orbitLine}</dd>
        </div>
      </dl>

      <div class="propellant">
        <span class="tag">{strings.launch.propellant}</span>
        <div class="bar"><div class="level" style="width: {telemetry.propellantFraction * 100}%"></div></div>
      </div>
    </section>

    <section class="panel map">
      <h2>{strings.launch.orbitMap}</h2>
      <div class="canvas-frame">
        <OrbitMap
          position={telemetry.position}
          trail={telemetry.trail}
          elements={hasOrbit ? (telemetry.orbit?.elements ?? null) : null}
          apoapsisAltitude_m={hasOrbit ? (telemetry.orbit?.apoapsisAltitude_m ?? 0) : 0}
        />
      </div>
    </section>

    <section class="panel log">
      <EventLog events={telemetry.events} />
    </section>
  </div>
</div>

<style>
  .launch {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    flex: 1;
    min-height: 0;
  }

  .grid {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(260px, 1fr) minmax(300px, 1.15fr) minmax(280px, 1.1fr);
    grid-template-rows: 1fr auto;
    gap: 0.9rem;
    min-height: 0;
  }

  .risk {
    margin-top: 0.85rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 0.6rem;
  }

  .risk h3 {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
    margin: 0 0 0.45rem;
    font-size: 0.56rem;
    letter-spacing: 0.22em;
    opacity: 0.5;
  }

  .risk .total {
    font-size: 0.78rem;
    letter-spacing: 0.08em;
    color: #ffc25c;
    opacity: 1;
  }

  .risk ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.22rem;
  }

  .risk li em {
    font-style: normal;
    color: #6dfcae;
    opacity: 0.8;
  }

  .risk li {
    display: flex;
    justify-content: space-between;
    gap: 0.8rem;
    font-size: 0.62rem;
    opacity: 0.72;
  }

  .risk .value {
    color: #ffc25c;
    opacity: 0.85;
  }

  .risk p {
    margin: 0.5rem 0 0;
    font-size: 0.56rem;
    line-height: 1.5;
    opacity: 0.35;
  }

  .panel {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.016);
    padding: 0.85rem 0.95rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
  }

  .panel h2 {
    margin: 0;
    font-size: 0.6rem;
    letter-spacing: 0.22em;
    opacity: 0.45;
    font-weight: 400;
  }

  .switches {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .launch-button {
    margin-top: auto;
    padding: 0.8rem;
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    color: inherit;
    font-family: inherit;
    cursor: pointer;
  }

  .launch-button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .launch-button.ready {
    border-color: rgba(109, 252, 174, 0.6);
    color: #6dfcae;
    background: rgba(109, 252, 174, 0.07);
    animation: pulse 1.8s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      box-shadow: 0 0 18px rgba(109, 252, 174, 0.25);
    }
  }

  kbd {
    font: inherit;
    font-size: 0.85em;
    opacity: 0.45;
  }

  .gauges {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
  }

  .readouts {
    margin: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.55rem 0.9rem;
  }

  .readouts dt {
    font-size: 0.58rem;
    letter-spacing: 0.16em;
    opacity: 0.45;
  }

  .readouts dd {
    margin: 0.1rem 0 0;
    font-size: 1.05rem;
    color: #e8fff2;
    font-variant-numeric: tabular-nums;
  }

  .readouts dd span {
    font-size: 0.62rem;
    opacity: 0.5;
    letter-spacing: 0.1em;
  }

  .readouts .orbit {
    font-size: 0.85rem;
  }

  .propellant {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .tag {
    font-size: 0.55rem;
    letter-spacing: 0.18em;
    opacity: 0.45;
  }

  .bar {
    flex: 1;
    height: 0.5rem;
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 2px;
    overflow: hidden;
  }

  .level {
    height: 100%;
    background: linear-gradient(90deg, rgba(109, 252, 174, 0.5), #6dfcae);
    transition: width 120ms linear;
  }

  .canvas-frame {
    flex: 1;
    min-height: 190px;
  }

  .log {
    grid-column: 1 / -1;
    min-height: 8.5rem;
    max-height: 12rem;
  }

  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
      grid-template-rows: none;
    }
  }
</style>
