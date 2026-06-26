import { describe, it, expect } from 'vitest';
import { advanceRunDate, canTransitionSubscription, SubscriptionStatus, SubscriptionInterval } from './subscription';
describe('advanceRunDate', () => {
  it('WEEKLY +7 days', () => {
    expect(advanceRunDate(new Date('2026-01-01T00:00:00Z'), SubscriptionInterval.WEEKLY).toISOString()).toBe('2026-01-08T00:00:00.000Z');
  });
  it('MONTHLY +1 month', () => {
    expect(advanceRunDate(new Date('2026-01-15T00:00:00Z'), SubscriptionInterval.MONTHLY).toISOString()).toBe('2026-02-15T00:00:00.000Z');
  });
  it('MONTHLY end-of-month rolls correctly (Jan 31 → Feb 28/29 not Mar)', () => {
    // UTC month add with clamp: Jan 31 + 1mo → Feb 28 (2026 not leap)
    expect(advanceRunDate(new Date('2026-01-31T00:00:00Z'), SubscriptionInterval.MONTHLY).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
  it('YEARLY +1 year', () => {
    expect(advanceRunDate(new Date('2026-03-01T00:00:00Z'), SubscriptionInterval.YEARLY).toISOString()).toBe('2027-03-01T00:00:00.000Z');
  });
});
describe('canTransitionSubscription', () => {
  it('ACTIVE↔PAUSED, →CANCELLED; CANCELLED terminal', () => {
    expect(canTransitionSubscription(SubscriptionStatus.ACTIVE, SubscriptionStatus.PAUSED)).toBe(true);
    expect(canTransitionSubscription(SubscriptionStatus.PAUSED, SubscriptionStatus.ACTIVE)).toBe(true);
    expect(canTransitionSubscription(SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED)).toBe(true);
    expect(canTransitionSubscription(SubscriptionStatus.CANCELLED, SubscriptionStatus.ACTIVE)).toBe(false);
  });
});
