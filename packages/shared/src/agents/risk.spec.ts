import { describe, it, expect } from 'vitest';
import {
  RiskTier,
  isExecutableLive,
  evaluateAmountCap,
  evaluateRateCap,
  deriveIdempotencyKey,
} from './risk';

describe('risk tiers', () => {
  it('READ and LOW execute live; MUTATING and SENSITIVE do not', () => {
    expect(isExecutableLive(RiskTier.READ)).toBe(true);
    expect(isExecutableLive(RiskTier.LOW)).toBe(true);
    expect(isExecutableLive(RiskTier.MUTATING)).toBe(false);
    expect(isExecutableLive(RiskTier.SENSITIVE)).toBe(false);
  });
});

describe('evaluateAmountCap', () => {
  it('passes when no cap is set', () => {
    expect(evaluateAmountCap(5000, undefined)).toEqual({ ok: true });
  });
  it('passes when amount is within cap', () => {
    expect(evaluateAmountCap(1000, 1500)).toEqual({ ok: true });
  });
  it('passes when amount is unknown', () => {
    expect(evaluateAmountCap(undefined, 1500)).toEqual({ ok: true });
  });
  it('fails when amount exceeds cap', () => {
    const r = evaluateAmountCap(2000, 1500);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('2000');
  });
});

describe('evaluateRateCap', () => {
  it('passes when under the per-minute limit', () => {
    expect(evaluateRateCap(3, 10)).toEqual({ ok: true });
  });
  it('passes when no limit is set', () => {
    expect(evaluateRateCap(99, undefined)).toEqual({ ok: true });
  });
  it('fails at or above the limit', () => {
    expect(evaluateRateCap(10, 10).ok).toBe(false);
  });
});

describe('deriveIdempotencyKey', () => {
  it('is stable regardless of key ordering in args', () => {
    const a = deriveIdempotencyKey('tender_load', { loadId: 'L1', carrierId: 'C1' });
    const b = deriveIdempotencyKey('tender_load', { carrierId: 'C1', loadId: 'L1' });
    expect(a).toBe(b);
  });
  it('differs when tool or args differ', () => {
    const a = deriveIdempotencyKey('tender_load', { loadId: 'L1' });
    const b = deriveIdempotencyKey('tender_load', { loadId: 'L2' });
    const c = deriveIdempotencyKey('cancel_order', { loadId: 'L1' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
  it('is stable regardless of nested key ordering', () => {
    const a = deriveIdempotencyKey('t', { opts: { z: 1, a: 2 } });
    const b = deriveIdempotencyKey('t', { opts: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });
});
