export enum SubscriptionStatus { ACTIVE = 'ACTIVE', PAUSED = 'PAUSED', CANCELLED = 'CANCELLED' }
export enum SubscriptionInterval { WEEKLY = 'WEEKLY', MONTHLY = 'MONTHLY', YEARLY = 'YEARLY' }
export const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  [SubscriptionStatus.ACTIVE]: [SubscriptionStatus.PAUSED, SubscriptionStatus.CANCELLED],
  [SubscriptionStatus.PAUSED]: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELLED],
  [SubscriptionStatus.CANCELLED]: [],
};
export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return SUBSCRIPTION_TRANSITIONS[from]?.includes(to) ?? false;
}
/** Advance a UTC date by one interval. MONTHLY/YEARLY clamp to end-of-month (Jan 31 +1mo → Feb 28). Pure: date is an argument. */
export function advanceRunDate(current: Date, interval: SubscriptionInterval): Date {
  const y = current.getUTCFullYear(), m = current.getUTCMonth(), d = current.getUTCDate();
  const hh = current.getUTCHours(), mm = current.getUTCMinutes(), ss = current.getUTCSeconds(), ms = current.getUTCMilliseconds();
  if (interval === SubscriptionInterval.WEEKLY) {
    return new Date(current.getTime() + 7 * 86400000);
  }
  const addMonths = interval === SubscriptionInterval.YEARLY ? 12 : 1;
  const targetMonthIndex = m + addMonths;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, daysInTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, clampedDay, hh, mm, ss, ms));
}
