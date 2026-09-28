import { Body, Controller, Get, Param, Post, StreamableFile } from '@nestjs/common';
import { AuthUser, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  PublishCreditDocumentDto,
  SendCreditDocumentDto,
} from './customer-credit-documents.controller';
import { CustomerInvoiceDocumentsService } from './customer-invoice-documents.service';

// Same explicit identity/source and delivery contract as credit documents, separate business gates.
export class PublishInvoiceDocumentDto extends PublishCreditDocumentDto {}
export class SendInvoiceDocumentDto extends SendCreditDocumentDto {}
@Controller('billing/customer-invoices/:id/document')
@RequireModule(MODULE_KEYS.BILLING)
@RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
export class CustomerInvoiceDocumentsController {
  constructor(private readonly documents: CustomerInvoiceDocumentsService) {}
  @Get()
  context(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.context(user.tenantId, id);
  }
  @Post()
  @RequirePermissions(
    PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ,
    PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE,
  )
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PublishInvoiceDocumentDto,
  ) {
    return this.documents.publish(user, id, dto);
  }
  @Get('pdf')
  async pdf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const file = await this.documents.download(user.tenantId, id);
    return new StreamableFile(file.body, {
      type: 'application/pdf',
      disposition: `attachment; filename="${file.filename}"`,
    });
  }
  @Post('send')
  @RequirePermissions(
    PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ,
    PERMISSIONS.BILLING.CUSTOMER_INVOICES_SEND,
  )
  send(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SendInvoiceDocumentDto,
  ) {
    return this.documents.send(user, id, dto);
  }
}
