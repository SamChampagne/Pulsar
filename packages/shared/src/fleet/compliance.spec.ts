import { describe, it, expect } from 'vitest';
import { computeComplianceStatus, ComplianceSubject, ComplianceDocType } from './compliance';

const NOW = new Date('2026-06-15T00:00:00.000Z').getTime();
const days = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe('computeComplianceStatus', () => {
  it('EXPIRED when past', () => {
    expect(computeComplianceStatus(days(-1), NOW)).toBe('EXPIRED');
  });
  it('EXPIRING within the warn window (default 30d)', () => {
    expect(computeComplianceStatus(days(10), NOW)).toBe('EXPIRING');
    expect(computeComplianceStatus(days(30), NOW)).toBe('EXPIRING');
  });
  it('VALID beyond the window', () => {
    expect(computeComplianceStatus(days(60), NOW)).toBe('VALID');
  });
  it('respects a custom warn window', () => {
    expect(computeComplianceStatus(days(10), NOW, 7)).toBe('VALID');
  });
  it('exposes the enums', () => {
    expect(Object.values(ComplianceSubject)).toEqual(['VEHICLE', 'TRAILER', 'DRIVER']);
    expect(Object.values(ComplianceDocType)).toContain('INSURANCE');
  });
});
