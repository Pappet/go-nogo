<script lang="ts">
  import type { MissionEvent } from '../../sim/countdown.js';
  import { formatMissionClock } from '../format.js';

  interface Props {
    events: MissionEvent[];
  }

  const { events }: Props = $props();

  /** Milestones deserve more weight than a switch being thrown. */
  function isMilestone(type: string): boolean {
    return type !== 'CHECKLIST';
  }
</script>

<section class="log" aria-label="Event log">
  <header>EVENT LOG</header>
  <ol>
    {#each events as event (event.tick + event.type)}
      <li class:milestone={isMilestone(event.type)}>
        <span class="time">{formatMissionClock(event.missionTime_s)}</span>
        <span class="message">{event.message}</span>
      </li>
    {:else}
      <li class="empty"><span class="message">Awaiting checklist…</span></li>
    {/each}
  </ol>
</section>

<style>
  .log {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  header {
    font-size: 0.62rem;
    letter-spacing: 0.2em;
    opacity: 0.45;
    padding-bottom: 0.45rem;
  }

  ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column-reverse;
    justify-content: flex-end;
    gap: 0.18rem;
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }

  li {
    display: grid;
    grid-template-columns: 5.6rem 1fr;
    gap: 0.6rem;
    font-size: 0.73rem;
    opacity: 0.55;
    animation: arrive 260ms ease-out;
  }

  li.milestone {
    opacity: 1;
  }

  .time {
    font-variant-numeric: tabular-nums;
    opacity: 0.6;
  }

  .milestone .message {
    color: #6dfcae;
  }

  .empty {
    opacity: 0.3;
  }

  @keyframes arrive {
    from {
      opacity: 0;
      transform: translateY(3px);
    }
  }
</style>
