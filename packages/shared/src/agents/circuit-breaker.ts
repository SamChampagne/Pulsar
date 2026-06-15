// Pure, browser-safe.

export interface BreakerConfig {
  /** Trip after this many consecutive failures. */
  consecutiveFailures: number;
  /** How long a tripped breaker stays tripped before auto-rearming. */
  cooldownMs: number;
}

/** One past action outcome. `at` is an epoch-ms timestamp (passed in by the caller). */
export interface BreakerOutcome {
  failed: boolean;
  at: number;
}

export const DEFAULT_BREAKER: BreakerConfig = { consecutiveFailures: 3, cooldownMs: 15 * 60_000 };

/**
 * True iff the most recent `cfg.consecutiveFailures` outcomes are ALL failures.
 * `recent` MUST be ordered most-recent-first.
 */
export function evaluateCircuitBreaker(recent: BreakerOutcome[], cfg: BreakerConfig): boolean {
  if (recent.length < cfg.consecutiveFailures) return false;
  for (let i = 0; i < cfg.consecutiveFailures; i++) {
    if (!recent[i].failed) return false;
  }
  return true;
}
