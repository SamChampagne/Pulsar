import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { FreightAuditStatus, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { RequireModule } from '../../../common/decorators/require-module.decorator';
import { FreightAuditService } from './freight-audit.service';
import { FreightAccountingService } from './freight-accounting.service';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import {
  CreateIncomingInvoiceDto,
  FreightDisputeDto,
  FreightResolveDto,
  FreightPayDto,
  LinkFreightInvoiceDto,
} from './dto/freight-audit.dto';

@ApiTags('billing/freight-audit')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('freight-audit')
export class FreightAuditController {
  constructor(
    private readonly service: FreightAuditService,
    private readonly accounting: FreightAccountingService,
  ) {}

  @Get('incoming-invoices/:id/accounting')
  @RequirePermissions(
    PERMISSIONS.BILLING.FREIGHT_AUDIT_READ,
    PERMISSIONS.BILLING.INVOICES_READ,
    PERMISSIONS.BILLING.PAYMENTS_READ,
    PERMISSIONS.BILLING.LEDGER_READ,
  )
  accountingFlow(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ListQueryDto,
  ) {
    return this.accounting.read(user.tenantId, id, query);
  }

  @Post('incoming-invoices/:id/link-invoice')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE, PERMISSIONS.BILLING.INVOICES_READ)
  linkInvoice(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: LinkFreightInvoiceDto,
  ) {
    return this.accounting.link(user.tenantId, user.id, id, dto.invoiceId);
  }

  @Get('savings')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_READ)
  savings(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.service.savings(user.tenantId, days ? Number(days) : 30);
  }

  @Get('incoming-invoices')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_READ)
  list(@CurrentUser() user: AuthUser, @Query('status') status?: FreightAuditStatus) {
    return this.service.list(user.tenantId, status);
  }

  @Get('incoming-invoices/:id')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOne(user.tenantId, id);
  }

  @Post('incoming-invoices')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateIncomingInvoiceDto) {
    return this.service.create(user.tenantId, user.id, dto);
  }

  @Post('incoming-invoices/:id/audit')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE)
  audit(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.audit(user.tenantId, user.id, id);
  }

  @Post('incoming-invoices/:id/dispute')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE)
  dispute(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FreightDisputeDto) {
    return this.service.dispute(user.tenantId, user.id, id, dto);
  }

  @Post('incoming-invoices/:id/resolve')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE)
  resolve(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FreightResolveDto) {
    return this.service.resolve(user.tenantId, user.id, id, dto);
  }

  @Post('incoming-invoices/:id/pay')
  @RequirePermissions(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE)
  pay(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: FreightPayDto) {
    return this.service.markPaid(user.tenantId, user.id, id, dto.paidAt);
  }
}
