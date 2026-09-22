import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { MODULE_KEYS, PERMISSIONS, type AuthUser } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BusinessService } from './business.service';
import { BusinessQueryDto } from './business.dto';
import {
  SupportService,
  SupportQueryDto,
  CreateSupportCaseDto,
  UpdateSupportCaseDto,
  SupportTransitionDto,
} from './support.service';
@ApiTags('support')
@ApiBearerAuth()
@Controller('support')
@RequireModule(MODULE_KEYS.SUPPORT)
export class SupportController {
  constructor(
    private readonly service: SupportService,
    private readonly business: BusinessService,
  ) {}
  @Get('references/people')
  @RequirePermissions(PERMISSIONS.SUPPORT.READ)
  people(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.business.people(u.tenantId, q);
  }
  @Get('references/customers')
  @RequirePermissions(PERMISSIONS.SUPPORT.READ)
  customers(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.business.partners(u.tenantId, q, 'isCustomer');
  }
  @Get('references/jobs')
  @RequirePermissions(PERMISSIONS.SUPPORT.READ, PERMISSIONS.SERVICES.READ)
  jobs(@CurrentUser() u: AuthUser, @Query() q: SupportQueryDto) {
    return this.service.jobs(u, q);
  }
  @Get('cases')
  @RequirePermissions(PERMISSIONS.SUPPORT.READ)
  list(@CurrentUser() u: AuthUser, @Query() q: SupportQueryDto) {
    return this.service.list(u.tenantId, q, u.id);
  }
  @Get('cases/:id')
  @RequirePermissions(PERMISSIONS.SUPPORT.READ)
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(u.tenantId, id);
  }
  @Get('cases/:id/history')
  @RequirePermissions(PERMISSIONS.SUPPORT.READ)
  history(@CurrentUser() u: AuthUser, @Param('id') id: string, @Query() q: BusinessQueryDto) {
    return this.service.history(u.tenantId, id, q);
  }
  @Post('cases')
  @RequirePermissions(PERMISSIONS.SUPPORT.READ, PERMISSIONS.SUPPORT.MANAGE)
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateSupportCaseDto) {
    return this.service.create(u, dto);
  }
  @Patch('cases/:id')
  @RequirePermissions(PERMISSIONS.SUPPORT.READ, PERMISSIONS.SUPPORT.MANAGE)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdateSupportCaseDto) {
    return this.service.update(u, id, dto);
  }
  @Post('cases/:id/transition')
  @RequirePermissions(PERMISSIONS.SUPPORT.READ, PERMISSIONS.SUPPORT.MANAGE)
  transition(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() dto: SupportTransitionDto,
  ) {
    return this.service.transition(u, id, dto);
  }
}
