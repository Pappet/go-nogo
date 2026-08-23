<script lang="ts">
  /**
   * A checklist switch. Reads NO GO until thrown, GO after — the wording the
   * poll uses, so the console speaks one language throughout.
   */
  interface Props {
    label: string;
    hotkey: string;
    checked: boolean;
    disabled?: boolean;
    onToggle: () => void;
  }

  const { label, hotkey, checked, disabled = false, onToggle }: Props = $props();
</script>

<button
  type="button"
  class="switch"
  class:go={checked}
  {disabled}
  onclick={onToggle}
  aria-pressed={checked}
>
  <span class="key">{hotkey}</span>
  <span class="lever" aria-hidden="true"><span class="knob"></span></span>
  <span class="label">{label}</span>
  <span class="state">{checked ? 'GO' : 'NO GO'}</span>
</button>

<style>
  .switch {
    display: grid;
    grid-template-columns: 1.4rem 1.5rem 1fr auto;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.5rem 0.7rem;
    background: rgba(255, 255, 255, 0.028);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 3px;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 120ms, background 120ms;
  }

  .switch:hover:not(:disabled) {
    border-color: rgba(109, 252, 174, 0.4);
  }

  .switch:disabled {
    cursor: default;
    opacity: 0.75;
  }

  .key {
    font-size: 0.65rem;
    opacity: 0.45;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 2px;
    text-align: center;
    line-height: 1.3;
  }

  .lever {
    position: relative;
    width: 1.5rem;
    height: 0.85rem;
    background: rgba(0, 0, 0, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 2px;
  }

  .knob {
    position: absolute;
    inset: 1px auto 1px 1px;
    width: 0.55rem;
    background: #8a9a92;
    border-radius: 1px;
    transition: transform 110ms ease-out, background 110ms;
  }

  .go .knob {
    transform: translateX(0.62rem);
    background: #6dfcae;
    box-shadow: 0 0 6px rgba(109, 252, 174, 0.6);
  }

  .label {
    font-size: 0.78rem;
    letter-spacing: 0.09em;
  }

  .state {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    color: #ff8a5c;
  }

  .go .state {
    color: #6dfcae;
  }
</style>
