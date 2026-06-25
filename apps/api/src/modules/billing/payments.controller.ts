import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@pulsar/shared';
import { MODULE_KEYS, PaymentPartyType, PaymentStatus, PaymentType, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('billing')
@ApiBearerAuth()
@RequireModule(MODULE_KEYS.BILLING)
@Controller('billing/payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get() @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_READ)
  list(@CurrentUser() user: AuthUser, @Query('status') status?: PaymentStatus, @Query('type') type?: PaymentType) {
    return this.service.list(user.tenantId, status, type);
  }

  @Get('open-invoices') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_READ)
  openInvoices(@CurrentUser() user: AuthUser, @Query('partyType') partyType: PaymentPartyType, @Query('partyId') partyId: string) {
    return this.service.openInvoices(user.tenantId, partyType, partyId);
  }

  @Get(':id') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_READ)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.get(user.tenantId, id); }

  @Post() @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentDto) { return this.service.create(user.tenantId, user.id, dto); }

  @Patch(':id') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdatePaymentDto) { return this.service.update(user.tenantId, user.id, id, dto); }

  @Post(':id/submit') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.submit(user.tenantId, user.id, id); }

  @Post(':id/cancel') @RequirePermissions(PERMISSIONS.BILLING.PAYMENTS_MANAGE)
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.service.cancel(user.tenantId, user.id, id); }
}
