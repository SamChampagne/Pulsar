import { describe, expect, it } from 'vitest';
import { OperationalTaskType } from '../enums/operating';
import { resolvePolicies, type DomainEventInput } from './policies';

const delayed: DomainEventInput = {
  type: 'stop.delayed',
  payload: { stopId: 's1', loadId: 'l1', deadline: '2026-06-14T12:00:00.000Z', minutesLate: 45 },
};

describe('resolvePolicies', () => {
  it('turns stop.delayed into one EXCEPTION/DELAY task with a stable dedupKey', () => {
    const specs = resolvePolicies(delayed);
    expect(specs).toHaveLength(1);
    expect(specs[0].type).toBe(OperationalTaskType.EXCEPTION);
    expect(specs[0].category).toBe('DELAY');
    expect(specs[0].subjectType).toBe('stop');
    expect(specs[0].subjectId).toBe('s1');
    expect(specs[0].dedupKey).toBe('DELAY:s1:2026-06-14T12:00:00.000Z');
    expect(specs[0].assignHint).toBe('AUTO');
  });

  it('escalates severity to CRITICAL when more than 60 minutes late', () => {
    const specs = resolvePolicies({ ...delayed, payload: { ...delayed.payload, minutesLate: 90 } });
    expect(specs[0].severity).toBe('CRITICAL');
  });

  it('turns tender.declined and tender.expired into TENDER_FAILURE tasks', () => {
    const declined = resolvePolicies({
      type: 'tender.declined',
      payload: { loadId: 'l1', loadNumber: 'LD-1', carrierId: 'c1', tenderId: 't1' },
    });
    expect(declined[0].category).toBe('TENDER_FAILURE');
    expect(declined[0].dedupKey).toBe('TENDER_FAILURE:t1');
  });

  it('marks tender.expired with reason "expired"', () => {
    const expired = resolvePolicies({
      type: 'tender.expired',
      payload: { loadId: 'l1', loadNumber: 'LD-1', carrierId: 'c1', tenderId: 't9' },
    });
    expect(expired).toHaveLength(1);
    expect(expired[0].category).toBe('TENDER_FAILURE');
    expect(expired[0].dedupKey).toBe('TENDER_FAILURE:t9');
    expect(expired[0].details.reason).toBe('expired');
  });

  it('returns [] for an event with no matching policy', () => {
    expect(resolvePolicies({ type: 'load.completed', payload: {} })).toEqual([]);
  });
});
