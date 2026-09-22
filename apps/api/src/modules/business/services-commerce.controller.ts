import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditAction, AuthUser, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ServicesCommerceService } from './services-commerce.service';
import { BusinessQueryDto, VersionDto } from './business.dto';
import {
  CreateServiceQuoteDto,
  UpdateServiceQuoteDto,
  TransitionServiceQuoteDto,
  InvoiceServiceWorkDto,
  PartnerLinksDto,
} from './services-commerce.dto';

@ApiTags('services/commerce')
@ApiBearerAuth()
@Controller('services')
@RequireModule(MODULE_KEYS.SERVICES)
export class ServicesCommerceController {
  constructor(private readonly commerce: ServicesCommerceService) {}
  @Get('quotes')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  list(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.commerce.quotes(u, q);
  }
  @Get('quotes/:id')
  @RequirePermissions(PERMISSIONS.SERVICES.READ)
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.commerce.quote(u, id);
  }
  @Post('quotes')
  @RequirePermissions(PERMISSIONS.SERVICES.READ, PERMISSIONS.SERVICES.MANAGE)
  create(@CurrentUser() u: AuthUser, @Body() d: CreateServiceQuoteDto) {
    return this.commerce.createQuote(u, d);
  }
  @Patch('quotes/:id')
  @RequirePermissions(PERMISSIONS.SERVICES.READ, PERMISSIONS.SERVICES.MANAGE)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: UpdateServiceQuoteDto) {
    return this.commerce.updateQuote(u, id, d);
  }
  @Post('quotes/:id/transition')
  @RequirePermissions(PERMISSIONS.SERVICES.READ, PERMISSIONS.SERVICES.MANAGE)
  transition(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() d: TransitionServiceQuoteDto,
  ) {
    return this.commerce.transitionQuote(u, id, d);
  }
  @Get('projects/:id/billable')
  @RequirePermissions(PERMISSIONS.SERVICES.READ, PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
  billable(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.commerce.billable(u, id);
  }
  @Post('projects/:id/invoice')
  @RequirePermissions(
    PERMISSIONS.SERVICES.READ,
    PERMISSIONS.SERVICES.MANAGE,
    PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE,
  )
  invoice(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: InvoiceServiceWorkDto) {
    return this.commerce.invoice(u, id, d);
  }
}

@ApiTags('catalog/links')
@ApiBearerAuth()
@Controller('catalog')
@RequireModule(MODULE_KEYS.CATALOG)
export class PartnerLinksController {
  constructor(private readonly commerce: ServicesCommerceService) {}
  @Get('references/billing-customers')
  @RequirePermissions(PERMISSIONS.CATALOG.READ, PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
  customers(@CurrentUser() u: AuthUser, @Query() q: BusinessQueryDto) {
    return this.commerce.billingCustomers(u, q);
  }
  @Get('partners/:id/links')
  @RequirePermissions(PERMISSIONS.CATALOG.READ)
  get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.commerce.partnerLinks(u, id);
  }
  @Patch('partners/:id/links')
  @RequirePermissions(PERMISSIONS.CATALOG.READ, PERMISSIONS.CATALOG.MANAGE)
  @Audit('business-partner-links', AuditAction.UPDATE)
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: PartnerLinksDto) {
    return this.commerce.partnerLinks(u, id, d);
  }
  @Post('partners/:id/billing-customer')
  @RequirePermissions(PERMISSIONS.CATALOG.MANAGE, PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE)
  @Audit('business-partner-billing-customer', AuditAction.CREATE)
  create(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() d: VersionDto) {
    return this.commerce.createBillingCustomer(u, id, d);
  }
}
