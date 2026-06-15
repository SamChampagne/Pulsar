import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { AssignSpotDto, CheckInDto, VisitListQueryDto } from './dto/visit.dto';
import { VisitsService } from './visits.service';

@ApiTags('yard/visits')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.YARD)
@Controller('yard/visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.YARD.READ)
  list(@CurrentUser() user: AuthUser, @Query() q: VisitListQueryDto) {
    return this.visits.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.YARD.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.visits.get(user.tenantId, id);
  }

  @Post()
  @Audit('yard-visit', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: CheckInDto) {
    return this.visits.checkIn(user.tenantId, user.id, dto);
  }

  @Post(':id/assign')
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  assign(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssignSpotDto) {
    return this.visits.assign(user.tenantId, user.id, id, dto);
  }

  @Post(':id/move')
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  move(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AssignSpotDto) {
    return this.visits.move(user.tenantId, user.id, id, dto);
  }

  @Post(':id/check-out')
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  checkOut(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.visits.checkOut(user.tenantId, user.id, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.YARD.MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.visits.cancel(user.tenantId, user.id, id);
  }
}
