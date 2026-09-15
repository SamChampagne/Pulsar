import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuditAction,
  MaterialPurchaseStatus,
  MODULE_KEYS,
  PERMISSIONS,
  type AuthUser,
} from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Audit } from '../../../common/decorators/audit.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { MaterialPurchasesService } from './material-purchases.service';
import {
  SupplierDto,
  CreatePurchaseDto,
  UpdatePurchaseDto,
  ConfirmPurchaseDto,
  PurchaseReceiptDto,
  PurchaseListDto,
  PurchaseVersionDto,
} from './material-purchases.dto';
const read = [PERMISSIONS.MANUFACTURING.READ, PERMISSIONS.WMS.READ];
const write = [...read, PERMISSIONS.MANUFACTURING.MANAGE];

@ApiTags('manufacturing/material-purchases')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.MANUFACTURING)
@Controller('manufacturing/material-purchases')
export class MaterialPurchasesController {
  constructor(private readonly service: MaterialPurchasesService) {}
  @Get('suppliers')
  @RequirePermissions(...read)
  suppliers(@CurrentUser() u: AuthUser, @Query() q: PurchaseListDto) {
    return this.service.suppliers(u.tenantId, q);
  }
  @Post('suppliers')
  @RequirePermissions(...write)
  @Audit('material-supplier', AuditAction.CREATE)
  createSupplier(@CurrentUser() u: AuthUser, @Body() dto: SupplierDto) {
    return this.service.saveSupplier(u.tenantId, null, dto);
  }
  @Put('suppliers/:id')
  @RequirePermissions(...write)
  @Audit('material-supplier', AuditAction.UPDATE)
  updateSupplier(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: SupplierDto) {
    return this.service.saveSupplier(u.tenantId, id, dto);
  }
  @Get('requests')
  @RequirePermissions(...read)
  requests(@CurrentUser() u: AuthUser, @Query() q: PurchaseListDto) {
    return this.service.requests(u.tenantId, u.permissions, q);
  }
  @Get('requests/:id')
  @RequirePermissions(...read)
  preparation(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.preparation(u.tenantId, id, u.permissions);
  }
  @Get(':id')
  @RequirePermissions(...read)
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.service.get(u.tenantId, id, u.permissions);
  }
  @Post()
  @RequirePermissions(...write)
  create(@CurrentUser() u: AuthUser, @Body() dto: CreatePurchaseDto) {
    return this.service.create(u.tenantId, u.id, u.permissions, dto);
  }
  @Put(':id')
  @RequirePermissions(...write)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: UpdatePurchaseDto) {
    return this.service.update(u.tenantId, u.id, id, u.permissions, dto);
  }
  @Post(':id/confirm')
  @RequirePermissions(...write)
  confirm(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ConfirmPurchaseDto) {
    return this.service.transition(
      u.tenantId,
      u.id,
      id,
      u.permissions,
      MaterialPurchaseStatus.CONFIRMED,
      dto,
    );
  }
  @Post(':id/cancel')
  @RequirePermissions(...write)
  cancel(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: PurchaseVersionDto) {
    return this.service.transition(
      u.tenantId,
      u.id,
      id,
      u.permissions,
      MaterialPurchaseStatus.CANCELLED,
      dto,
    );
  }
  @Post(':id/receipts')
  @RequirePermissions(...write, PERMISSIONS.WMS.MANAGE)
  receive(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: PurchaseReceiptDto) {
    return this.service.receive(u.tenantId, u.id, id, u.permissions, dto);
  }
}
