import { describe, expect, it } from 'vitest';
import { PortalActionTokenKind, PortalUserRole, PortalUserStatus } from './portal';

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
});
