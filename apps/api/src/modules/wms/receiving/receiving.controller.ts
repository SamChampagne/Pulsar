import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { AuditAction, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { AddReceiptLineDto, CreateReceiptDto, ReceiptListQueryDto, UpdateReceiptDto } from './dto/receipt.dto';
import { ReceivingService } from './receiving.service';

@ApiTags('wms/receiving')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.WMS)
@Controller('wms/receipts')
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.WMS.READ)
  list(@CurrentUser() user: AuthUser, @Query() q: ReceiptListQueryDto) {
    return this.receiving.list(user.tenantId, q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.WMS.READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.receiving.get(user.tenantId, id);
  }

  @Post()
  @Audit('wms-receipt', AuditAction.CREATE)
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReceiptDto) {
    return this.receiving.create(user.tenantId, user.id, dto);
  }

  @Patch(':id')
  @Audit('wms-receipt', AuditAction.UPDATE)
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateReceiptDto) {
    return this.receiving.update(user.tenantId, user.id, id, dto);
  }

  @Post(':id/lines')
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  addLine(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: AddReceiptLineDto) {
    return this.receiving.addLine(user.tenantId, id, dto);
  }

  @Delete(':id/lines/:lineId')
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  removeLine(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('lineId') lineId: string) {
    return this.receiving.removeLine(user.tenantId, id, lineId);
  }

  @Post(':id/post')
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  post(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.receiving.post(user.tenantId, user.id, id);
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.WMS.MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.receiving.cancel(user.tenantId, user.id, id);
  }
}
