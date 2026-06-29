import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import {
  CreateBomDto,
  CreateBomLineDto,
  UpdateBomDto,
  UpdateBomLineDto,
} from './dto/bom.dto';
import { BomsService } from './boms.service';

@ApiTags('manufacturing/boms')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.MANUFACTURING)
@Controller('manufacturing/boms')
export class BomsController {
  constructor(private readonly boms: BomsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  list(@CurrentUser() user: AuthUser, @Query() query: ListQueryDto) {
    return this.boms.list(user.tenantId, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.boms.get(user.tenantId, id);
  }

  @Post()
  @Audit('bom', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBomDto) {
    return this.boms.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Audit('bom', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateBomDto) {
    return this.boms.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.boms.remove(user.tenantId, id);
  }

  @Post(':id/lines')
  @Audit('bom-line', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  addLine(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateBomLineDto) {
    return this.boms.addLine(user.tenantId, id, dto);
  }

  @Patch(':id/lines/:lineId')
  @Audit('bom-line', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  updateLine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() dto: UpdateBomLineDto,
  ) {
    return this.boms.updateLine(user.tenantId, id, lineId, dto);
  }

  @Delete(':id/lines/:lineId')
  @RequirePermissions(PERMISSIONS.MANUFACTURING.MANAGE)
  removeLine(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    return this.boms.removeLine(user.tenantId, id, lineId);
  }
}
