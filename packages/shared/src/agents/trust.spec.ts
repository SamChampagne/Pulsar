import { describe, it, expect } from 'vitest';
import { AgentAutonomy } from './autonomy';
import { computeTrustScore, TRUST_PROMOTION } from './trust';

describe('computeTrustScore', () => {
  it('high approval + clean runs → high score, ready for next', () => {
    const r = computeTrustScore(
      { executed: 40, rejected: 1, failed: 0, runsSucceeded: 40, runsTotal: 41, breakerTrips: 0 },
      AgentAutonomy.PROPOSE,
    );
    expect(r.score).toBeGreaterThanOrEqual(TRUST_PROMOTION.minScore);
    expect(r.readyForNext).toBe(true);
  });
  it('not ready below the minimum action volume', () => {
    const r = computeTrustScore(
      { executed: 3, rejected: 0, failed: 0, runsSucceeded: 3, runsTotal: 3, breakerTrips: 0 },
      AgentAutonomy.PROPOSE,
    );
    expect(r.readyForNext).toBe(false);
  });
  it('failures and breaker trips lower the score', () => {
    const clean = computeTrustScore({ executed: 30, rejected: 0, failed: 0, runsSucceeded: 30, runsTotal: 30, breakerTrips: 0 }, AgentAutonomy.PROPOSE);
    const dirty = computeTrustScore({ executed: 30, rejected: 5, failed: 8, runsSucceeded: 20, runsTotal: 30, breakerTrips: 2 }, AgentAutonomy.PROPOSE);
    expect(dirty.score).toBeLessThan(clean.score);
  });
  it('AUTONOMOUS is never "ready for next" (already top)', () => {
    const r = computeTrustScore({ executed: 100, rejected: 0, failed: 0, runsSucceeded: 100, runsTotal: 100, breakerTrips: 0 }, AgentAutonomy.AUTONOMOUS);
    expect(r.readyForNext).toBe(false);
  });
});
