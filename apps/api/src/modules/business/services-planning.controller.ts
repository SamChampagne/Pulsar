import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, AuthUser, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ServicesPlanningService } from './services-planning.service';
import {
  PlanningQueryDto,
  ScheduleServiceJobDto,
  ServiceRequirementsDto,
} from './services-planning.dto';
import { BusinessQueryDto } from './business.dto';
@ApiTags('services/planning')
@ApiBearerAuth()
@Controller('services/planning')
@RequireModule(MODULE_KEYS.SERVICES)
export class ServicesPlanningController {
  constructor(private readonly planning: ServicesPlanningService) {}
  @Get('references/teams')
  @RequirePermissions(PERMISSIONS.SERVICES.READ, PERMISSIONS.HR.AVAILABILITY_READ)
  teams(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.planning.teams(u, q);
  }
  @Get('references/skills')
  @RequirePermissions(PERMISSIONS.SERVICES.READ, PERMISSIONS.HR.QUALIFICATIONS_READ)
  skills(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.planning.skills(u, q);
  }
  @Get()
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  board(@CurrentUser() u: AuthUser, @Query() q: PlanningQueryDto) {
    return this.planning.board(u, q);
  }
  @Post(':id/check')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  check(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ScheduleServiceJobDto) {
    return this.planning.check(u, id, dto);
  }
  @Post(':id/schedule')
  @RequirePermissions(PERMISSIONS.SERVICES.READ, PERMISSIONS.SERVICES.MANAGE)
  schedule(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: ScheduleServiceJobDto,
  ) {
    return this.planning.schedule(u, id, dto);
  }
  @Get(':id/requirements')
  @RequirePermissions(PERMISSIONS.SERVICES.READ, PERMISSIONS.HR.QUALIFICATIONS_READ)
  requirements(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.planning.requirements(u, id);
  }
  @Put(':id/requirements')
  @RequirePermissions(
    PERMISSIONS.SERVICES.READ,
    PERMISSIONS.SERVICES.MANAGE,
    PERMISSIONS.HR.QUALIFICATIONS_READ,
  )
  @Audit('service-job-requirements', AuditAction.UPDATE)
  setRequirements(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: ServiceRequirementsDto,
  ) {
    return this.planning.requirements(u, id, dto);
  }
}
