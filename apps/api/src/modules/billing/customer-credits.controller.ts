import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AuthUser, MODULE_KEYS, PERMISSIONS } from '@pulsar/shared';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CustomerCreditsService } from './customer-credits.service';
export class CreditLineDto {
  @IsString() @Length(1, 100) invoiceLineId!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(1000000000) quantity!: number;
}
export class DraftCreditDto {
  @IsUUID('4') operationKey!: string;
  @IsInt() @Min(0) expectedVersion!: number;
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 1000)
  reason!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreditLineDto)
  lines!: CreditLineDto[];
}
@Controller('billing/customer-invoices/:invoiceId/credits')
@RequireModule(MODULE_KEYS.BILLING)
export class CustomerCreditsController {
  constructor(private readonly credits: CustomerCreditsService) {}
  @Get()
  @RequirePermissions(PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ)
  context(@CurrentUser() user: AuthUser, @Param('invoiceId') id: string) {
    return this.credits.context(user.tenantId, id);
  }
  @Post()
  @RequirePermissions(
    PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ,
    PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE,
  )
  draft(
    @CurrentUser() user: AuthUser,
    @Param('invoiceId') id: string,
    @Body() dto: DraftCreditDto,
  ) {
    return this.credits.draft(user, id, dto);
  }
  @Post(':id/issue')
  @RequirePermissions(
    PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ,
    PERMISSIONS.BILLING.CREDIT_NOTES_APPROVE,
  )
  issue(
    @CurrentUser() user: AuthUser,
    @Param('invoiceId') invoiceId: string,
    @Param('id') id: string,
  ) {
    return this.credits.issue(user, invoiceId, id);
  }
  @Post(':id/cancel')
  @RequirePermissions(
    PERMISSIONS.BILLING.CUSTOMER_INVOICES_READ,
    PERMISSIONS.BILLING.CUSTOMER_INVOICES_MANAGE,
  )
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('invoiceId') invoiceId: string,
    @Param('id') id: string,
  ) {
    return this.credits.cancel(user, invoiceId, id);
  }
}
