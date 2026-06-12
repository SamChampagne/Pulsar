import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser, CustomerInvoiceStatus } from '@pulsar/shared';
import { MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { IsDateString, IsOptional, IsString } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CustomerInvoicesService } from './customer-invoices.service';

class DraftStatementsDto {
  @IsString()
  customerId!: string;
}

class MarkStatementPaidDto {
  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/customer-invoices')
export class CustomerInvoicesController {
  constructor(private readonly statements: CustomerInvoicesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: CustomerInvoiceStatus,
    @Query('customerId') customerId?: string,
  ) {
    return this.statements.list(user.tenantId, status, customerId);
  }

  /** Preview: ratable orders with amounts + unratable ones with reasons. */
  @Get('billable')
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
  billable(@CurrentUser() user: AuthUser, @Query('customerId') customerId: string) {
    return this.statements.billable(user.tenantId, customerId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.statements.get(user.tenantId, id);
  }

  /** One DRAFT statement per currency encountered among the customer's billable orders. */
  @Post()
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: DraftStatementsDto) {
    return this.statements.createDrafts(user.tenantId, user.id, dto.customerId);
  }

  /** DRAFT only — frees the orders for regeneration (the draft escape path). */
  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.statements.deleteDraft(user.tenantId, user.id, id);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE)
  approve(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.statements.approve(user.tenantId, user.id, id);
  }

  @Post(':id/send')
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_SEND)
  send(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.statements.send(user.tenantId, user.id, id);
  }

  @Post(':id/pay')
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_PAY)
  markPaid(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: MarkStatementPaidDto) {
    return this.statements.markPaid(user.tenantId, user.id, id, dto.paidAt);
  }
}
