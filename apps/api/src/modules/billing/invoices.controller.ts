import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
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
  list(@CurrentUser() user: AuthUser) {
    return this.invoices.list(user.tenantId);
  }

  /** Preview of the loads the next draft would bill for a carrier. */
  @Get('billable')
  @RequirePermissions(PERMISSIONS.BILLING.INVOICES_READ)
  billable(@CurrentUser() user: AuthUser, @Query('carrierId') carrierId: string) {
    return this.invoices.billableLoads(user.tenantId, carrierId);
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
}
