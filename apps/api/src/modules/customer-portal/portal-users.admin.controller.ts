import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { InvitePortalUserDto } from './dto/portal-user.dto';
import { PortalUsersService } from './portal-users.service';

/**
 * Staff-side management of a customer's portal accounts. The tenant comes from
 * the JWT and the customer from the URL; the service re-checks the customer
 * belongs to that tenant (rule 9) and scopes every query by both (rule 1).
 *
 * No `@Audit(...)` decorator here: these actions are audited explicitly in the
 * service, which knows the before/after status and the kind of actor.
 */
@ApiTags('customer-portal')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CUSTOMER_PORTAL)
@Controller('customer-portal/customers/:customerId/users')
export class PortalUsersAdminController {
  constructor(private readonly users: PortalUsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.USERS_READ)
  list(@CurrentUser() user: AuthUser, @Param('customerId') customerId: string) {
    return this.users.listForCustomer(user.tenantId, customerId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.USERS_MANAGE)
  invite(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Body() dto: InvitePortalUserDto,
  ) {
    return this.users.invite(user.tenantId, customerId, dto, {
      kind: 'staff',
      userId: user.id,
    });
  }

  @Post(':id/resend-invitation')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.USERS_MANAGE)
  resendInvitation(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Param('id') id: string,
  ) {
    return this.users.resendInvitation(user.tenantId, customerId, id, {
      kind: 'staff',
      userId: user.id,
    });
  }

  /** Deactivation, not deletion: the account keeps its history and can be restored. */
  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.USERS_MANAGE)
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Param('id') id: string,
  ) {
    return this.users.deactivate(user.tenantId, customerId, id, {
      kind: 'staff',
      userId: user.id,
    });
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.USERS_MANAGE)
  reactivate(
    @CurrentUser() user: AuthUser,
    @Param('customerId') customerId: string,
    @Param('id') id: string,
  ) {
    return this.users.reactivate(user.tenantId, customerId, id, {
      kind: 'staff',
      userId: user.id,
    });
  }
}
