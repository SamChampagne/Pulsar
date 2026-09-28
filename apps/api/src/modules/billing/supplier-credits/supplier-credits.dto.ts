import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SUPPLIER_INVOICE_AMOUNT, SupplierCreditInput } from '@pulsar/shared';
class CreditLineDto {
  @IsString() @MinLength(1) @MaxLength(100) invoiceLineId!: string;
  @Matches(SUPPLIER_INVOICE_AMOUNT) netAmount!: string;
}
class CreditTaxDto {
  @IsInt() @Min(0) @Max(19) position!: number;
  @Matches(SUPPLIER_INVOICE_AMOUNT) amount!: string;
}
export class SupplierCreditDto implements SupplierCreditInput {
  @IsUUID('4') operationKey!: string;
  @ValidateIf((_, v) => v !== undefined) @IsDateString({ strict: true }) expectedUpdatedAt?: string;
  @IsString() @MinLength(1) @MaxLength(100) invoiceId!: string;
  @IsString() @MinLength(1) @MaxLength(100) externalNumber!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) creditDate!: string;
  @IsString() @MinLength(10) @MaxLength(2000) reason!: string;
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  returnReportId?: string;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreditLineDto)
  lines!: CreditLineDto[];
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreditTaxDto)
  taxes!: CreditTaxDto[];
}
