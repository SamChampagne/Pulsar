import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  Matches,
  MaxLength,
} from 'class-validator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { SchedulingService } from './scheduling.service';
import { MaterialImpactService } from './material-impact.service';

class RunSchedulingDto {
  @IsOptional()
  @IsString()
  @IsIn([
    'greedy',
    'backward',
    'hybrid',
    'cpsat',
    'infinite',
    'sa',
    'tabu',
    'ga',
    'lns',
    'multi',
    'auto',
  ])
  strategy?: string;

  @IsOptional() @IsString() horizonStart?: string;
  @IsOptional() @IsString() @MaxLength(100) timeZone?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) horizonDate?: string;

  @IsOptional() @IsInt() @Min(1) @Max(365) horizonDays?: number;

  @IsOptional() @IsObject() objective?: Record<string, number>;

  @IsOptional() @IsBoolean() respectMaterials?: boolean;
}

class PublishSchedulingDto {
  @IsOptional() @IsString() @Matches(/^[a-f0-9]{64}$/) reviewToken?: string;
}

@ApiTags('manufacturing/scheduling')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.MANUFACTURING)
@Controller('manufacturing/scheduling')
export class SchedulingController {
  constructor(
    private readonly scheduling: SchedulingService,
    private readonly impacts: MaterialImpactService,
  ) {}

  @Get('material-impact')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ)
  impact(@CurrentUser() u: AuthUser, @Query('locationId') locationId: string) {
    if (typeof locationId !== 'string' || !locationId) throw new ForbiddenException('Site requis.');
    return this.impacts.get(u.tenantId, locationId);
  }

  @Get('strategies')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  strategies() {
    return this.scheduling.strategies();
  }

  @Post('run')
  @Audit('scheduling-run', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  run(@CurrentUser() user: AuthUser, @Body() dto: RunSchedulingDto) {
    if (dto.respectMaterials && !user.permissions.includes(PERMISSIONS.WMS.READ))
      throw new ForbiddenException('Lecture WMS requise pour planifier avec les matières.');
    return this.scheduling.run(user.tenantId, user.id, dto);
  }

  @Get('runs')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.scheduling.list(user.tenantId, query);
  }

  @Get('baseline')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  async baseline(@CurrentUser() user: AuthUser) {
    const run = await this.scheduling.baseline(user.tenantId);
    await this.scheduling.requireMaterialAccess(user.tenantId, run, user.permissions);
    return run;
  }

  @Get('runs/:id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  async get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const run = await this.scheduling.get(user.tenantId, id);
    await this.scheduling.requireMaterialAccess(user.tenantId, run, user.permissions);
    return run;
  }

  @Post('runs/:id/publish')
  @Audit('scheduling-run', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  async publish(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PublishSchedulingDto,
  ) {
    await this.get(user, id);
    return this.scheduling.publish(user.tenantId, user.id, id, dto?.reviewToken);
  }

  @Get('runs/:id/review')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  async review(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.get(user, id);
    return this.scheduling.review(user.tenantId, id);
  }

  @Post('runs/:id/replay')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  async replay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.get(user, id);
    return this.scheduling.replay(user.tenantId, user.id, id);
  }
}
