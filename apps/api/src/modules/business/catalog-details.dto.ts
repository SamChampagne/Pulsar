import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { ListQueryDto } from '../../common/dto/list-query.dto';
const Nullable = () => ValidateIf((_o, value) => value !== null && value !== undefined);
const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const Decimal = () => Matches(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/);
export class SaveCatalogDetailsDto {
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @IsObject() data!: Record<string, unknown>;
}
export class SaveSupplierOfferDto {
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
  @IsString() @Length(1, 100) supplierId!: string;
  @IsString() @Trim() @Length(1, 120) supplierReference!: string;
  @IsIn(['CAD', 'USD', 'EUR', 'GBP']) currency!: string;
  @IsString() @Decimal() unitPrice!: string;
  @Nullable() @IsString() @Decimal() minimumQuantity?: string | null;
  @Nullable() @IsString() @Decimal() orderMultiple?: string | null;
  @Nullable() @IsInt() @Min(0) @Max(3650) leadTimeDays?: number | null;
  @Nullable() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) validFrom?:
    | string
    | null;
  @Nullable() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil?:
    | string
    | null;
  @IsString() @Trim() @MaxLength(1000) packaging!: string;
  @IsString() @Trim() @MaxLength(4000) terms!: string;
  @IsBoolean() active!: boolean;
}
export class SupplierOffersQueryDto extends ListQueryDto {
  @Nullable() @IsString() @Length(1, 100) supplierId?: string;
}
