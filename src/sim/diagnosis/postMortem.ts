/**
 * The post-mortem (concept §7 ⑥, §5.4).
 *
 * Not a score screen: an account of what happened and what it cost. The
 * cause chain is the point — "measurement error → heater off → icing →
 * flameout" is a story the player can learn from, where "mission failed" is
 * not.
 *
 * Everything here is derived from state the simulation already holds. Nothing
 * is recorded for the post-mortem's benefit, which means the report cannot
 * drift from what actually happened.
 */
import type { Anomaly, AnomalyState } from '../systems/anomaly.js';
import { causeChain } from '../systems/anomaly.js';

import type { CauseGraph } from './causeGraph.js';
import type { DiagnosisResult } from './diagnosis.js';

export type AnomalyVerdict = 'resolved' | 'escalated' | 'open';

export interface AnomalyReport {
  readonly anomalyId: string;
  readonly causeId: string;
  readonly causeTitle: string;
  readonly verdict: AnomalyVerdict;
  /** Root first: what this fault came out of, if anything. */
  readonly chain: { readonly causeId: string; readonly title: string }[];
  /** Measures applied, in order, with what each one did. */
  readonly attempts: {
    readonly measureId: string;
    readonly title: string;
    readonly correct: boolean;
    readonly causedChain: string | null;
    readonly tick: number;
  }[];
  /** Diagnoses bought, and what they told the player. */
  readonly diagnoses: {
    readonly measureId: string;
    readonly title: string;
    readonly confirmed: string | null;
    readonly excluded: readonly string[];
    readonly tick: number;
  }[];
  /** Seconds of the escalation window that were used. */
  readonly secondsUsed: number;
  readonly windowSeconds: number;
}

export interface MissionReport {
  readonly lost: boolean;
  readonly anomalies: AnomalyReport[];
  /** Anomalies nobody addressed at all — the expensive kind of mistake. */
  readonly untouched: number;
  /** Diagnoses paid for across the mission. */
  readonly diagnosesBought: number;
  /** Wrong measures applied. */
  readonly wrongMeasures: number;
  /** Accepted loss-of-mission risk, as a fraction (§5.4). */
  readonly acceptedRisk: number;
}

function verdictOf(anomaly: Anomaly): AnomalyVerdict {
  if (anomaly.resolvedTick >= 0) return 'resolved';
  if (anomaly.escalatedTick >= 0) return 'escalated';
  return 'open';
}

/**
 * Builds the report.
 *
 * `acceptedRisk` is the static Phase 1 risk budget: the number shown before
 * launch, carried through so the post-mortem can say "you accepted 11 %, and
 * this is what turned up" (§5.4). Making it live is Phase 2's configurator.
 */
export function buildMissionReport(
  graph: CauseGraph,
  anomalies: AnomalyState,
  results: readonly DiagnosisResult[],
  lost: boolean,
  acceptedRisk: number,
  ticksPerSecond: number,
): MissionReport {
  const reports: AnomalyReport[] = anomalies.anomalies.map((anomaly) => {
    const chain = causeChain(anomalies, anomaly.id).map((entry) => ({
      causeId: entry.causeId,
      title: graph.cause(entry.causeId).title,
    }));

    const ended =
      anomaly.resolvedTick >= 0
        ? anomaly.resolvedTick
        : anomaly.escalatedTick >= 0
          ? anomaly.escalatedTick
          : anomaly.escalationTick;

    return {
      anomalyId: anomaly.id,
      causeId: anomaly.causeId,
      causeTitle: graph.cause(anomaly.causeId).title,
      verdict: verdictOf(anomaly),
      chain,
      attempts: anomaly.applied.map((applied) => ({
        measureId: applied.measureId,
        title: graph.measure(applied.measureId).title,
        correct: applied.correct,
        causedChain: applied.sideEffect === null ? null : graph.cause(applied.sideEffect).title,
        tick: applied.tick,
      })),
      diagnoses: results
        .filter((result) => result.anomalyId === anomaly.id)
        .map((result) => ({
          measureId: result.measureId,
          title: graph.measure(result.measureId).title,
          confirmed: result.confirmed === null ? null : graph.cause(result.confirmed).title,
          excluded: result.excluded.map((causeId) => graph.cause(causeId).title),
          tick: result.tick,
        })),
      secondsUsed: (ended - anomaly.onsetTick) / ticksPerSecond,
      windowSeconds: graph.escalationWindow_s(anomaly.causeId),
    };
  });

  return {
    lost,
    anomalies: reports,
    untouched: reports.filter(
      (report) => report.attempts.length === 0 && report.diagnoses.length === 0,
    ).length,
    diagnosesBought: results.length,
    wrongMeasures: reports.reduce(
      (sum, report) => sum + report.attempts.filter((attempt) => !attempt.correct).length,
      0,
    ),
    acceptedRisk,
  };
}

/**
 * The one-line verdict, in the shape §5.4 asks for: what was accepted, and
 * what turned up.
 */
export function verdictLine(report: MissionReport): string {
  const risk = `Risk accepted: ${Math.round(report.acceptedRisk * 100)} %.`;
  if (report.anomalies.length === 0) return `${risk} Nothing materialised.`;

  const decisive = report.anomalies.find((entry) => entry.verdict === 'escalated');
  if (report.lost && decisive !== undefined) {
    return `${risk} Materialised: ${decisive.causeTitle}. Vehicle lost.`;
  }
  if (decisive !== undefined) return `${risk} Materialised: ${decisive.causeTitle}.`;
  return `${risk} Materialised: ${report.anomalies[0].causeTitle} — resolved.`;
}
