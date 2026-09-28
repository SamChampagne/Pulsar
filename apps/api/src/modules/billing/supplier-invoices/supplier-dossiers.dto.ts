import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { CURRENCIES } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
export class SupplierDossierDirectoryDto extends ListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) declare page?: number;
  @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(200) declare search?: string;
  @ValidateIf((_, v) => v !== undefined) @IsIn(['ACTIVE', 'INACTIVE']) activity?:
    | 'ACTIVE'
    | 'INACTIVE';
}
export class SupplierDossierQueryDto extends ListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) declare page?: number;
  @ValidateIf((_, v) => v !== undefined) @IsString() @MaxLength(200) declare search?: string;
  @ValidateIf((_, v) => v !== undefined) @IsIn(['INVOICE', 'CREDIT']) kind?: 'INVOICE' | 'CREDIT';
  @ValidateIf((_, v) => v !== undefined) @IsIn(['DRAFT', 'QUALIFIED', 'CANCELLED']) status?:
    | 'DRAFT'
    | 'QUALIFIED'
    | 'CANCELLED';
  @ValidateIf((_, v) => v !== undefined) @IsIn(CURRENCIES.map((c) => c.code)) currency?: string;
  @ValidateIf((_, v) => v !== undefined) @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ValidateIf((_, v) => v !== undefined) @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
