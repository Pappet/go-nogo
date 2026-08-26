<script lang="ts">
  import { strings } from '../strings.js';
  /**
   * The command timeline (concept §5.7).
   *
   * Queued measures drawn against the escalation marker, so "acting costs
   * time" is something the player plans against rather than a sentence they
   * are told. A measure still waiting for a resource is drawn hollow — that is
   * the moment bandwidth scarcity becomes visible.
   */
  import { TICKS_PER_SECOND } from '../../sim/engine.js';
  import type { ProjectedMeasure } from '../../sim/diagnosis/measures.js';

  interface Props {
    timeline: ProjectedMeasure[];
    now: number;
    secondsToEscalation: number;
    titleOf: (measureId: string) => string;
  }

  const { timeline, now, secondsToEscalation, titleOf }: Props = $props();

  /** Always show at least the escalation window, so the marker has a place. */
  const span = $derived(
    Math.max(
      secondsToEscalation > 0 ? secondsToEscalation : 0,
      ...timeline.map((entry) => (entry.endTick - now) / TICKS_PER_SECOND),
      10,
    ) * 1.08,
  );

  const percent = (seconds: number): number => Math.max(0, Math.min(100, (seconds / span) * 100));
</script>

<div class="timeline">
  <div class="axis">
    {#if secondsToEscalation > 0}
      <div class="escalation" style="left: {percent(secondsToEscalation)}%">
        <span>{strings.engineering.escalation}</span>
      </div>
    {/if}
  </div>

  <ul>
    {#each timeline as entry (entry.measureId + entry.startTick)}
      <li class:waiting={entry.waiting}>
        <span class="label">{titleOf(entry.measureId)}</span>
        <div class="lane">
          <div
            class="span"
            style="left: {percent((entry.startTick - now) / TICKS_PER_SECOND)}%; width: {percent(
              (entry.endTick - entry.startTick) / TICKS_PER_SECOND,
            )}%"
          ></div>
        </div>
        <span class="lands">+{Math.round((entry.endTick - now) / TICKS_PER_SECOND)}s</span>
      </li>
    {:else}
      <li class="empty"><span class="label">{strings.engineering.nothingQueued}</span></li>
    {/each}
  </ul>
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .axis {
    position: relative;
    height: 0.9rem;
    margin-left: 9.5rem;
    margin-right: 3rem;
  }

  .escalation {
    position: absolute;
    top: 0;
    bottom: -0.2rem;
    border-left: 1px dashed rgba(255, 138, 92, 0.8);
  }

  .escalation span {
    position: absolute;
    left: 0.2rem;
    top: 0;
    font-size: 0.5rem;
    letter-spacing: 0.14em;
    color: #ff8a5c;
    white-space: nowrap;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  li {
    display: grid;
    grid-template-columns: 9.5rem 1fr 3rem;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.68rem;
  }

  .label {
    opacity: 0.8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lane {
    position: relative;
    height: 0.5rem;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 2px;
  }

  .span {
    position: absolute;
    top: 0;
    bottom: 0;
    background: #6dfcae;
    border-radius: 2px;
    min-width: 2px;
  }

  .waiting .span {
    background: transparent;
    border: 1px dashed rgba(255, 194, 92, 0.8);
  }

  .lands {
    text-align: right;
    font-variant-numeric: tabular-nums;
    opacity: 0.6;
  }

  .empty {
    opacity: 0.35;
  }
</style>
