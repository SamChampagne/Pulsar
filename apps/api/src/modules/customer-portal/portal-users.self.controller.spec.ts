import { ForbiddenException } from '@nestjs/common';
import type { PortalAuthUser } from '@pulsar/shared';
import { PortalUserRole } from '@pulsar/shared';
import { PortalUsersSelfController } from './portal-users.self.controller';
import type { PortalUsersService } from './portal-users.service';

/**
 * The self-service controller is the ONLY place where a portal principal drives
 * the colleague lifecycle, so two invariants are asserted here rather than left
 * to an e2e: a MEMBER never reaches the service, and an ADMIN reaches it with
 * the tenant/customer of the JWT — never a value taken from the URL or body.
 */
function makeController() {
  const users = {
    listForCustomer: jest.fn(async () => []),
    invite: jest.fn(async () => ({ id: 'pu2' })),
    resendInvitation: jest.fn(async () => ({ inviteUrl: 'https://app.test/portal/activate/x' })),
    deactivate: jest.fn(async () => ({ id: 'pu2' })),
  } as unknown as PortalUsersService;
  return { controller: new PortalUsersSelfController(users), users };
}

const principal = (over: Partial<PortalAuthUser> = {}): PortalAuthUser => ({
  id: 'pu1',
  tenantId: 't1',
  customerId: 'c1',
  email: 'jane@client.test',
  firstName: 'Jane',
  lastName: 'Doe',
  role: PortalUserRole.ADMIN,
  ...over,
});

const INVITE_DTO = { email: 'new@client.test', firstName: 'New', lastName: 'Person' };

describe('PortalUsersSelfController — MEMBER principal', () => {
  const member = principal({ id: 'pu-member', role: PortalUserRole.MEMBER });

  it('403s on every route before the service is ever called', async () => {
    const { controller, users } = makeController();

    expect(() => controller.list(member)).toThrow(ForbiddenException);
    expect(() => controller.invite(member, INVITE_DTO)).toThrow(ForbiddenException);
    expect(() => controller.resendInvitation(member, 'pu2')).toThrow(ForbiddenException);
    expect(() => controller.deactivate(member, 'pu2')).toThrow(ForbiddenException);

    expect(users.listForCustomer).not.toHaveBeenCalled();
    expect(users.invite).not.toHaveBeenCalled();
    expect(users.resendInvitation).not.toHaveBeenCalled();
    expect(users.deactivate).not.toHaveBeenCalled();
  });
});

describe('PortalUsersSelfController — ADMIN principal', () => {
  const admin = principal();

  it('scopes every call with the principal tenantId/customerId (never a param or body value)', async () => {
    const { controller, users } = makeController();

    await controller.list(admin);
    await controller.invite(admin, { ...INVITE_DTO, ...({ customerId: 'c-other' } as object) });
    await controller.resendInvitation(admin, 'pu2');
    await controller.deactivate(admin, 'pu2');

    expect(users.listForCustomer).toHaveBeenCalledWith('t1', 'c1');
    expect(users.invite).toHaveBeenCalledWith('t1', 'c1', expect.anything(), {
      kind: 'portal',
      portalUserId: 'pu1',
    });
    expect(users.resendInvitation).toHaveBeenCalledWith('t1', 'c1', 'pu2', {
      kind: 'portal',
      portalUserId: 'pu1',
    });
    expect(users.deactivate).toHaveBeenCalledWith('t1', 'c1', 'pu2', {
      kind: 'portal',
      portalUserId: 'pu1',
    });
  });
});
