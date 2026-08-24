<script lang="ts">
  /**
   * The console shell: the chrome every console shares.
   *
   * Owns the mission clock, the run controls, the tab bar and the keyboard, so
   * that switching console changes the panels and nothing else. §7.7 says the
   * tab bar carries the numbers — the shell is where they live.
   */
  import { onMount } from 'svelte';

  import { Mission } from '../mission.svelte.js';
  import {
    CONSOLE_SLOTS,
    type ConsoleSlot,
    consoleHotkey,
    resolveHotkey,
  } from '../hotkeys.js';
  import { isMuted, setMuted, unlockAudio } from '../audio/synth.js';
  import { formatMissionClock } from '../format.js';
  import SevenSeg from '../widgets/SevenSeg.svelte';
  import EngineeringConsole from './engineering/EngineeringConsole.svelte';
  import LaunchConsole from './launch/LaunchConsole.svelte';

  const mission = new Mission();
  const telemetry = $derived(mission.telemetry);

  let muted = $state(false);
  let resumed = $state(false);

  /** Consoles that exist in this phase. The rest are drawn, but inert. */
  const AVAILABLE: readonly ConsoleSlot[] = ['launch', 'engineering'];
  const LABELS: Record<ConsoleSlot, string> = {
    launch: 'LAUNCH',
    flight: 'FLIGHT',
    comms: 'COMMS',
    engineering: 'ENGINEERING',
    eventLog: 'EVENT LOG',
  };

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
      case 'switchConsole':
        mission.switchConsole(action.slot);
        return;
      case 'panelAction':
        // The focused console decides what its panel actions are: checklist
        // switches in LAUNCH, diagnosis measures in ENGINEERING.
        if (telemetry.console === 'launch') {
          mission.toggleChecklist(action.index);
        } else {
          // The keys address what the panel offers, not what the file happens
          // to list first: a measure that can no longer separate the surviving
          // candidates would otherwise sit on Q and waste it.
          const focus = mission.focusedAnomaly;
          const measure = offeredDiagnoses[action.index];
          if (focus !== null && measure !== undefined) {
            mission.queueMeasure(measure.id, focus);
          }
        }
        return;
      case 'focusDiagnosis':
        mission.switchConsole('engineering');
        return;
      case 'focusEventLog':
        mission.switchConsole('launch');
        return;
      case 'confirm':
        if (telemetry.console === 'launch') mission.arm();
        else mission.acceptResultOffer();
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

  /** Diagnoses that can still narrow the field — these carry the hotkeys. */
  const offeredDiagnoses = $derived(
    telemetry.measures.filter((measure) => measure.kind === 'diagnosis' && !measure.redundant),
  );

  const phaseLabel = $derived(telemetry.phase.replace('_', ' '));
  /** An unattended anomaly outranks the countdown phase in the status chip. */
  const alarm = $derived(telemetry.anomalies.length > 0);
</script>

<svelte:window onkeydown={onKeydown} />

<main class="shell">
  <header class="masthead">
    <div class="identity">
      <h1>GO<span>/</span>NOGO</h1>
      <p>{LABELS[telemetry.console]} · GN-1 VANGUARD</p>
    </div>

    <div class="clock">
      <SevenSeg
        value={formatMissionClock(telemetry.clock_s)}
        tone={telemetry.clock_s < 0 ? 'amber' : 'green'}
      />
    </div>

    <div class="status">
      <span class="phase" class:live={telemetry.phase !== 'HOLD'} class:alarm>
        {alarm ? `${telemetry.anomalies.length} ANOMALY` : phaseLabel}
      </span>
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
    <p class="notice">Resumed from the last auto-save.</p>
  {/if}

  {#if telemetry.resultOffer !== null}
    <button type="button" class="offer" onclick={() => mission.acceptResultOffer()}>
      RESULT READY — {telemetry.resultOffer.measureTitle}. Pause to read it? <kbd>Enter</kbd>
    </button>
  {/if}

  <nav class="tabs" aria-label="Consoles">
    {#each CONSOLE_SLOTS as slot, index (slot)}
      <button
        type="button"
        class="tab"
        class:active={telemetry.console === slot}
        disabled={!AVAILABLE.includes(slot)}
        onclick={() => mission.switchConsole(slot)}
      >
        <span class="key">{consoleHotkey(index)}</span>
        {LABELS[slot]}
      </button>
    {/each}
  </nav>

  {#if telemetry.console === 'engineering'}
    <EngineeringConsole {mission} />
  {:else}
    <LaunchConsole {mission} />
  {/if}
</main>

<style>
  .shell {
    min-height: 100vh;
    padding: 1.1rem 1.4rem 1.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
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

  .phase.alarm {
    color: #ff8a5c;
    border-color: rgba(255, 138, 92, 0.6);
    box-shadow: 0 0 14px rgba(255, 138, 92, 0.2);
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
    opacity: 0.35;
    cursor: default;
  }

  kbd {
    font: inherit;
    font-size: 0.85em;
    opacity: 0.45;
  }

  .notice {
    margin: 0;
    font-size: 0.68rem;
    color: #ffc25c;
    opacity: 0.8;
  }

  .offer {
    text-align: left;
    border-color: rgba(255, 194, 92, 0.55);
    color: #ffc25c;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    padding: 0.5rem 0.7rem;
  }

  .tabs {
    display: flex;
    gap: 0.3rem;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.62rem;
    letter-spacing: 0.16em;
    padding: 0.35rem 0.7rem;
  }

  .tab.active {
    border-color: rgba(109, 252, 174, 0.6);
    color: #6dfcae;
    background: rgba(109, 252, 174, 0.06);
  }

  .tab .key {
    font-size: 0.58rem;
    opacity: 0.5;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 2px;
    padding: 0 0.2rem;
  }
</style>
