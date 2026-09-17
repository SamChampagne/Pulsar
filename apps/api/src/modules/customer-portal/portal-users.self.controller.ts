import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { PortalAuthUser } from '@pulsar/shared';
import { PortalUserRole } from '@pulsar/shared';
import { CurrentPortalUser } from '../../common/decorators/current-portal-user.decorator';
import { PortalController } from '../../common/decorators/portal-controller.decorator';
import { InvitePortalUserDto } from './dto/portal-user.dto';
import { PortalUsersService } from './portal-users.service';

/**
 * Self-service: a portal ADMIN manages their own colleagues. Both `tenantId`
 * and `customerId` come from the authenticated principal — never from the body
 * or the URL — so a portal account can only ever act inside its own company.
 *
 * No `@Audit(...)` decorator: the audit interceptor writes `request.user.id`
 * into `AuditLog.userId`, and a PortalUser id is not a User row. These actions
 * are audited explicitly in the service, with the portal actor in the payload.
 */
@ApiTags('portal')
@PortalController()
@Controller('portal/users')
export class PortalUsersSelfController {
  constructor(private readonly users: PortalUsersService) {}

  /** Managing colleagues is an ADMIN-only capability; a MEMBER gets a 403. */
  private assertAdmin(user: PortalAuthUser): void {
    if (user.role !== PortalUserRole.ADMIN) {
      throw new ForbiddenException('Portal administrator role required');
    }
  }

  @Get()
  list(@CurrentPortalUser() user: PortalAuthUser) {
    this.assertAdmin(user);
    return this.users.listForCustomer(user.tenantId, user.customerId);
  }

  @Post()
  invite(@CurrentPortalUser() user: PortalAuthUser, @Body() dto: InvitePortalUserDto) {
    this.assertAdmin(user);
    return this.users.invite(user.tenantId, user.customerId, dto, {
      kind: 'portal',
      portalUserId: user.id,
    });
  }

  @Post(':id/resend-invitation')
  @HttpCode(200)
  resendInvitation(@CurrentPortalUser() user: PortalAuthUser, @Param('id') id: string) {
    this.assertAdmin(user);
    return this.users.resendInvitation(user.tenantId, user.customerId, id, {
      kind: 'portal',
      portalUserId: user.id,
    });
  }

  @Delete(':id')
  @HttpCode(200)
  deactivate(@CurrentPortalUser() user: PortalAuthUser, @Param('id') id: string) {
    this.assertAdmin(user);
    return this.users.deactivate(user.tenantId, user.customerId, id, {
      kind: 'portal',
      portalUserId: user.id,
    });
  }
}
