<script lang="ts">
  /**
   * An arc gauge. The needle is the fast read; the number under it is the
   * precise one. A limit mark turns the arc amber past the threshold, so a
   * value in the caution band is visible without reading anything.
   */
  interface Props {
    label: string;
    value: number;
    max: number;
    unit: string;
    display?: string;
    /** Fraction of `max` where the caution band starts. */
    caution?: number;
  }

  const { label, value, max, unit, display, caution }: Props = $props();

  const SWEEP = 240;
  const START = 150;

  const fraction = $derived(Math.max(0, Math.min(1, max > 0 ? value / max : 0)));
  const angle = $derived(START + fraction * SWEEP);
  const inCaution = $derived(caution !== undefined && fraction >= caution);

  function polar(degrees: number, radius: number): { x: number; y: number } {
    const radians = (degrees * Math.PI) / 180;
    return { x: 50 + radius * Math.cos(radians), y: 50 + radius * Math.sin(radians) };
  }

  function arcPath(fromDegrees: number, toDegrees: number, radius: number): string {
    const from = polar(fromDegrees, radius);
    const to = polar(toDegrees, radius);
    const large = toDegrees - fromDegrees > 180 ? 1 : 0;
    return `M ${from.x} ${from.y} A ${radius} ${radius} 0 ${large} 1 ${to.x} ${to.y}`;
  }

  const needle = $derived(polar(angle, 33));
</script>

<figure class="gauge" class:caution={inCaution}>
  <svg viewBox="0 0 100 78" role="img" aria-label="{label} {display ?? value} {unit}">
    <path class="track" d={arcPath(START, START + SWEEP, 40)} />
    <path class="fill" d={arcPath(START, angle, 40)} />
    {#if caution !== undefined}
      <path class="limit" d={arcPath(START + caution * SWEEP, START + SWEEP, 40)} />
    {/if}
    <line class="needle" x1="50" y1="50" x2={needle.x} y2={needle.y} />
    <circle class="hub" cx="50" cy="50" r="3" />
  </svg>
  <figcaption>
    <span class="value">{display ?? value.toFixed(0)}</span>
    <span class="unit">{unit}</span>
    <span class="label">{label}</span>
  </figcaption>
</figure>

<style>
  .gauge {
    margin: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.1rem;
  }

  svg {
    width: 100%;
    max-width: 150px;
  }

  .track {
    fill: none;
    stroke: rgba(255, 255, 255, 0.08);
    stroke-width: 7;
    stroke-linecap: round;
  }

  .limit {
    fill: none;
    stroke: rgba(255, 138, 92, 0.35);
    stroke-width: 7;
    stroke-linecap: round;
  }

  .fill {
    fill: none;
    stroke: #6dfcae;
    stroke-width: 7;
    stroke-linecap: round;
    filter: drop-shadow(0 0 5px rgba(109, 252, 174, 0.45));
  }

  .caution .fill {
    stroke: #ff8a5c;
    filter: drop-shadow(0 0 5px rgba(255, 138, 92, 0.5));
  }

  .needle {
    stroke: #e8fff2;
    stroke-width: 1.6;
    stroke-linecap: round;
  }

  .hub {
    fill: #e8fff2;
  }

  figcaption {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
    font-variant-numeric: tabular-nums;
  }

  .value {
    font-size: 1.25rem;
    font-weight: 700;
    color: #e8fff2;
  }

  .caution .value {
    color: #ff8a5c;
  }

  .unit {
    font-size: 0.7rem;
    opacity: 0.65;
  }

  .label {
    font-size: 0.62rem;
    letter-spacing: 0.16em;
    opacity: 0.5;
    margin-left: 0.35rem;
  }
</style>
