import { describe, it, expect } from 'vitest';
import { evaluateCircuitBreaker, DEFAULT_BREAKER, type BreakerOutcome } from './circuit-breaker';

const fail = (at: number): BreakerOutcome => ({ failed: true, at });
const ok = (at: number): BreakerOutcome => ({ failed: false, at });

describe('evaluateCircuitBreaker', () => {
  it('trips on N consecutive failures (most-recent first ordering)', () => {
    expect(evaluateCircuitBreaker([fail(3), fail(2), fail(1)], DEFAULT_BREAKER)).toBe(true);
  });
  it('does not trip when a success interrupts the streak', () => {
    expect(evaluateCircuitBreaker([fail(4), fail(3), ok(2), fail(1)], DEFAULT_BREAKER)).toBe(false);
  });
  it('does not trip below the threshold', () => {
    expect(evaluateCircuitBreaker([fail(2), fail(1)], DEFAULT_BREAKER)).toBe(false);
  });
  it('empty history never trips', () => {
    expect(evaluateCircuitBreaker([], DEFAULT_BREAKER)).toBe(false);
  });
});
