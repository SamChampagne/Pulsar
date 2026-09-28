import {
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
} from 'class-validator';
import { SUPPLIER_RETURN_QUANTITY, type SupplierReturnReportInput } from '@pulsar/shared';
export class SupplierReturnReportDto implements SupplierReturnReportInput {
  @IsUUID('4') operationKey!: string;
  @IsInt() @Min(0) @Max(2147483646) expectedRevision!: number;
  @Matches(SUPPLIER_RETURN_QUANTITY) received!: string;
  @Matches(SUPPLIER_RETURN_QUANTITY) accepted!: string;
  @Matches(SUPPLIER_RETURN_QUANTITY) refused!: string;
  @IsString() @MinLength(1) @MaxLength(100) evidenceId!: string;
  @IsDateString({ strict: true }) @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/) reportedAt!: string;
  @IsString() @MinLength(3) @MaxLength(200) reference!: string;
  @IsString() @MinLength(10) @MaxLength(2000) note!: string;
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  correctionReason?: string;
}
