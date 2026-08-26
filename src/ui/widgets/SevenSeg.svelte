<script lang="ts">
  /**
   * A seven-segment readout drawn as SVG.
   *
   * Real segments rather than a font: the unlit segments stay faintly visible,
   * which is what makes a digital display read as hardware instead of as text.
   */
  interface Props {
    value: string;
    /** Height of one digit in px; everything else scales from it. */
    size?: number;
    tone?: 'green' | 'amber';
  }

  const { value, size = 44, tone = 'green' }: Props = $props();

  const DIGIT_WIDTH = 12;
  const DIGIT_HEIGHT = 22;

  // Which segments each character lights.
  const SEGMENTS: Record<string, string[]> = {
    '0': ['a', 'b', 'c', 'd', 'e', 'f'],
    '1': ['b', 'c'],
    '2': ['a', 'b', 'g', 'e', 'd'],
    '3': ['a', 'b', 'g', 'c', 'd'],
    '4': ['f', 'g', 'b', 'c'],
    '5': ['a', 'f', 'g', 'c', 'd'],
    '6': ['a', 'f', 'g', 'e', 'c', 'd'],
    '7': ['a', 'b', 'c'],
    '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    '9': ['a', 'b', 'c', 'd', 'f', 'g'],
    '-': ['g'],
  };

  function horizontal(y: number): string {
    return `2,${y} 3.5,${y - 1.5} 8.5,${y - 1.5} 10,${y} 8.5,${y + 1.5} 3.5,${y + 1.5}`;
  }

  function vertical(x: number, top: number, bottom: number): string {
    return `${x},${top} ${x + 1.5},${top + 1.5} ${x + 1.5},${bottom - 1.5} ${x},${bottom} ${x - 1.5},${bottom - 1.5} ${x - 1.5},${top + 1.5}`;
  }

  const SHAPES: Record<string, string> = {
    a: horizontal(2),
    g: horizontal(11),
    d: horizontal(20),
    f: vertical(2, 2, 11),
    b: vertical(10, 2, 11),
    e: vertical(2, 11, 20),
    c: vertical(10, 11, 20),
  };

  const ALL = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

  interface Glyph {
    char: string;
    x: number;
  }

  const glyphs = $derived.by(() => {
    const out: Glyph[] = [];
    let x = 0;
    for (const char of value) {
      out.push({ char, x });
      x += char === ':' || char === '.' ? DIGIT_WIDTH * 0.45 : DIGIT_WIDTH + 4;
    }
    return out;
  });

  const totalWidth = $derived(
    glyphs.length === 0
      ? 0
      : glyphs[glyphs.length - 1].x + (isPunctuation(glyphs[glyphs.length - 1].char) ? 6 : DIGIT_WIDTH),
  );

  function isPunctuation(char: string): boolean {
    return char === ':' || char === '.';
  }

  /**
   * Whether the whole readout has to be drawn as text instead (§9).
   *
   * Per-character fallback is fine for a stray symbol, but it draws every
   * glyph in one digit's width — which is right for `-` and wrong for anything
   * wider. Once a string carries non-ASCII, the segments are the wrong display
   * for it entirely, so the widget stops pretending and renders the text. This
   * costs nothing now and is the expensive thing to retrofit later.
   */
  const textFallback = $derived([...value].some((char) => char.charCodeAt(0) > 127));
  const textWidth = $derived(Math.max(1, value.length) * (DIGIT_WIDTH * 0.62));
</script>

<svg
  class="seven-seg {tone}"
  viewBox="0 0 {textFallback ? textWidth : totalWidth} {DIGIT_HEIGHT + 2}"
  height={size}
  role="img"
  aria-label={value}
>
  {#if textFallback}
    <text class="lit-text wide" x={textWidth / 2} y="17" text-anchor="middle">{value}</text>
  {/if}
  {#each textFallback ? [] : glyphs as glyph (glyph.x)}
    <g transform="translate({glyph.x}, 1)">
      {#if glyph.char === ':'}
        <circle class="lit" cx="2" cy="7.5" r="1.3" />
        <circle class="lit" cx="2" cy="15.5" r="1.3" />
      {:else if glyph.char === '.'}
        <circle class="lit" cx="2" cy="19.5" r="1.4" />
      {:else if SEGMENTS[glyph.char]}
        {#each ALL as segment (segment)}
          <polygon
            class={SEGMENTS[glyph.char].includes(segment) ? 'lit' : 'dim'}
            points={SHAPES[segment]}
          />
        {/each}
      {:else}
        <text class="lit-text" x="6" y="18" text-anchor="middle">{glyph.char}</text>
      {/if}
    </g>
  {/each}
</svg>

<style>
  .seven-seg {
    display: block;
  }

  .green .lit,
  .green .lit-text {
    fill: #6dfcae;
    filter: drop-shadow(0 0 4px rgba(109, 252, 174, 0.55));
  }

  .amber .lit,
  .amber .lit-text {
    fill: #ffc25c;
    filter: drop-shadow(0 0 4px rgba(255, 194, 92, 0.5));
  }

  .dim {
    fill: rgba(255, 255, 255, 0.055);
  }

  .lit-text.wide {
    font-size: 13px;
    letter-spacing: 0.08em;
  }

  .lit-text {
    font-family: inherit;
    font-size: 15px;
    font-weight: 700;
  }
</style>
