import { describe, expect, it } from 'vitest';
import {
  canTransitionPortalChangeRequest,
  PortalActionTokenKind,
  PortalChangeRequestKind,
  PortalChangeRequestStatus,
  PortalUserRole,
  PortalUserStatus,
} from './portal';

describe('portal enums', () => {
  it('PortalUserRole has ADMIN and MEMBER', () => {
    expect(PortalUserRole.ADMIN).toBe('ADMIN');
    expect(PortalUserRole.MEMBER).toBe('MEMBER');
    expect(Object.keys(PortalUserRole)).toEqual(['ADMIN', 'MEMBER']);
  });

  it('PortalUserStatus has INVITED, ACTIVE and DISABLED', () => {
    expect(PortalUserStatus.INVITED).toBe('INVITED');
    expect(PortalUserStatus.ACTIVE).toBe('ACTIVE');
    expect(PortalUserStatus.DISABLED).toBe('DISABLED');
    expect(Object.keys(PortalUserStatus)).toEqual(['INVITED', 'ACTIVE', 'DISABLED']);
  });

  it('PortalActionTokenKind has INVITATION and PASSWORD_RESET', () => {
    expect(PortalActionTokenKind.INVITATION).toBe('INVITATION');
    expect(PortalActionTokenKind.PASSWORD_RESET).toBe('PASSWORD_RESET');
    expect(Object.keys(PortalActionTokenKind)).toEqual(['INVITATION', 'PASSWORD_RESET']);
  });

  it('PortalChangeRequestKind has DATE, ADDRESS, CANCEL and OTHER', () => {
    expect(PortalChangeRequestKind.DATE).toBe('DATE');
    expect(PortalChangeRequestKind.ADDRESS).toBe('ADDRESS');
    expect(PortalChangeRequestKind.CANCEL).toBe('CANCEL');
    expect(PortalChangeRequestKind.OTHER).toBe('OTHER');
    expect(Object.keys(PortalChangeRequestKind)).toEqual(['DATE', 'ADDRESS', 'CANCEL', 'OTHER']);
  });

  it('PortalChangeRequestStatus has OPEN, ACKNOWLEDGED, RESOLVED and REJECTED', () => {
    expect(PortalChangeRequestStatus.OPEN).toBe('OPEN');
    expect(PortalChangeRequestStatus.ACKNOWLEDGED).toBe('ACKNOWLEDGED');
    expect(PortalChangeRequestStatus.RESOLVED).toBe('RESOLVED');
    expect(PortalChangeRequestStatus.REJECTED).toBe('REJECTED');
    expect(Object.keys(PortalChangeRequestStatus)).toEqual([
      'OPEN',
      'ACKNOWLEDGED',
      'RESOLVED',
      'REJECTED',
    ]);
  });
});

describe('canTransitionPortalChangeRequest', () => {
  it('allows OPEN -> ACKNOWLEDGED, RESOLVED, REJECTED', () => {
    expect(
      canTransitionPortalChangeRequest(
        PortalChangeRequestStatus.OPEN,
        PortalChangeRequestStatus.ACKNOWLEDGED,
      ),
    ).toBe(true);
    expect(
      canTransitionPortalChangeRequest(
        PortalChangeRequestStatus.OPEN,
        PortalChangeRequestStatus.RESOLVED,
      ),
    ).toBe(true);
    expect(
      canTransitionPortalChangeRequest(
        PortalChangeRequestStatus.OPEN,
        PortalChangeRequestStatus.REJECTED,
      ),
    ).toBe(true);
  });

  it('allows ACKNOWLEDGED -> RESOLVED, REJECTED', () => {
    expect(
      canTransitionPortalChangeRequest(
        PortalChangeRequestStatus.ACKNOWLEDGED,
        PortalChangeRequestStatus.RESOLVED,
      ),
    ).toBe(true);
    expect(
      canTransitionPortalChangeRequest(
        PortalChangeRequestStatus.ACKNOWLEDGED,
        PortalChangeRequestStatus.REJECTED,
      ),
    ).toBe(true);
  });

  it('rejects ACKNOWLEDGED -> OPEN and any transition out of RESOLVED/REJECTED', () => {
    expect(
      canTransitionPortalChangeRequest(
        PortalChangeRequestStatus.ACKNOWLEDGED,
        PortalChangeRequestStatus.OPEN,
      ),
    ).toBe(false);
    expect(
      canTransitionPortalChangeRequest(
        PortalChangeRequestStatus.RESOLVED,
        PortalChangeRequestStatus.OPEN,
      ),
    ).toBe(false);
    expect(
      canTransitionPortalChangeRequest(
        PortalChangeRequestStatus.RESOLVED,
        PortalChangeRequestStatus.ACKNOWLEDGED,
      ),
    ).toBe(false);
    expect(
      canTransitionPortalChangeRequest(
        PortalChangeRequestStatus.REJECTED,
        PortalChangeRequestStatus.OPEN,
      ),
    ).toBe(false);
    expect(
      canTransitionPortalChangeRequest(
        PortalChangeRequestStatus.REJECTED,
        PortalChangeRequestStatus.ACKNOWLEDGED,
      ),
    ).toBe(false);
  });

  it('rejects OPEN -> OPEN (no self-transition)', () => {
    expect(
      canTransitionPortalChangeRequest(
        PortalChangeRequestStatus.OPEN,
        PortalChangeRequestStatus.OPEN,
      ),
    ).toBe(false);
  });
});
