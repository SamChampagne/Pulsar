import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ChangeRequestResponseDto, ChangeRequestsQueryDto } from './dto/portal.dto';
import { PortalChangeRequestsService } from './portal-change-requests.service';

/**
 * Staff queue for the change requests filed from the customer portal. The
 * tenant comes from the JWT (rule 1); the existing `customer-portal.users.*`
 * permissions are reused — no new key for a surface that belongs to the same
 * "who talks to our customers" responsibility.
 *
 * No `@Audit(...)`: the transitions are audited explicitly in the service,
 * which knows the before/after status.
 */
@ApiTags('customer-portal')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.CUSTOMER_PORTAL)
@Controller('customer-portal/change-requests')
export class PortalChangeRequestsAdminController {
  constructor(private readonly changeRequests: PortalChangeRequestsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.USERS_READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ChangeRequestsQueryDto) {
    return this.changeRequests.list(user.tenantId, query);
  }

  @Post(':id/acknowledge')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.USERS_MANAGE)
  acknowledge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.changeRequests.acknowledge(user.tenantId, id, user.id);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.USERS_MANAGE)
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ChangeRequestResponseDto,
  ) {
    return this.changeRequests.resolve(user.tenantId, id, user.id, dto.response);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.CUSTOMER_PORTAL.USERS_MANAGE)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ChangeRequestResponseDto,
  ) {
    return this.changeRequests.reject(user.tenantId, id, user.id, dto.response);
  }
}
