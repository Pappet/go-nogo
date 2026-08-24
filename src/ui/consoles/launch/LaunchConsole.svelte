<script lang="ts">
  /**
   * The LAUNCH console (concept §7 ①).
   *
   * Reads a telemetry snapshot and turns player input into commands. It never
   * touches simulation state — that boundary is what keeps a replay honest.
   */
  import { onMount } from 'svelte';

  import { Mission, checklistItems, maxDynamicPressureLimit_Pa, targetOrbit } from '../../mission.svelte.js';
  import { resolveHotkey } from '../../hotkeys.js';
  import { isMuted, setMuted, unlockAudio } from '../../audio/synth.js';
  import {
    formatAltitude,
    formatDynamicPressure,
    formatG,
    formatMissionClock,
    formatSpeed,
  } from '../../format.js';
  import EventLog from '../../widgets/EventLog.svelte';
  import Gauge from '../../widgets/Gauge.svelte';
  import OrbitMap from '../../widgets/OrbitMap.svelte';
  import SevenSeg from '../../widgets/SevenSeg.svelte';
  import ToggleSwitch from '../../widgets/ToggleSwitch.svelte';

  const mission = new Mission();
  const telemetry = $derived(mission.telemetry);

  let muted = $state(false);
  let resumed = $state(false);

  /** Altitude gauge tops out a little above the target, so orbit is near full. */
  const ALTITUDE_MAX_M = targetOrbit.apoapsisAltitude_m * 1.4;

  onMount(() => {
    resumed = mission.resume();
    mission.start();

    const onVisibility = (): void => {
      // Web tabs do get closed (concept §8.2 rule 9).
      if (document.visibilityState === 'hidden') mission.save();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      mission.stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const action = resolveHotkey(event.key);
    if (action === null) return;
    event.preventDefault();
    unlockAudio();

    switch (action.kind) {
      case 'toggleChecklist':
        if (action.index < checklistItems.length) mission.toggleChecklist(action.index);
        return;
      case 'arm':
        mission.arm();
        return;
      case 'togglePause':
        mission.togglePause();
        return;
      case 'warpUp':
        mission.warpUp();
        return;
      case 'warpDown':
        mission.warpDown();
        return;
    }
  }

  function toggleMute(): void {
    muted = !muted;
    setMuted(muted);
  }

  function restart(): void {
    mission.clearSave();
    mission.reset();
    resumed = false;
  }

  const phaseLabel = $derived(telemetry.phase.replace('_', ' '));

  /**
   * A trajectory whose periapsis is inside the planet is an arc, not an orbit.
   * Reporting it as "-6365 × 33 km" is arithmetically true and useless on a
   * console, so it reads SUBORBITAL until the low point clears the ground.
   */
  const hasOrbit = $derived(telemetry.orbit !== null && telemetry.orbit.periapsisAltitude_m > 0);

  const orbitLine = $derived.by(() => {
    if (telemetry.altitude_m <= 0) return '—';
    const orbit = telemetry.orbit;
    if (orbit === null || !hasOrbit) return 'SUBORBITAL';
    return `${Math.round(orbit.periapsisAltitude_m / 1000)} × ${Math.round(orbit.apoapsisAltitude_m / 1000)} km`;
  });

  const launchButtonLabel = $derived.by(() => {
    if (telemetry.phase === 'HOLD') {
      return telemetry.readyToArm ? 'ARM AND LAUNCH' : 'ALL STATIONS MUST REPORT GO';
    }
    if (telemetry.phase === 'ARMED') return 'TERMINAL COUNT RUNNING';
    return 'FLIGHT IN PROGRESS';
  });
</script>

<svelte:window onkeydown={onKeydown} />

<main class="console">
  <header class="masthead">
    <div class="identity">
      <h1>GO<span>/</span>NOGO</h1>
      <p>LAUNCH CONSOLE · GN-1 VANGUARD</p>
    </div>

    <div class="clock">
      <SevenSeg value={formatMissionClock(telemetry.clock_s)} tone={telemetry.clock_s < 0 ? 'amber' : 'green'} />
    </div>

    <div class="status">
      <span class="phase" class:live={telemetry.phase !== 'HOLD'}>{phaseLabel}</span>
      <div class="controls">
        <button type="button" onclick={() => mission.togglePause()}>
          {telemetry.paused ? 'RESUME' : 'PAUSE'} <kbd>Space</kbd>
        </button>
        <button type="button" onclick={() => mission.warpDown()} disabled={telemetry.warp === 1}>−</button>
        <span class="warp">{telemetry.warp}×</span>
        <button type="button" onclick={() => mission.warpUp()}>+</button>
        <button type="button" onclick={toggleMute}>{muted ? 'SOUND OFF' : 'SOUND ON'}</button>
        <button type="button" onclick={restart}>RESTART</button>
      </div>
    </div>
  </header>

  {#if resumed}
    <p class="resumed">Resumed from the last auto-save.</p>
  {/if}

  <div class="grid">
    <section class="panel checklist">
      <h2>PRELAUNCH CHECKLIST</h2>
      <div class="switches">
        {#each checklistItems as item, index (item.id)}
          <ToggleSwitch
            label={item.label}
            hotkey={item.hotkey}
            checked={telemetry.checklist[index]}
            disabled={telemetry.phase !== 'HOLD'}
            onToggle={() => mission.toggleChecklist(index)}
          />
        {/each}
      </div>

      <button
        type="button"
        class="launch"
        class:ready={telemetry.readyToArm}
        disabled={!telemetry.readyToArm}
        onclick={() => mission.arm()}
      >
        {launchButtonLabel}
        {#if telemetry.phase === 'HOLD'}<kbd>Enter</kbd>{/if}
      </button>
    </section>

    <section class="panel telemetry">
      <h2>TELEMETRY</h2>
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
          <dt>VELOCITY</dt>
          <dd>{formatSpeed(telemetry.speed_ms)} <span>m/s</span></dd>
        </div>
        <div>
          <dt>ACCELERATION</dt>
          <dd>{formatG(telemetry.sensedG)} <span>g</span></dd>
        </div>
        <div>
          <dt>STAGE</dt>
          <dd>{telemetry.stageIndex + 1} <span>{telemetry.thrusting ? 'BURN' : 'COAST'}</span></dd>
        </div>
        <div>
          <dt>ORBIT</dt>
          <dd class="orbit">{orbitLine}</dd>
        </div>
      </dl>

      <div class="propellant">
        <span class="tag">PROPELLANT</span>
        <div class="bar"><div class="level" style="width: {telemetry.propellantFraction * 100}%"></div></div>
      </div>
    </section>

    <section class="panel map">
      <h2>ORBIT MAP</h2>
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
</main>

<style>
  .console {
    min-height: 100vh;
    padding: 1.1rem 1.4rem 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    background:
      radial-gradient(120% 80% at 50% 0%, rgba(40, 90, 78, 0.22), transparent 70%),
      #070b09;
    color: #cfe8dc;
    font-family: ui-monospace, 'SFMono-Regular', 'Menlo', 'Consolas', monospace;
  }

  .masthead {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding-bottom: 0.8rem;
  }

  h1 {
    margin: 0;
    font-size: 1.05rem;
    letter-spacing: 0.34em;
    color: #e8fff2;
  }

  h1 span {
    opacity: 0.4;
  }

  .identity p {
    margin: 0.2rem 0 0;
    font-size: 0.6rem;
    letter-spacing: 0.22em;
    opacity: 0.45;
  }

  .clock {
    display: flex;
    justify-content: center;
  }

  .status {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.45rem;
  }

  .phase {
    font-size: 0.78rem;
    letter-spacing: 0.24em;
    padding: 0.18rem 0.6rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 2px;
    opacity: 0.7;
  }

  .phase.live {
    color: #6dfcae;
    border-color: rgba(109, 252, 174, 0.5);
    opacity: 1;
    box-shadow: 0 0 12px rgba(109, 252, 174, 0.18);
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .warp {
    font-size: 0.7rem;
    min-width: 2rem;
    text-align: center;
    opacity: 0.7;
  }

  button {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    color: inherit;
    font: inherit;
    font-size: 0.63rem;
    letter-spacing: 0.12em;
    padding: 0.3rem 0.55rem;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    border-color: rgba(109, 252, 174, 0.45);
  }

  button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  kbd {
    font: inherit;
    font-size: 0.85em;
    opacity: 0.45;
  }

  .resumed {
    margin: 0;
    font-size: 0.68rem;
    color: #ffc25c;
    opacity: 0.8;
  }

  .grid {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(260px, 1fr) minmax(300px, 1.15fr) minmax(280px, 1.1fr);
    grid-template-rows: 1fr auto;
    gap: 0.9rem;
    min-height: 0;
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

  .launch {
    margin-top: auto;
    padding: 0.8rem;
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
  }

  .launch.ready {
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

    .masthead {
      grid-template-columns: 1fr;
      justify-items: center;
      text-align: center;
    }

    .status {
      align-items: center;
    }
  }
</style>
