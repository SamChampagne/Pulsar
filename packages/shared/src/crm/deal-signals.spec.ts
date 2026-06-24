import { describe, it, expect } from 'vitest';
import { isDealStale, dealAgeDays } from './deal-signals';
import { CrmDealStage } from './crm.workflow';

const now = new Date('2026-06-24T00:00:00Z');
const old = new Date('2026-06-10T00:00:00Z'); // 14 days before now
const recent = new Date('2026-06-22T00:00:00Z'); // 2 days before now

describe('dealAgeDays', () => {
  it('counts whole days since creation', () => {
    expect(dealAgeDays(old, now)).toBe(14);
    expect(dealAgeDays(now, now)).toBe(0);
  });
});

describe('isDealStale', () => {
  it('open deal with no activity older than threshold is stale', () => {
    expect(isDealStale({ stage: CrmDealStage.LEAD, lastActivityAt: null, createdAt: old, now })).toBe(true);
  });
  it('open deal with recent activity is not stale', () => {
    expect(isDealStale({ stage: CrmDealStage.QUALIFIED, lastActivityAt: recent, createdAt: old, now })).toBe(false);
  });
  it('closed deals are never stale', () => {
    expect(isDealStale({ stage: CrmDealStage.WON, lastActivityAt: null, createdAt: old, now })).toBe(false);
    expect(isDealStale({ stage: CrmDealStage.LOST, lastActivityAt: null, createdAt: old, now })).toBe(false);
  });
});
