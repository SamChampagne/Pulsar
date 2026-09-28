import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
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
import {
  CURRENCIES,
  SUPPLIER_INVOICE_AMOUNT,
  SupplierScheduleStatus,
  type SupplierScheduleInput,
} from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
class InstallmentDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
  @Matches(SUPPLIER_INVOICE_AMOUNT) amount!: string;
  @IsString() @MaxLength(200) note!: string;
}
export class SupplierScheduleReviewDto implements SupplierScheduleInput {
  @IsIn(Object.values(SupplierScheduleStatus)) status!: SupplierScheduleStatus;
  @IsString() @MinLength(10) @MaxLength(2000) note!: string;
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => InstallmentDto)
  installments!: InstallmentDto[];
}
export class SupplierScheduleConfirmDto extends SupplierScheduleReviewDto {
  @IsUUID('4') operationKey!: string;
  @Matches(/^[a-f0-9]{64}$/) reviewToken!: string;
  @ValidateIf((_, v) => v !== null) @IsString() @MinLength(1) @MaxLength(100) expectedRevisionId!:
    | string
    | null;
  @Equals(true) confirmed!: boolean;
}
export class SupplierSchedulePageDto extends ListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) declare page?: number;
  @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(200) declare search?: string;
}
export class SupplierScheduleQueryDto extends SupplierSchedulePageDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) referenceDate!: string;
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(['UNPLANNED', 'CONFIRMED', 'REVIEW', 'WITHDRAWN', 'ZERO', 'INCONSISTENT'])
  state?: string;
  @ValidateIf((_, v) => v !== undefined) @IsIn(CURRENCIES.map((c) => c.code)) currency?: string;
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  supplierId?: string;
}
