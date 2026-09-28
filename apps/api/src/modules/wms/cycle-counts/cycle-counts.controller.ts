import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import {
  CreateCycleCountDto,
  CountActionDto,
  CycleCountListQueryDto,
  RecordCountsDto,
} from './dto/cycle-count.dto';
import { CycleCountsService } from './cycle-counts.service';

@ApiTags('wms/cycle-counts')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms/cycle-counts')
export class CycleCountsController {
  constructor(private readonly cycleCounts: CycleCountsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WMS.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: CycleCountListQueryDto) {
    return this.cycleCounts.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cycleCounts.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCycleCountDto) {
    return this.cycleCounts.create(user.tenantId, user.id, dto);
  }

  @Post(':id/counts')
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  recordCounts(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RecordCountsDto,
  ) {
    return this.cycleCounts.recordCounts(user.tenantId, user.id, id, dto);
  }

  @Post(':id/reconcile')
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  reconcile(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CountActionDto) {
    return this.cycleCounts.reconcile(user.tenantId, user.id, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CountActionDto) {
    return this.cycleCounts.cancel(user.tenantId, user.id, id, dto);
  }
}
