<script lang="ts">
  /**
   * The ENGINEERING console (concept §7 ④).
   *
   * Symptoms on the left, candidates weighted by context in the middle,
   * measures with their costs on the right — and above all of it the clock
   * that makes the decision urgent. The act-without-certainty row is
   * deliberately not hidden behind a confirmation: acting on a hunch is a
   * legitimate play, and the console's job is to price it, not to prevent it.
   */
  import type { Mission } from '../../mission.svelte.js';
  import { panelActionHotkey } from '../../hotkeys.js';
  import { strings } from '../../strings.js';
  import CandidateBars from '../../widgets/CandidateBars.svelte';
  import CommandTimeline from '../../widgets/CommandTimeline.svelte';

  interface Props {
    mission: Mission;
  }

  const { mission }: Props = $props();
  const telemetry = $derived(mission.telemetry);

  const focused = $derived(telemetry.anomalies[0] ?? null);
  const diagnoses = $derived(telemetry.measures.filter((measure) => measure.kind === 'diagnosis'));
  /**
   * Offered first, spent after. The hotkeys address the offered ones, so a
   * diagnosis that can no longer tell the survivors apart must not sit on Q.
   */
  const offered = $derived(diagnoses.filter((measure) => !measure.redundant));
  const spent = $derived(diagnoses.filter((measure) => measure.redundant));
  const resolutions = $derived(
    telemetry.measures.filter((measure) => measure.kind === 'resolution'),
  );

  const titleOf = (measureId: string): string =>
    telemetry.measures.find((measure) => measure.id === measureId)?.title ?? measureId;

  function act(measureId: string): void {
    if (focused === null) return;
    mission.queueMeasure(measureId, focused.id);
  }

  /** Under ten seconds the clock is the only thing that matters. */
  const critical = $derived(focused !== null && focused.secondsToEscalation <= 10);
</script>

