import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { BinListQueryDto, CreateBinDto, UpdateBinDto } from './dto/bin.dto';
import { BinsService } from './bins.service';

@ApiTags('wms/bins')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms/bins')
export class BinsController {
  constructor(private readonly bins: BinsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WMS.READ)
  list(@CurrentUser() user: AuthUser, @Query() q: BinListQueryDto) {
    return this.bins.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.bins.get(user.tenantId, id);
  }

  @Post()
  @Audit('wms-bin', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBinDto) {
    return this.bins.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('wms-bin', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateBinDto) {
    return this.bins.update(user.tenantId, id, dto);
  }
}
