import { describe, it, expect } from 'vitest';
import { FreightAuditStatus, canTransitionFreightAudit } from './freight-audit.workflow';

describe('canTransitionFreightAudit', () => {
  it('allows the audit + dispute + pay paths', () => {
    expect(canTransitionFreightAudit(FreightAuditStatus.RECEIVED, FreightAuditStatus.MATCHED)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.RECEIVED, FreightAuditStatus.FLAGGED)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.FLAGGED, FreightAuditStatus.DISPUTED)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.FLAGGED, FreightAuditStatus.RESOLVED)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.DISPUTED, FreightAuditStatus.RESOLVED)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.MATCHED, FreightAuditStatus.PAID)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.RESOLVED, FreightAuditStatus.PAID)).toBe(true);
  });
  it('rejects invalid jumps', () => {
    expect(canTransitionFreightAudit(FreightAuditStatus.RECEIVED, FreightAuditStatus.PAID)).toBe(false);
    expect(canTransitionFreightAudit(FreightAuditStatus.PAID, FreightAuditStatus.DISPUTED)).toBe(false);
    expect(canTransitionFreightAudit(FreightAuditStatus.MATCHED, FreightAuditStatus.DISPUTED)).toBe(false);
    expect(canTransitionFreightAudit(FreightAuditStatus.RESOLVED, FreightAuditStatus.FLAGGED)).toBe(false);
  });
  it('allows re-audit (FLAGGED→MATCHED) and same-state no-op', () => {
    expect(canTransitionFreightAudit(FreightAuditStatus.FLAGGED, FreightAuditStatus.MATCHED)).toBe(true);
    expect(canTransitionFreightAudit(FreightAuditStatus.FLAGGED, FreightAuditStatus.FLAGGED)).toBe(true);
  });
});
