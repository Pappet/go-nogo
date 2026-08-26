<script lang="ts">
  /**
   * The POST-MORTEM console (concept §7 ⑥, §5.4).
   *
   * Not a score screen. The cause chain is the payload: "measurement error →
   * heater off → icing → flameout" is something a player can learn from, where
   * "mission failed" is not. Everything on this screen is derived from state
   * the simulation already holds, so the account cannot drift from the flight.
   *
   * §5.4's two retry buttons close it. The first is exact — same seed, same
   * configuration. The second is not, and says so: §5.4 wants the planner to
   * reopen and only the changed parts to re-roll, and Phase 1 has no planner.
   */
  import { Mission } from '../../mission.svelte.js';

  interface Props {
    mission: Mission;
  }

  const { mission }: Props = $props();
  const telemetry = $derived(mission.telemetry);
  const report = $derived(telemetry.report);

  const percent = (fraction: number): string => `${(fraction * 100).toFixed(1)} %`;

  const VERDICT_LABEL: Record<string, string> = {
    resolved: 'RESOLVED',
    escalated: 'ESCALATED',
    open: 'NEVER CLOSED',
  };
</script>

<section class="postmortem">
  {#if report === null}
    <p class="quiet">The flight is still running.</p>
  {:else}
    <header class="verdict" class:lost={report.lost}>
      <h2>{report.lost ? 'VEHICLE LOST' : 'MISSION COMPLETE'}</h2>
      <p>{telemetry.verdict}</p>
    </header>

    <div class="grid">
      <section class="panel budget">
        <h3>RISK BUDGET AS FLOWN</h3>
        <p class="headline">
          {percent(telemetry.risk.lossOfMission[0])}–{percent(telemetry.risk.lossOfMission[1])}<span
            >loss of mission</span
          >
        </p>
        <ul>
          {#each telemetry.risk.lines as line (line.slotId)}
            <li>
              <span class="label">
                {line.label}{#if line.units > 1}<em> ×{line.units}</em>{/if} · {line.qaLevel}
              </span>
              <span class="value">
                {percent(line.contribution[0])}–{percent(line.contribution[1])}
              </span>
            </li>
          {/each}
        </ul>
        <p class="footnote">
          What the vehicle was priced at before it flew, worst line first. The spread is what was
          never paid to find out.
        </p>
      </section>

      <section class="panel tally">
        <h3>THE FLIGHT IN NUMBERS</h3>
        <dl>
          <div>
            <dt>ANOMALIES</dt>
            <dd>{report.anomalies.length}</dd>
          </div>
          <div>
            <dt>DIAGNOSES BOUGHT</dt>
            <dd>{report.diagnosesBought}</dd>
          </div>
          <div>
            <dt>WRONG MEASURES</dt>
            <dd class:bad={report.wrongMeasures > 0}>{report.wrongMeasures}</dd>
          </div>
          <div>
            <dt>NEVER TOUCHED</dt>
            <dd class:bad={report.untouched > 0}>{report.untouched}</dd>
          </div>
        </dl>
      </section>
    </div>

    {#if report.anomalies.length === 0}
      <p class="quiet">Nothing materialised. The budget was paid for a flight that stayed quiet.</p>
    {:else}
      <div class="anomalies">
        {#each report.anomalies as anomaly (anomaly.anomalyId)}
          <article class="panel anomaly" class:escalated={anomaly.verdict === 'escalated'}>
            <header>
              <h3>{anomaly.causeTitle}</h3>
              <span class="badge {anomaly.verdict}">{VERDICT_LABEL[anomaly.verdict]}</span>
            </header>

            {#if anomaly.chain.length > 1}
              <p class="chain">
                {#each anomaly.chain as link, index (link.causeId)}
                  {#if index > 0}<span class="arrow">→</span>{/if}<span
                    class="link"
                    class:self={link.causeId === anomaly.causeId}>{link.title}</span
                  >
                {/each}
              </p>
            {/if}

            <p class="window">
              {anomaly.secondsUsed.toFixed(1)} s of a {anomaly.windowSeconds.toFixed(0)} s window
            </p>

            {#if anomaly.diagnoses.length === 0 && anomaly.attempts.length === 0}
              <p class="quiet">Nobody looked at it.</p>
            {:else}
              <ol class="log">
                {#each anomaly.diagnoses as diagnosis (diagnosis.measureId + diagnosis.tick)}
                  <li class="diagnosis">
                    <span class="what">{diagnosis.title}</span>
                    <span class="said">
                      {#if diagnosis.confirmed !== null}
                        confirmed {diagnosis.confirmed}
                      {:else if diagnosis.excluded.length > 0}
                        ruled out {diagnosis.excluded.join(', ')}
                      {:else}
                        told you nothing new
                      {/if}
                    </span>
                  </li>
                {/each}
                {#each anomaly.attempts as attempt (attempt.measureId + attempt.tick)}
                  <li class="attempt" class:wrong={!attempt.correct}>
                    <span class="what">{attempt.title}</span>
                    <span class="said">
                      {#if attempt.correct}
                        fixed it
                      {:else if attempt.causedChain !== null}
                        wrong — and it set off {attempt.causedChain}
                      {:else}
                        wrong — no effect
                      {/if}
                    </span>
                  </li>
                {/each}
              </ol>
            {/if}
          </article>
        {/each}
      </div>
    {/if}

    <footer class="retry">
      <button type="button" class="primary" onclick={() => mission.retrySameMission()}>
        SAME SEED, SAME CONFIGURATION
        <small>The identical run. Diagnose it properly this time.</small>
      </button>
      <button type="button" onclick={() => mission.retryNewMission()}>
        NEW MISSION
        <small>A fresh draw — everything re-rolls. The configurator arrives in Phase 2.</small>
      </button>
    </footer>
  {/if}
</section>

<style>
  .postmortem {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }

  .panel {
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.02);
    padding: 0.75rem 0.9rem;
  }

  h3 {
    margin: 0 0 0.6rem;
    font-size: 0.6rem;
    letter-spacing: 0.24em;
    opacity: 0.5;
  }

  .verdict {
    border: 1px solid rgba(109, 252, 174, 0.35);
    border-radius: 3px;
    padding: 0.9rem 1rem;
    background: rgba(109, 252, 174, 0.05);
  }

  .verdict.lost {
    border-color: rgba(255, 92, 92, 0.5);
    background: rgba(255, 92, 92, 0.06);
  }

  .verdict h2 {
    margin: 0;
    font-size: 1.1rem;
    letter-spacing: 0.3em;
    color: #6dfcae;
  }

  .verdict.lost h2 {
    color: #ff7a6b;
  }

  .verdict p {
    margin: 0.45rem 0 0;
    font-size: 0.78rem;
    letter-spacing: 0.05em;
    opacity: 0.85;
  }

  .grid {
    display: grid;
    grid-template-columns: 1.3fr 1fr;
    gap: 0.7rem;
  }

  .headline {
    margin: 0 0 0.5rem;
    font-size: 1.5rem;
    color: #ffc25c;
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  .headline span {
    font-size: 0.58rem;
    letter-spacing: 0.2em;
    opacity: 0.5;
    color: #cfe8dc;
  }

  .budget ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.28rem;
  }

  .budget li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.68rem;
    border-bottom: 1px dotted rgba(255, 255, 255, 0.08);
    padding-bottom: 0.24rem;
  }

  .budget .label {
    opacity: 0.75;
  }

  .budget .value {
    color: #ffc25c;
    white-space: nowrap;
  }

  .budget .label em {
    font-style: normal;
    color: #6dfcae;
  }

  .footnote {
    margin: 0.6rem 0 0;
    font-size: 0.6rem;
    line-height: 1.5;
    opacity: 0.4;
  }

  .tally dl {
    margin: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }

  .tally dt {
    font-size: 0.55rem;
    letter-spacing: 0.18em;
    opacity: 0.45;
  }

  .tally dd {
    margin: 0.2rem 0 0;
    font-size: 1.3rem;
    color: #cfe8dc;
  }

  .tally dd.bad {
    color: #ff7a6b;
  }

  .anomalies {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .anomaly header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.5rem;
  }

  .anomaly h3 {
    margin: 0;
    font-size: 0.78rem;
    letter-spacing: 0.1em;
    opacity: 1;
    color: #e8fff2;
  }

  .anomaly.escalated {
    border-color: rgba(255, 122, 107, 0.35);
  }

  .badge {
    font-size: 0.55rem;
    letter-spacing: 0.18em;
    padding: 0.14rem 0.42rem;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 2px;
    opacity: 0.8;
  }

  .badge.resolved {
    color: #6dfcae;
    border-color: rgba(109, 252, 174, 0.45);
  }

  .badge.escalated {
    color: #ff7a6b;
    border-color: rgba(255, 122, 107, 0.5);
  }

  .badge.open {
    color: #ffc25c;
    border-color: rgba(255, 194, 92, 0.45);
  }

  .chain {
    margin: 0 0 0.45rem;
    font-size: 0.7rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  .chain .arrow {
    opacity: 0.35;
  }

  .chain .link {
    opacity: 0.6;
  }

  .chain .link.self {
    opacity: 1;
    color: #ffc25c;
  }

  .window {
    margin: 0 0 0.5rem;
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    opacity: 0.45;
  }

  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .log li {
    display: flex;
    gap: 0.6rem;
    font-size: 0.68rem;
    border-left: 2px solid rgba(255, 255, 255, 0.12);
    padding-left: 0.55rem;
  }

  .log .what {
    min-width: 12rem;
    opacity: 0.85;
  }

  .log .said {
    opacity: 0.55;
  }

  .log .attempt {
    border-left-color: rgba(109, 252, 174, 0.5);
  }

  .log .attempt.wrong {
    border-left-color: rgba(255, 122, 107, 0.6);
  }

  .log .attempt.wrong .said {
    color: #ff7a6b;
    opacity: 0.85;
  }

  .quiet {
    margin: 0;
    font-size: 0.7rem;
    opacity: 0.5;
  }

  .retry {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.7rem;
  }

  .retry button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
    text-align: left;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 3px;
    color: inherit;
    font: inherit;
    font-size: 0.68rem;
    letter-spacing: 0.14em;
    padding: 0.7rem 0.85rem;
    cursor: pointer;
  }

  .retry button:hover {
    border-color: rgba(109, 252, 174, 0.5);
  }

  .retry button.primary {
    border-color: rgba(109, 252, 174, 0.4);
    color: #6dfcae;
  }

  .retry small {
    font-size: 0.6rem;
    letter-spacing: 0.04em;
    opacity: 0.5;
    color: #cfe8dc;
  }
</style>
