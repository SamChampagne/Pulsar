import { CrmDealStage, isDealOpen } from './crm.workflow';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_DAYS = 7;

/** Whole days between creation and `now` (floor, never negative). */
export function dealAgeDays(createdAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / DAY_MS));
}

/**
 * A deal is stale when it is still open and its last touch (activity, else creation)
 * is older than `thresholdDays`. Mirrors OverviewService.staleDealCount logic — the
 * single source of truth so the kanban and the overview never diverge.
 */
export function isDealStale(input: {
  stage: CrmDealStage;
  lastActivityAt: Date | null;
  createdAt: Date;
  now: Date;
  thresholdDays?: number;
}): boolean {
  if (!isDealOpen(input.stage)) return false;
  const threshold = new Date(input.now.getTime() - (input.thresholdDays ?? DEFAULT_STALE_DAYS) * DAY_MS);
  const lastAt = input.lastActivityAt ?? input.createdAt;
  return lastAt < threshold;
}
