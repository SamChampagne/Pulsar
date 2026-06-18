import { describe, it, expect } from 'vitest';
import {
  PLAYBOOKS,
  DEFAULT_PLAYBOOK,
  getPlaybook,
  computeSlaDueAt,
  isSlaBreached,
} from './playbooks';

describe('getPlaybook', () => {
  it('returns the correct playbook for a known category', () => {
    expect(getPlaybook('DELAY')).toBe(PLAYBOOKS.DELAY);
    expect(getPlaybook('DELAY')).not.toBe(DEFAULT_PLAYBOOK);
  });

  it('returns DEFAULT_PLAYBOOK for an unknown category', () => {
    expect(getPlaybook('UNKNOWN_XYZ')).toBe(DEFAULT_PLAYBOOK);
  });

  it('every required category key exists in PLAYBOOKS', () => {
    const required = [
      'DELAY',
      'TENDER_FAILURE',
      'FREIGHT_AUDIT',
      'FLEET_MAINTENANCE',
      'FLEET_PM_DUE',
      'WMS_REPLENISH',
      'WMS_COUNT_VARIANCE',
      'FULFILLMENT_READY',
      'YARD_ARRIVAL',
      'YARD_DETENTION',
      'YARD_APPOINTMENT_LATE',
    ];
    for (const key of required) {
      expect(PLAYBOOKS[key], `PLAYBOOKS.${key} should exist`).toBeDefined();
    }
  });
});

describe('computeSlaDueAt', () => {
  it('returns ISO string = createdAtMs + slaMinutes*60000 for DELAY', () => {
    const result = computeSlaDueAt('DELAY', 0);
    expect(result).toBe(new Date(120 * 60_000).toISOString());
  });
});

describe('isSlaBreached', () => {
  it('returns false when slaDueAt is null', () => {
    expect(isSlaBreached(null, Date.now())).toBe(false);
  });

  it('returns false when slaDueAt is undefined', () => {
    expect(isSlaBreached(undefined, Date.now())).toBe(false);
  });

  it('returns true when slaDueAt is in the past', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isSlaBreached(past, Date.now())).toBe(true);
  });

  it('returns false when slaDueAt is in the future', () => {
    const future = new Date(Date.now() + 100_000).toISOString();
    expect(isSlaBreached(future, Date.now())).toBe(false);
  });
});
