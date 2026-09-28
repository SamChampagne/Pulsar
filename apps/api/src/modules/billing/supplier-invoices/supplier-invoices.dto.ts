import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  CURRENCIES,
  SUPPLIER_INVOICE_AMOUNT,
  SUPPLIER_INVOICE_QUANTITY,
  SupplierInvoiceInput,
} from '@pulsar/shared';

class LineDto {
  @IsString() @MinLength(1) @MaxLength(500) description!: string;
  @Matches(SUPPLIER_INVOICE_QUANTITY) quantity!: string;
  @IsString() @MinLength(1) @MaxLength(30) unit!: string;
  @Matches(SUPPLIER_INVOICE_AMOUNT) netAmount!: string;
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  purchaseLineId?: string;
}
class TaxDto {
  @IsString() @MinLength(1) @MaxLength(100) label!: string;
  @Matches(SUPPLIER_INVOICE_AMOUNT) amount!: string;
}
export class SupplierInvoiceDto implements SupplierInvoiceInput {
  @IsUUID('4') operationKey!: string;
  @ValidateIf((_, v) => v !== undefined) @IsDateString({ strict: true }) expectedUpdatedAt?: string;
  @IsString() @MinLength(1) @MaxLength(100) supplierId!: string;
  @IsString() @MinLength(1) @MaxLength(100) externalNumber!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) invoiceDate!: string;
  @ValidateIf((_, v) => v !== undefined) @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate?: string;
  @IsIn(CURRENCIES.map((c) => c.code)) currency!: string;
  @IsString() @MaxLength(4000) notes!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines!: LineDto[];
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => TaxDto) taxes!: TaxDto[];
}
export class SupplierInvoiceCloseDto {
  @IsUUID('4') operationKey!: string;
  @IsDateString({ strict: true }) expectedUpdatedAt!: string;
  @IsString() @MinLength(10) @MaxLength(2000) note!: string;
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  evidenceId?: string;
}
export class SupplierInvoiceEvidenceDto {
  @IsUUID('4') operationKey!: string;
  @IsString() @MinLength(3) @MaxLength(1000) caption!: string;
}
