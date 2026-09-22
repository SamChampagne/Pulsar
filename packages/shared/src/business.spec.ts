import { describe, it, expect } from 'vitest';
import {
  ServiceProjectStatus as P,
  ServiceJobStatus as J,
  SupplierOrderStatus as O,
  canTransitionServiceProject,
  canTransitionServiceJob,
  canTransitionSupplierOrder,
  ServiceTimeStatus as T,
  canTransitionServiceTime,
  formatServiceMinutes,
  SupportCaseStatus as S,
  canTransitionSupportCase,
} from './business';
describe('Separate business lifecycles', () => {
  it('SAV resolves only after qualification and requires explicit reopening before a new resolution', () => {
    expect(canTransitionSupportCase(S.OPEN, S.RESOLVED)).toBe(false);
    expect(canTransitionSupportCase(S.OPEN, S.IN_PROGRESS)).toBe(true);
    expect(canTransitionSupportCase(S.IN_PROGRESS, S.RESOLVED)).toBe(true);
    expect(canTransitionSupportCase(S.RESOLVED, S.IN_PROGRESS)).toBe(true);
    expect(canTransitionSupportCase(S.RESOLVED, S.CLOSED)).toBe(true);
    for (const s of Object.values(S)) {
      expect(canTransitionSupportCase(S.CLOSED, s)).toBe(false);
      expect(canTransitionSupportCase(s, s)).toBe(false);
    }
  });
  it('time can be voided once without deletion or reopening', () => {
    expect(canTransitionServiceTime(T.RECORDED, T.VOIDED)).toBe(true);
    expect(canTransitionServiceTime(T.VOIDED, T.RECORDED)).toBe(false);
    expect(canTransitionServiceTime(T.VOIDED, T.VOIDED)).toBe(false);
    expect(canTransitionServiceTime(T.RECORDED, T.RECORDED)).toBe(false);
  });
  it('formats integer minutes without rounding billed hours', () => {
    expect(formatServiceMinutes(0)).toBe('0 h 00');
    expect(formatServiceMinutes(95)).toBe('1 h 35');
    expect(formatServiceMinutes(1440)).toBe('24 h 00');
  });
  it('time approval requires submission and explicit reopening before correction', () => {
    expect(canTransitionServiceTime(T.RECORDED, T.APPROVED)).toBe(false);
    expect(canTransitionServiceTime(T.RECORDED, T.SUBMITTED)).toBe(true);
    expect(canTransitionServiceTime(T.SUBMITTED, T.APPROVED)).toBe(true);
    expect(canTransitionServiceTime(T.SUBMITTED, T.REJECTED)).toBe(true);
    expect(canTransitionServiceTime(T.SUBMITTED, T.RECORDED)).toBe(true);
    expect(canTransitionServiceTime(T.REJECTED, T.SUBMITTED)).toBe(true);
    expect(canTransitionServiceTime(T.REJECTED, T.VOIDED)).toBe(true);
    expect(canTransitionServiceTime(T.APPROVED, T.RECORDED)).toBe(true);
    expect(canTransitionServiceTime(T.APPROVED, T.VOIDED)).toBe(false);
    expect(canTransitionServiceTime(T.SUBMITTED, T.VOIDED)).toBe(false);
    for (const s of Object.values(T)) {
      expect(canTransitionServiceTime(T.VOIDED, s)).toBe(false);
      expect(canTransitionServiceTime(s, s)).toBe(false);
    }
  });
  it('projects require activation and cannot reopen', () => {
    expect(canTransitionServiceProject(P.DRAFT, P.ACTIVE)).toBe(true);
    expect(canTransitionServiceProject(P.DRAFT, P.COMPLETED)).toBe(false);
    expect(canTransitionServiceProject(P.COMPLETED, P.ACTIVE)).toBe(false);
  });
  it('interventions must start before completion', () => {
    expect(canTransitionServiceJob(J.PLANNED, J.COMPLETED)).toBe(false);
    expect(canTransitionServiceJob(J.PLANNED, J.IN_PROGRESS)).toBe(true);
    expect(canTransitionServiceJob(J.IN_PROGRESS, J.COMPLETED)).toBe(true);
  });
  it('purchases must be confirmed before administrative closure', () => {
    expect(canTransitionSupplierOrder(O.DRAFT, O.CLOSED)).toBe(false);
    expect(canTransitionSupplierOrder(O.DRAFT, O.CONFIRMED)).toBe(true);
    expect(canTransitionSupplierOrder(O.CONFIRMED, O.CLOSED)).toBe(true);
  });
  it('all terminal states and self transitions are forbidden', () => {
    for (const state of Object.values(P))
      expect(canTransitionServiceProject(state, state)).toBe(false);
    for (const state of Object.values(J)) {
      expect(canTransitionServiceJob(state, state)).toBe(false);
      expect(canTransitionServiceJob(J.COMPLETED, state)).toBe(false);
      expect(canTransitionServiceJob(J.CANCELLED, state)).toBe(false);
    }
    for (const state of Object.values(O)) {
      expect(canTransitionSupplierOrder(state, state)).toBe(false);
      expect(canTransitionSupplierOrder(O.CLOSED, state)).toBe(false);
      expect(canTransitionSupplierOrder(O.CANCELLED, state)).toBe(false);
    }
  });
});
