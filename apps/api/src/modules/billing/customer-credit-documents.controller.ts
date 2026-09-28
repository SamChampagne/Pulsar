import { Body, Controller, Get, Param, Post, StreamableFile } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { AuthUser, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CustomerCreditDocumentsService } from './customer-credit-documents.service';
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export class PublishCreditDocumentDto {
  @IsString() @Transform(trim) @Length(1, 180) issuerName!: string;
  @IsString() @Transform(trim) @Length(1, 600) issuerAddress!: string;
  @IsString() @Transform(trim) @MaxLength(600) issuerTaxIds!: string;
  @IsOptional() @IsIn(['MANUAL', 'INVOICE']) recipientSource?: 'MANUAL' | 'INVOICE';
  @ValidateIf((o, v) => o.recipientSource === 'INVOICE' || v !== undefined)
  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  expectedCoordinatesHash?: string;
  @ValidateIf((o) => o.recipientSource !== 'INVOICE')
  @IsString()
  @Transform(trim)
  @Length(1, 180)
  recipientName?: string;
  @ValidateIf((o) => o.recipientSource !== 'INVOICE')
  @IsString()
  @Transform(trim)
  @MaxLength(600)
  recipientAddress?: string;
  @IsOptional() @IsString() @Transform(trim) @Length(3, 500) recipientReason?: string;
  @Equals(true) confirmed!: true;
}
export class SendCreditDocumentDto {
  @IsEmail() @MaxLength(254) @Transform(trim) to!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) expectedHash!: string;
  @IsIn(['log', 'smtp']) expectedChannel!: 'log' | 'smtp';
  @Equals(true) confirmed!: true;
}
@Controller('billing/customer-invoices/:invoiceId/credits/:id/document')
@RequireModule(MODULE_KEYS.BILLING)
@RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
export class CustomerCreditDocumentsController {
  constructor(private readonly documents: CustomerCreditDocumentsService) {}
  @Get()
  context(
    @CurrentUser() user: AuthUser,
    @Param('invoiceId') invoiceId: string,
    @Param('id') id: string,
  ) {
    return this.documents.context(user.tenantId, invoiceId, id);
  }
  @Post()
  @RequirePermissions(
    PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ,
    PERMISSIONS.BILLING.CREDIT_NOTES_APPROVE,
  )
  publish(
    @CurrentUser() user: AuthUser,
    @Param('invoiceId') invoiceId: string,
    @Param('id') id: string,
    @Body() dto: PublishCreditDocumentDto,
  ) {
    return this.documents.publish(user, invoiceId, id, dto);
  }
  @Get('pdf')
  async pdf(
    @CurrentUser() user: AuthUser,
    @Param('invoiceId') invoiceId: string,
    @Param('id') id: string,
  ) {
    const result = await this.documents.download(user.tenantId, invoiceId, id);
    return new StreamableFile(result.body, {
      type: 'application/pdf',
      disposition: `attachment; filename="${result.filename}"`,
    });
  }
  @Post('send')
  @RequirePermissions(
    PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ,
    PERMISSIONS.BILLING.CREDIT_NOTES_SEND,
  )
  send(
    @CurrentUser() user: AuthUser,
    @Param('invoiceId') invoiceId: string,
    @Param('id') id: string,
    @Body() dto: SendCreditDocumentDto,
  ) {
    return this.documents.send(user, invoiceId, id, dto);
  }
}
