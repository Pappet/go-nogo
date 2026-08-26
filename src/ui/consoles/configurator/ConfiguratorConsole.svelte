<script lang="ts">
  /**
   * The planner (concept §5.4, §4.1, §4.2).
   *
   * One screen, one question: what are you willing to not know? Every row is a
   * slot, every dial costs something, and the budget above updates as you
   * turn them. The range matters more than the midpoint — QA mostly buys a
   * smaller unknown rather than a better vehicle, and the panel is laid out to
   * make that visible rather than to hide it behind a single number.
   *
   * Changing anything here re-plans the mission. Only the slots you touched
   * get new hardware (§5.4): everything else keeps the exact parts it had.
   */
  import type { Mission } from '../../mission.svelte.js';
  import { QA_LEVELS, type QaLevel } from '../../../sim/parts/partInstance.js';
  import { uncertainty } from '../../../economy/riskBudget.js';
  import { qaLocked } from '../../../economy/doctrine.js';
  import { doctrines, qaLevels, staffTable, techTree } from '../../../missionConfig.js';
  import { nextStep } from '../../../economy/techTree.js';

  interface Props {
    mission: Mission;
  }

  const { mission }: Props = $props();
  const telemetry = $derived(mission.telemetry);

  const percent = (fraction: number): string => `${(fraction * 100).toFixed(1)} %`;
  const lineFor = (slotId: string) =>
    telemetry.risk.lines.find((line) => line.slotId === slotId);

  const changed = $derived(new Set(telemetry.pendingChanges));
  const dirty = $derived(telemetry.pendingChanges.length > 0);
</script>

