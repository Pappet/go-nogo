<script lang="ts">
  /**
   * The console shell: the chrome every console shares.
   *
   * Owns the mission clock, the run controls, the tab bar and the keyboard, so
   * that switching console changes the panels and nothing else. §7.7 says the
   * tab bar carries the numbers — the shell is where they live.
   */
  import { onMount } from 'svelte';

  import { AVAILABLE_CONSOLES, Mission } from '../mission.svelte.js';
  import {
    ACTION_LABELS,
    BINDABLE_ACTIONS,
    type BindableAction,
    type Bindings,
    CONSOLE_SLOTS,
    type ConsoleSlot,
    DEFAULT_BINDINGS,
    consoleHotkey,
    isReserved,
    keyLabel,
    normaliseKey,
    rebind,
    resolveHotkey,
  } from '../hotkeys.js';
  import { setMuted, unlockAudio } from '../audio/synth.js';
  import { formatMissionClock } from '../format.js';
  import { strings } from '../strings.js';
  import SevenSeg from '../widgets/SevenSeg.svelte';
  import EngineeringConsole from './engineering/EngineeringConsole.svelte';
  import LaunchConsole from './launch/LaunchConsole.svelte';
  import CommsConsole from './comms/CommsConsole.svelte';
  import ConfiguratorConsole from './configurator/ConfiguratorConsole.svelte';
  import PostMortemConsole from './postmortem/PostMortemConsole.svelte';

  const mission = new Mission();
  const telemetry = $derived(mission.telemetry);

  let muted = $state(false);

  /**
   * The keyboard, as this player has arranged it (§7.7, rebinding from Phase 2).
   *
   * Kept in localStorage rather than in the campaign: a rebinding is about the
   * person at the keyboard, not about the company they are running, and it
   * should survive starting a new one.
   */
  const BINDINGS_KEY = 'go-nogo/bindings';
  let bindings = $state<Bindings>(loadBindings());
  let keysOpen = $state(false);
  /** The action waiting for a key press, while the player is rebinding one. */
  let capturing = $state<BindableAction | null>(null);

  function loadBindings(): Bindings {
    try {
      const raw = localStorage.getItem(BINDINGS_KEY);
      if (raw === null) return DEFAULT_BINDINGS;
      // Merged onto the defaults, so a scheme saved before an action existed
      // still leaves that action bound rather than dead.
      return { ...DEFAULT_BINDINGS, ...(JSON.parse(raw) as Partial<Bindings>) };
    } catch {
      return DEFAULT_BINDINGS;
    }
  }

  function saveBindings(next: Bindings): void {
    bindings = next;
    try {
      localStorage.setItem(BINDINGS_KEY, JSON.stringify(next));
    } catch {
      // A browser refusing storage is not a reason to refuse the rebinding.
    }
  }

  /**
   * The POST-MORTEM is console ⑥ in §7, and §7.7 only hands out keys 1–5 — so
   * it has no number and cannot be reached while the flight is running. It
   * opens itself the moment the mission has an outcome, and the player can
   * step back to the other consoles to look at where the vehicle ended up.
   */
  let showReport = $state(false);
  let wasOver = false;
  $effect(() => {
    // Only the transition opens it. Reacting to the flag itself would reopen
    // the report every frame and pin the player to it.
    const over = telemetry.missionOver;
    if (over !== wasOver) {
      wasOver = over;
      showReport = over;
    }
  });

  const AVAILABLE = AVAILABLE_CONSOLES;
  const LABELS: Record<ConsoleSlot, string> = {
    launch: strings.consoles.launch,
    flight: strings.consoles.flight,
    comms: strings.consoles.comms,
    engineering: strings.consoles.engineering,
    eventLog: strings.consoles.eventLog,
  };

  onMount(() => {
    mission.resume();
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

    // While the rebinding panel is waiting, every key is the answer to it.
    if (capturing !== null) {
      event.preventDefault();
      const key = normaliseKey(event.key);
      if (key === 'escape') capturing = null;
      else if (!isReserved(key)) {
        saveBindings(rebind(bindings, capturing, key));
        capturing = null;
      }
      return;
    }

    const action = resolveHotkey(event.key, bindings);
    if (action === null) return;
    event.preventDefault();
    unlockAudio();

    switch (action.kind) {
      case 'switchConsole':
        showReport = false;
        mission.switchConsole(action.slot);
        return;
      case 'togglePlanner':
        if (telemetry.plannerOpen) mission.closePlanner();
        else mission.openPlanner();
        return;
      case 'panelAction':
        // Neither the post-mortem nor the planner takes the flight's keys.
        if (showReport || telemetry.plannerOpen) return;
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
        if (showReport || telemetry.plannerOpen) return;
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
    mission.retrySameMission();
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
      <h1>{strings.app.title.split('/')[0]}<span>/</span>{strings.app.title.split('/')[1]}</h1>
      <p>
        {telemetry.plannerOpen
          ? strings.consoles.planner
          : showReport
            ? strings.consoles.postMortem
            : LABELS[telemetry.console]} · {strings.app.vehicle}
      </p>
    </div>

    <div class="clock">
      <SevenSeg
        value={formatMissionClock(telemetry.clock_s)}
        tone={telemetry.clock_s < 0 ? 'amber' : 'green'}
      />
    </div>

    <div class="status">
      <span class="phase" class:live={telemetry.phase !== 'HOLD'} class:alarm>
        {alarm ? strings.controls.anomalyCount(telemetry.anomalies.length) : phaseLabel}
      </span>
      <div class="controls">
        <button type="button" onclick={() => mission.togglePause()}>
          {telemetry.paused ? strings.controls.resume : strings.controls.pause}
          <kbd>{keyLabel(bindings.togglePause)}</kbd>
        </button>
        <button type="button" onclick={() => mission.warpDown()} disabled={telemetry.warp === 1}>−</button>
        <span class="warp">{telemetry.warp}×</span>
        <button type="button" onclick={() => mission.warpUp()}>+</button>
        <button type="button" onclick={() => mission.save()} title="Save the flight where it is">
          {strings.controls.save}{#if telemetry.savedAt !== null}<span class="saved">{telemetry.savedAt}</span>{/if}
        </button>
        <button type="button" onclick={() => (keysOpen = !keysOpen)}>{strings.controls.keys}</button>
        <button type="button" onclick={toggleMute}>{muted ? strings.controls.soundOff : strings.controls.soundOn}</button>
        <button type="button" onclick={restart}>{strings.controls.restart}</button>
      </div>
    </div>
  </header>

  {#if keysOpen}
    <section class="keys" aria-label="Key bindings">
      <header>
        <h2>{strings.keyBindings.heading}</h2>
        <div>
          <button type="button" onclick={() => saveBindings(DEFAULT_BINDINGS)}>{strings.controls.reset}</button>
          <button type="button" onclick={() => (keysOpen = false)}>{strings.controls.close}</button>
        </div>
      </header>
      <ul>
        {#each BINDABLE_ACTIONS as action (action)}
          <li>
            <span class="what">{ACTION_LABELS[action]}</span>
            <button
              type="button"
              class="binding"
              class:capturing={capturing === action}
              class:unbound={bindings[action] === ''}
              onclick={() => (capturing = capturing === action ? null : action)}
            >
              {#if capturing === action}
                {strings.keyBindings.pressAKey}
              {:else if bindings[action] === ''}
                {strings.keyBindings.unbound}
              {:else}
                {keyLabel(bindings[action])}
              {/if}
            </button>
          </li>
        {/each}
      </ul>
      <p class="note">{strings.keyBindings.note}</p>
    </section>
  {/if}

  {#if telemetry.resumedFromSave}
    <p class="notice">{strings.controls.resumedFromSave}</p>
  {/if}

  {#if telemetry.resultOffer !== null}
    <button type="button" class="offer" onclick={() => mission.acceptResultOffer()}>
      {strings.controls.resultReady(telemetry.resultOffer.measureTitle)}
      <kbd>{keyLabel(bindings.confirm)}</kbd>
    </button>
  {/if}

  <nav class="tabs" aria-label="Consoles">
    {#each CONSOLE_SLOTS as slot, index (slot)}
      <button
        type="button"
        class="tab"
        class:active={telemetry.console === slot}
        disabled={!AVAILABLE.includes(slot)}
        onclick={() => {
          showReport = false;
          mission.switchConsole(slot);
        }}
      >
        <span class="key">{consoleHotkey(index)}</span>
        {LABELS[slot]}
      </button>
    {/each}
    <button
      type="button"
      class="tab"
      class:active={telemetry.plannerOpen}
      disabled={telemetry.phase !== 'HOLD' && !telemetry.missionOver}
      onclick={() => (telemetry.plannerOpen ? mission.closePlanner() : mission.openPlanner())}
    >
      <span class="key">{keyLabel(bindings.togglePlanner)}</span>
      {strings.consoles.planner}
    </button>
    <button
      type="button"
      class="tab"
      class:active={showReport}
      disabled={!telemetry.missionOver}
      onclick={() => {
        mission.closePlanner();
        showReport = true;
      }}
    >
      <span class="key">·</span>
      {strings.consoles.postMortem}
    </button>
  </nav>

  {#if telemetry.plannerOpen}
    <ConfiguratorConsole {mission} />
  {:else if showReport}
    <PostMortemConsole {mission} />
  {:else if telemetry.console === 'comms'}
    <CommsConsole {mission} />
  {:else if telemetry.console === 'engineering'}
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

  .saved {
    color: #6dfcae;
    opacity: 0.7;
    margin-left: 0.35rem;
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

  .keys {
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 3px;
    padding: 0.7rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .keys header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .keys h2 {
    margin: 0;
    font-size: 0.6rem;
    letter-spacing: 0.24em;
    opacity: 0.5;
  }

  .keys header div {
    display: flex;
    gap: 0.35rem;
  }

  .keys ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 0.35rem;
  }

  .keys li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.8rem;
    font-size: 0.66rem;
  }

  .keys .what {
    opacity: 0.7;
  }

  .binding {
    min-width: 6rem;
    text-align: center;
  }

  .binding.capturing {
    border-color: rgba(255, 194, 92, 0.7);
    color: #ffc25c;
  }

  .binding.unbound {
    border-color: rgba(255, 122, 107, 0.6);
    color: #ff7a6b;
  }

  .keys .note {
    margin: 0;
    font-size: 0.58rem;
    line-height: 1.5;
    opacity: 0.4;
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
