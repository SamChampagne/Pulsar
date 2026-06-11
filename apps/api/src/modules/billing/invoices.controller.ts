import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import type { InvoiceStatus } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { IsString } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { MarkPaidDto, ReconcileInvoiceDto, ResolveDisputeDto } from './dto/reconcile.dto';
import { InvoicesService } from './invoices.service';

class DraftInvoiceDto {
  @IsString()
  carrierId!: string;
}

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_READ)
  list(@CurrentUser() user: AuthUser, @Query('status') status?: InvoiceStatus) {
    return this.invoices.list(user.tenantId, status);
  }

  /** Preview of the loads the next draft would bill for a carrier. */
  @Get('billable')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_READ)
  billable(@CurrentUser() user: AuthUser, @Query('carrierId') carrierId: string) {
    return this.invoices.billableLoads(user.tenantId, carrierId);
  }

  /** Export the invoice list as CSV. MUST be declared before :id to avoid Nest matching :id. */
  @Get('export.csv')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_READ)
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
    @Query('status') status?: InvoiceStatus,
  ) {
    const csv = await this.invoices.exportCsv(user.tenantId, status);
    res
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="invoices.csv"')
      .send(csv);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoices.get(user.tenantId, id);
  }

  @Post('draft')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_MANAGE)
  draft(@CurrentUser() user: AuthUser, @Body() dto: DraftInvoiceDto) {
    return this.invoices.createDraft(user.tenantId, user.id, dto.carrierId);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_MANAGE)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invoices.approve(user.tenantId, user.id, id);
  }

  @Post(':id/reconcile')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_MANAGE)
  reconcile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReconcileInvoiceDto,
  ) {
    return this.invoices.reconcile(user.tenantId, user.id, id, dto);
  }

  @Post(':id/resolve-dispute')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_MANAGE)
  resolveDispute(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.invoices.resolveDispute(user.tenantId, user.id, id, dto);
  }

  @Post(':id/mark-paid')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_PAY)
  markPaid(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MarkPaidDto) {
    return this.invoices.markPaid(user.tenantId, user.id, id, dto.paidAt);
  }
}
