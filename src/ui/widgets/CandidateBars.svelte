<script lang="ts">
  /**
   * The candidate bars (concept §7 ④).
   *
   * Probability, not certainty: the bars weigh what the context argues for,
   * and every candidate keeps a share until a diagnosis rules it out. The
   * matched tags are shown because a bar without a reason is just a number the
   * player has to trust.
   */
  import type { CandidatePrior } from '../../sim/diagnosis/priors.js';

  interface Props {
    candidates: CandidatePrior[];
    titles: Record<string, string>;
  }

  const { candidates, titles }: Props = $props();
</script>

<ul class="bars">
  {#each candidates as candidate (candidate.causeId)}
    <li>
      <div class="row">
        <span class="title">{titles[candidate.causeId] ?? candidate.causeId}</span>
        <span class="value">{Math.round(candidate.probability * 100)}%</span>
      </div>
      <div class="track">
        <div class="fill" style="width: {candidate.probability * 100}%"></div>
      </div>
      {#if candidate.matchedTags.length > 0}
        <div class="tags">
          {#each candidate.matchedTags as tag (tag)}<span>{tag.replace(/_/g, ' ')}</span>{/each}
        </div>
      {/if}
    </li>
  {:else}
    <li class="empty">No candidates — nothing is being reported.</li>
  {/each}
</ul>

<style>
  .bars {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6rem;
    font-size: 0.75rem;
  }

  .title {
    color: #e8fff2;
  }

  .value {
    font-variant-numeric: tabular-nums;
    opacity: 0.75;
  }

  .track {
    height: 0.4rem;
    margin-top: 0.2rem;
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 2px;
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: linear-gradient(90deg, rgba(109, 252, 174, 0.45), #6dfcae);
    transition: width 160ms linear;
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.25rem;
  }

  .tags span {
    font-size: 0.55rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.5;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    padding: 0 0.25rem;
  }

  .empty {
    font-size: 0.72rem;
    opacity: 0.4;
  }
</style>
