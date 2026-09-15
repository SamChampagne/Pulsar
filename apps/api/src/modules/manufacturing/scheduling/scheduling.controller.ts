import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { SchedulingService } from './scheduling.service';

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

  @IsOptional() @IsInt() @Min(1) @Max(365) horizonDays?: number;

  @IsOptional() @IsObject() objective?: Record<string, number>;

  @IsOptional() @IsBoolean() respectMaterials?: boolean;
}

@ApiTags('manufacturing/scheduling')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.MANUFACTURING)
@Controller('manufacturing/scheduling')
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('strategies')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  strategies() {
    return this.scheduling.strategies();
  }

  @Post('run')
  @Audit('scheduling-run', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  run(@CurrentUser() user: AuthUser, @Body() dto: RunSchedulingDto) {
    return this.scheduling.run(user.tenantId, user.id, dto);
  }

  @Get('runs')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.scheduling.list(user.tenantId, query);
  }

  @Get('baseline')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  baseline(@CurrentUser() user: AuthUser) {
    return this.scheduling.baseline(user.tenantId);
  }

  @Get('runs/:id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduling.get(user.tenantId, id);
  }

  @Post('runs/:id/publish')
  @Audit('scheduling-run', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduling.publish(user.tenantId, user.id, id);
  }

  @Post('runs/:id/replay')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  replay(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.scheduling.replay(user.tenantId, user.id, id);
  }
}