<section class="engineering">
  {#if focused === null}
    <div class="quiet">
      <h2>{strings.engineering.noAnomaly}</h2>
      <p>{strings.engineering.noAnomalyBody}</p>
    </div>
  {:else}
    <header class="crisis" class:critical>
      <div class="clock">
        <span class="label">{strings.engineering.escalationIn}</span>
        <span class="value">{Math.max(0, focused.secondsToEscalation).toFixed(1)}<small>s</small></span>
        <div class="track">
          <div
            class="fill"
            style="width: {Math.max(
              0,
              Math.min(100, (focused.secondsToEscalation / focused.escalationWindow_s) * 100),
            )}%"
          ></div>
        </div>
      </div>

      <div class="channels">
        <span class="label">{strings.engineering.channels}</span>
        <div class="matrix">
          {#each Array(telemetry.channels.capacity) as _, index (index)}
            <span class="channel" class:live={index < telemetry.channels.inUse}></span>
          {/each}
        </div>
        <span class="count">{telemetry.channels.inUse}/{telemetry.channels.capacity}</span>
      </div>
    </header>

    <div class="grid">
      <section class="panel">
        <h3>{strings.engineering.reported}</h3>
        <ul class="symptoms">
          {#each focused.symptoms as symptom (symptom.title)}
            <li>
              <span class="strength" style="opacity: {0.45 + symptom.strength * 0.55}">▲</span>
              <span>{symptom.title}</span>
            </li>
          {:else}
            <li class="empty">{strings.engineering.waitingForReading}</li>
          {/each}
        </ul>
      </section>

      <section class="panel">
        <h3>{strings.engineering.candidates}</h3>
        <CandidateBars candidates={focused.candidates} titles={focused.candidateTitles} />
      </section>

      <section class="panel">
        <h3>{strings.engineering.diagnose}</h3>
        <ul class="measures">
          {#each offered as measure, index (measure.id)}
            <li>
              <button type="button" onclick={() => act(measure.id)}>
                <span class="key">{panelActionHotkey(index)}</span>
                <span class="name">{measure.title}</span>
                <span class="cost">{measure.duration_s}s · {measure.occupies.length}</span>
              </button>
            </li>
          {/each}
          {#each spent as measure (measure.id)}
            <li>
              <button type="button" disabled title="Cannot separate the remaining candidates">
                <span class="key">—</span>
                <span class="name">{measure.title}</span>
                <span class="cost">{measure.duration_s}s · {measure.occupies.length}</span>
              </button>
            </li>
          {/each}
        </ul>

        <h3 class="act">{strings.engineering.actWithoutCertainty}</h3>
        <ul class="measures">
          {#each resolutions as measure (measure.id)}
            <li>
              <button type="button" class="resolution" onclick={() => act(measure.id)}>
                <span class="name">{measure.title}</span>
                <span class="cost">{measure.duration_s}s</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    </div>

    <section class="panel timeline">
      <h3>{strings.engineering.commandTimeline}</h3>
      <CommandTimeline
        timeline={telemetry.timeline}
        now={mission.currentTick}
        secondsToEscalation={focused.secondsToEscalation}
        {titleOf}
      />
    </section>
  {/if}
</section>

<style>
  .engineering {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    min-height: 0;
    flex: 1;
  }

  .quiet {
    flex: 1;
    display: grid;
    place-content: center;
    text-align: center;
    gap: 0.4rem;
    opacity: 0.45;
  }

  .quiet h2 {
    margin: 0;
    font-size: 0.8rem;
    letter-spacing: 0.24em;
  }

  .quiet p {
    margin: 0;
    font-size: 0.7rem;
    max-width: 32rem;
  }

  .crisis {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 1.2rem;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 4px;
    padding: 0.7rem 0.95rem;
    background: rgba(255, 255, 255, 0.016);
  }

  .crisis.critical {
    border-color: rgba(255, 138, 92, 0.5);
    box-shadow: 0 0 18px rgba(255, 138, 92, 0.12);
  }

  .label {
    font-size: 0.55rem;
    letter-spacing: 0.2em;
    opacity: 0.45;
  }

  .clock {
    display: grid;
    grid-template-columns: auto auto;
    align-items: baseline;
    gap: 0.5rem 0.8rem;
  }

  .clock .value {
    font-size: 1.5rem;
    color: #6dfcae;
    font-variant-numeric: tabular-nums;
  }

  .critical .clock .value {
    color: #ff8a5c;
  }

  .clock small {
    font-size: 0.7rem;
    opacity: 0.6;
  }

  .clock .track {
    grid-column: 1 / -1;
    height: 0.3rem;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 2px;
    overflow: hidden;
  }

  .clock .fill {
    height: 100%;
    background: #6dfcae;
    transition: width 120ms linear;
  }

  .critical .clock .fill {
    background: #ff8a5c;
  }

  .channels {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .matrix {
    display: flex;
    gap: 0.2rem;
  }

  .channel {
    width: 0.85rem;
    height: 1.1rem;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 2px;
    background: rgba(0, 0, 0, 0.45);
  }

  .channel.live {
    background: #6dfcae;
    border-color: #6dfcae;
    box-shadow: 0 0 7px rgba(109, 252, 174, 0.5);
  }

  .count {
    font-size: 0.68rem;
    font-variant-numeric: tabular-nums;
    opacity: 0.65;
  }

  .grid {
    display: grid;
    grid-template-columns: minmax(200px, 1fr) minmax(220px, 1.1fr) minmax(230px, 1.1fr);
    gap: 0.9rem;
    min-height: 0;
  }

  .panel {
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.016);
    padding: 0.8rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    min-height: 0;
  }

  h3 {
    margin: 0;
    font-size: 0.58rem;
    letter-spacing: 0.22em;
    opacity: 0.45;
    font-weight: 400;
  }

  h3.act {
    margin-top: 0.4rem;
    color: #ff8a5c;
    opacity: 0.7;
  }

  .symptoms,
  .measures {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .symptoms li {
    display: grid;
    grid-template-columns: 1rem 1fr;
    gap: 0.4rem;
    font-size: 0.73rem;
    color: #e8fff2;
  }

  .strength {
    color: #ffc25c;
  }

  .empty {
    opacity: 0.35;
  }

  .measures button {
    display: grid;
    grid-template-columns: 1.3rem 1fr auto;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.42rem 0.55rem;
    background: rgba(255, 255, 255, 0.028);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: inherit;
    font: inherit;
    font-size: 0.71rem;
    text-align: left;
    cursor: pointer;
  }

  .measures button:hover:not(:disabled) {
    border-color: rgba(109, 252, 174, 0.45);
  }

  .measures button:disabled {
    opacity: 0.32;
    cursor: default;
  }

  .measures .resolution {
    grid-template-columns: 1fr auto;
    border-color: rgba(255, 138, 92, 0.25);
  }

  .measures .resolution:hover {
    border-color: rgba(255, 138, 92, 0.65);
  }

  .key {
    font-size: 0.6rem;
    opacity: 0.5;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 2px;
    text-align: center;
    line-height: 1.3;
  }

  .cost {
    font-size: 0.62rem;
    opacity: 0.55;
    font-variant-numeric: tabular-nums;
  }

  .timeline {
    max-height: 12rem;
  }

  @media (max-width: 1000px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
