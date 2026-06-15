import { AgentAutonomy } from './autonomy';

// Pure, browser-safe.

export interface TrustStats {
  executed: number;     // EXECUTED proposals (auto + approved)
  rejected: number;     // human-rejected proposals
  failed: number;       // FAILED proposals
  runsSucceeded: number;
  runsTotal: number;
  breakerTrips: number;
}

export interface TrustResult {
  score: number;        // 0..100
  readyForNext: boolean;
  nextLevel: AgentAutonomy | null;
  reasons: string[];
}

export const TRUST_PROMOTION = { minScore: 80, minActions: 25 } as const;

function nextLevelOf(level: AgentAutonomy): AgentAutonomy | null {
  if (level === AgentAutonomy.PROPOSE) return AgentAutonomy.ACT_LOW;
  if (level === AgentAutonomy.ACT_LOW) return AgentAutonomy.AUTONOMOUS;
  return null;
}

/**
 * 0..100 trust score from an agent's track record. Approval rate and run success are the
 * positive signals; failures and breaker trips are penalties. `readyForNext` requires a
 * minimum action volume, a score over the threshold, and that a higher level exists.
 */
export function computeTrustScore(stats: TrustStats, level: AgentAutonomy): TrustResult {
  const decisions = stats.executed + stats.rejected;
  const approvalRate = decisions > 0 ? stats.executed / decisions : 0;
  const runRate = stats.runsTotal > 0 ? stats.runsSucceeded / stats.runsTotal : 1;
  const failurePenalty = stats.executed + stats.failed > 0 ? stats.failed / (stats.executed + stats.failed) : 0;

  let score = 100 * (0.5 * approvalRate + 0.4 * runRate);
  score += 10; // baseline credit for participating
  score -= 100 * 0.4 * failurePenalty;
  score -= stats.breakerTrips * 10;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const reasons: string[] = [];
  const next = nextLevelOf(level);
  const enoughVolume = stats.executed >= TRUST_PROMOTION.minActions;
  if (!next) reasons.push('Already at the highest autonomy level.');
  if (!enoughVolume) reasons.push(`Needs ${TRUST_PROMOTION.minActions} executed actions (has ${stats.executed}).`);
  if (score < TRUST_PROMOTION.minScore) reasons.push(`Score ${score} below ${TRUST_PROMOTION.minScore}.`);

  const readyForNext = !!next && enoughVolume && score >= TRUST_PROMOTION.minScore;
  return { score, readyForNext, nextLevel: readyForNext ? next : null, reasons };
}