<section class="planner">
  {#if telemetry.finances.ended}
    <p class="investor ended">
      ■ CAMPAIGN OVER — the investor has written the company off. A second
      bankruptcy ends it (§6.6).
    </p>
  {:else if telemetry.finances.takeovers > 0}
    <p class="investor">
      ▲ INVESTOR IN CONTROL — debt cleared, standing lost in every market.
      {#if telemetry.finances.dictatedRemaining > 0}
        {telemetry.finances.dictatedRemaining} contract{telemetry.finances.dictatedRemaining === 1
          ? ''
          : 's'} still dictated.
      {/if}
      {#if telemetry.frozenBranchIds.length > 0}
        Research frozen on {telemetry.frozenBranchIds
          .map((id) => techTree.branches.find((b) => b.id === id)?.title)
          .join(', ')}.
      {/if}
    </p>
  {:else if telemetry.campaign.capital < 0}
    <p class="investor warning">
      ▲ ACCOUNT IN THE RED — {telemetry.finances.weeksInDebt === 0 ? 'first week' : 'second week'}.
      Two in a row and the investor steps in.
    </p>
  {/if}

  <nav class="doctrines" aria-label="Doctrine">
    {#each doctrines as doctrine (doctrine.id)}
      <button
        type="button"
        class="doctrine"
        class:active={telemetry.doctrine.id === doctrine.id}
        onclick={() => mission.chooseDoctrine(doctrine.id)}
      >
        <span class="name">{doctrine.title}</span>
        <span class="summary-line">{doctrine.summary}</span>
        <span class="path">{doctrine.naturalPath}</span>
      </button>
    {/each}
  </nav>

  <section class="board">
    <header>
      <h2>WEEK {telemetry.campaign.week} · BOARD</h2>
      <div class="books">
        <span>CAPITAL <strong>{telemetry.campaign.capital}k</strong></span>
        {#each Object.entries(telemetry.campaign.reputation) as [market, standing] (market)}
          <span class="rep">
            {market}
            <strong class:red={standing < 0}>{standing > 0 ? `+${standing}` : standing}</strong>
          </span>
        {/each}
      </div>
    </header>

    <div class="offers">
      {#each telemetry.board as offer (offer.templateId)}
        <button
          type="button"
          class="offer"
          class:taken={telemetry.contract?.templateId === offer.templateId}
          onclick={() => mission.acceptContract(offer.templateId)}
        >
          <span class="market">{offer.market}</span>
          <span class="title">{offer.title}</span>
          <span class="terms">
            {offer.fee}k · penalty {offer.penalty}k · needs {offer.requiredQaLevel}
            {#if offer.maxAcceptedRisk < 1}· max {(offer.maxAcceptedRisk * 100).toFixed(0)} % LOM{/if}
            {#if offer.researchData > 0}· {offer.researchData} data{/if}
          </span>
        </button>
      {/each}
    </div>

    {#if telemetry.contract !== null && telemetry.contractShortfall.length > 0}
      <ul class="shortfall">
        {#each telemetry.contractShortfall as reason (reason)}
          <li>▲ {reason}</li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="research">
    <header>
      <h2>RESEARCH</h2>
      <span class="data">{telemetry.tech.data} data</span>
    </header>
    <div class="branches">
      {#each techTree.branches as branch (branch.id)}
        {@const step = nextStep(branch, telemetry.tech)}
        <article class="branch">
          <div class="head">
            <span class="title">{branch.title}</span>
            <span class="level">
              {#if telemetry.tech.forks[branch.id]}
                {branch.fork.options.find((o) => o.id === telemetry.tech.forks[branch.id])?.title}
              {:else}
                level {telemetry.tech.levels[branch.id] ?? 0}
              {/if}
            </span>
          </div>

          {#if step === null}
            <p class="done">Branch complete.</p>
          {:else if step.kind === 'level'}
            <button
              type="button"
              disabled={telemetry.tech.data < step.level.cost ||
                telemetry.frozenBranchIds.includes(branch.id)}
              onclick={() => mission.research(branch.id)}
            >
              {step.level.title} <small>{step.level.cost} data</small>
            </button>
            <p class="summary-line">{step.level.summary}</p>
          {:else}
            <p class="summary-line">
              Level {branch.fork.level}: one choice, once. It cannot be taken back.
            </p>
            <div class="fork">
              {#each branch.fork.options as option (option.id)}
                <button
                  type="button"
                  disabled={telemetry.tech.data < branch.fork.cost ||
                    telemetry.frozenBranchIds.includes(branch.id)}
                  onclick={() => mission.research(branch.id, option.id)}
                >
                  {option.title} <small>{branch.fork.cost} data</small>
                  <span class="risk">{option.risk}</span>
                </button>
              {/each}
            </div>
          {/if}
        </article>
      {/each}
    </div>
  </section>

  <section class="staff">
    <header>
      <h2>ENGINEERS</h2>
      <span class="wages">
        {telemetry.staff.hired.length}/{staffTable.maxEngineers} · {telemetry.weeklySalaries}k per week
      </span>
    </header>

    {#if telemetry.staff.hired.length > 0}
      <div class="hired">
        {#each telemetry.staff.hired as engineer (engineer.id)}
          <button type="button" onclick={() => mission.dismissEngineer(engineer.id)}>
            {engineer.name} <small>{engineer.specialty} · {engineer.salary}k</small>
            <span class="dismiss">dismiss</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="pool">
      {#each telemetry.staffPool as engineer (engineer.id)}
        {@const employed = telemetry.staff.hired.some((e) => e.id === engineer.id)}
        <button
          type="button"
          disabled={employed || telemetry.staff.hired.length >= staffTable.maxEngineers}
          onclick={() => mission.hireEngineer(engineer.id)}
        >
          {engineer.name} <small>{engineer.specialty} · {engineer.salary}k/wk</small>
        </button>
      {/each}
    </div>
    <p class="note">
      An engineer makes their own team faster to ask, and their guesses sharper. A second one in
      the same specialty costs the same and adds nothing.
    </p>
  </section>

  <header class="summary">
    <div class="headline">
      <span class="label">LOSS OF MISSION</span>
      <span class="value">
        {percent(telemetry.risk.lossOfMission[0])} – {percent(telemetry.risk.lossOfMission[1])}
      </span>
      <span class="spread">±{(uncertainty(telemetry.risk) * 50).toFixed(1)} points unknown</span>
    </div>
    <dl class="totals">
      <div>
        <dt>COST</dt>
        <dd>{telemetry.risk.cost}<small>k</small></dd>
      </div>
      <div>
        <dt>REDUNDANCY MASS</dt>
        <dd>{telemetry.risk.redundancyMass_kg.toFixed(0)}<small>kg</small></dd>
      </div>
    </dl>
  </header>

  <div class="slots">
    {#each telemetry.vehicle.slots as slot (slot.slotId)}
      {@const line = lineFor(slot.slotId)}
      <article class="slot" class:changed={changed.has(slot.slotId)}>
        <div class="identity">
          <h3>{line?.label ?? slot.partId}</h3>
          <span class="system">{line?.system ?? ''}</span>
        </div>

        <div class="dial qa">
          <span class="label">QUALITY ASSURANCE</span>
          <div class="options">
            {#each QA_LEVELS as level (level)}
              {@const locked = qaLocked(telemetry.doctrine, level)}
              <button
                type="button"
                class:active={slot.qaLevel === level}
                disabled={locked}
                title={locked ? telemetry.doctrine.lockedQaReason : ''}
                onclick={() => mission.setSlotQa(slot.slotId, level as QaLevel)}
              >
                {qaLevels[level].title}
                <small>{locked ? 'locked' : `×${qaLevels[level].costMultiplier}`}</small>
              </button>
            {/each}
          </div>
        </div>

        <div class="dial units">
          <span class="label">UNITS</span>
          <div class="stepper">
            <button
              type="button"
              disabled={slot.units <= 1}
              onclick={() => mission.setSlotUnits(slot.slotId, slot.units - 1)}>−</button
            >
            <span class="count">{slot.units}</span>
            <button
              type="button"
              disabled={slot.units >= 3}
              onclick={() => mission.setSlotUnits(slot.slotId, slot.units + 1)}>+</button
            >
          </div>
        </div>

        <div class="contribution">
          <span class="label">CONTRIBUTES</span>
          <span class="value">
            {percent(line?.contribution[0] ?? 0)} – {percent(line?.contribution[1] ?? 0)}
          </span>
        </div>
      </article>
    {/each}
  </div>

  <footer class="actions">
    <p class="note">
      {#if dirty}
        <strong>{telemetry.pendingChanges.length}</strong> slot{telemetry.pendingChanges.length === 1
          ? ''
          : 's'} changed. Those get new hardware; every other part stays the one it was.
      {:else}
        Nothing changed yet. Applying now would fly the identical vehicle.
      {/if}
    </p>
    <div class="buttons">
      <button type="button" onclick={() => mission.closePlanner()}>
        DISCARD <kbd>P</kbd>
      </button>
      <button type="button" class="primary" onclick={() => mission.applyPlan()}>
        BUILD AND ROLL OUT
      </button>
    </div>
  </footer>
</section>

<style>
  .planner {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .doctrines {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .doctrine {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    text-align: left;
    padding: 0.55rem 0.75rem;
  }

  .doctrine .name {
    font-size: 0.72rem;
    letter-spacing: 0.14em;
    color: #e8fff2;
  }

  .doctrine .summary-line {
    font-size: 0.62rem;
    opacity: 0.55;
    letter-spacing: 0.02em;
  }

  .doctrine .path {
    font-size: 0.55rem;
    letter-spacing: 0.16em;
    opacity: 0.35;
  }

  .doctrine.active {
    border-color: rgba(109, 252, 174, 0.6);
    background: rgba(109, 252, 174, 0.06);
  }

  .doctrine.active .name {
    color: #6dfcae;
  }

  .board {
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 3px;
    padding: 0.7rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }

  .board header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
  }

  .board h2 {
    margin: 0;
    font-size: 0.6rem;
    letter-spacing: 0.24em;
    opacity: 0.5;
  }

  .books {
    display: flex;
    gap: 1.1rem;
    white-space: nowrap;
    font-size: 0.58rem;
    letter-spacing: 0.14em;
    opacity: 0.55;
  }

  .books strong {
    color: #6dfcae;
    font-weight: normal;
    margin-left: 0.25rem;
  }

  .books strong.red {
    color: #ff7a6b;
  }

  .offers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 0.4rem;
  }

  .offer {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.18rem;
    text-align: left;
    padding: 0.5rem 0.65rem;
  }

  .offer .market {
    font-size: 0.52rem;
    letter-spacing: 0.2em;
    opacity: 0.4;
  }

  .offer .title {
    font-size: 0.7rem;
    color: #e8fff2;
  }

  .offer .terms {
    font-size: 0.58rem;
    opacity: 0.5;
    line-height: 1.4;
  }

  .offer.taken {
    border-color: rgba(109, 252, 174, 0.6);
    background: rgba(109, 252, 174, 0.06);
  }

  .offer.taken .title {
    color: #6dfcae;
  }

  .shortfall {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.62rem;
    color: #ffc25c;
  }

  .investor {
    margin: 0;
    border: 1px solid rgba(255, 194, 92, 0.5);
    background: rgba(255, 194, 92, 0.06);
    border-radius: 3px;
    padding: 0.55rem 0.8rem;
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    color: #ffc25c;
    line-height: 1.5;
  }

  .investor.ended {
    border-color: rgba(255, 122, 107, 0.6);
    background: rgba(255, 122, 107, 0.07);
    color: #ff7a6b;
  }

  .staff {
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 3px;
    padding: 0.7rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .staff header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .staff h2 {
    margin: 0;
    font-size: 0.6rem;
    letter-spacing: 0.24em;
    opacity: 0.5;
  }

  .wages {
    font-size: 0.62rem;
    opacity: 0.55;
  }

  .hired,
  .pool {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .hired button {
    border-color: rgba(109, 252, 174, 0.45);
    color: #6dfcae;
  }

  .hired .dismiss {
    font-size: 0.52rem;
    letter-spacing: 0.16em;
    opacity: 0.4;
    margin-left: 0.4rem;
  }

  .staff .note {
    margin: 0;
    font-size: 0.58rem;
    opacity: 0.4;
    line-height: 1.5;
  }

  .research {
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 3px;
    padding: 0.7rem 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .research header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  .research h2 {
    margin: 0;
    font-size: 0.6rem;
    letter-spacing: 0.24em;
    opacity: 0.5;
  }

  .research .data {
    font-size: 0.66rem;
    color: #6dfcae;
  }

  .branches {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.7rem;
  }

  .branch {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.35rem;
  }

  .branch > button {
    text-align: left;
  }

  .branch .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.6rem;
  }

  .branch .title {
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    color: #e8fff2;
  }

  .branch .level {
    font-size: 0.58rem;
    opacity: 0.5;
  }

  .branch .summary-line,
  .branch .done {
    margin: 0;
    font-size: 0.6rem;
    opacity: 0.45;
    line-height: 1.4;
  }

  .fork {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }

  .fork button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    text-align: left;
  }

  .fork .risk {
    font-size: 0.56rem;
    opacity: 0.5;
    line-height: 1.4;
  }

  .summary {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1.5rem;
    border: 1px solid rgba(255, 194, 92, 0.3);
    background: rgba(255, 194, 92, 0.04);
    border-radius: 3px;
    padding: 0.85rem 1rem;
  }

  .headline {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .headline .value {
    font-size: 1.6rem;
    color: #ffc25c;
    letter-spacing: 0.04em;
  }

  .headline .spread {
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    opacity: 0.5;
  }

  .label {
    font-size: 0.55rem;
    letter-spacing: 0.22em;
    opacity: 0.45;
  }

  .totals {
    display: flex;
    gap: 1.6rem;
    margin: 0;
  }

  .totals dt {
    font-size: 0.55rem;
    letter-spacing: 0.18em;
    opacity: 0.45;
  }

  .totals dd {
    margin: 0.2rem 0 0;
    font-size: 1.1rem;
    text-align: right;
  }

  .totals small {
    font-size: 0.6rem;
    opacity: 0.5;
    margin-left: 0.15rem;
  }

  .slots {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .slot {
    display: grid;
    grid-template-columns: minmax(150px, 1fr) minmax(300px, 2fr) auto minmax(120px, auto);
    align-items: center;
    gap: 1rem;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-left: 2px solid rgba(255, 255, 255, 0.12);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.02);
    padding: 0.6rem 0.85rem;
  }

  .slot.changed {
    border-left-color: #ffc25c;
    background: rgba(255, 194, 92, 0.05);
  }

  .identity h3 {
    margin: 0;
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    color: #e8fff2;
  }

  .identity .system {
    font-size: 0.55rem;
    letter-spacing: 0.2em;
    opacity: 0.4;
  }

  .dial {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .options {
    display: flex;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  button {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    color: inherit;
    font: inherit;
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    padding: 0.3rem 0.5rem;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    border-color: rgba(109, 252, 174, 0.45);
  }

  button:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .options button.active {
    border-color: rgba(109, 252, 174, 0.65);
    color: #6dfcae;
    background: rgba(109, 252, 174, 0.07);
  }

  .options button small {
    opacity: 0.45;
    margin-left: 0.3rem;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .stepper .count {
    min-width: 1.2rem;
    text-align: center;
    font-size: 0.85rem;
  }

  .contribution {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    text-align: right;
  }

  .contribution .value {
    font-size: 0.72rem;
    color: #ffc25c;
    white-space: nowrap;
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 0.7rem;
  }

  .note {
    margin: 0;
    font-size: 0.66rem;
    opacity: 0.6;
  }

  .note strong {
    color: #ffc25c;
  }

  .buttons {
    display: flex;
    gap: 0.5rem;
  }

  .buttons button {
    font-size: 0.66rem;
    letter-spacing: 0.14em;
    padding: 0.5rem 0.9rem;
  }

  .buttons .primary {
    border-color: rgba(109, 252, 174, 0.5);
    color: #6dfcae;
  }

  kbd {
    font: inherit;
    font-size: 0.85em;
    opacity: 0.45;
  }
</style>
