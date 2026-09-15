import {
  Equals,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MrpEntryKind, MrpSourcingMethod } from '@pulsar/shared';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class MrpSourcesQuery extends ListQueryDto {
  @IsOptional() @IsString() @MaxLength(128) salesOrderId?: string;
}
export class MrpMappingsQuery extends ListQueryDto {
  @IsOptional() @IsString() @MaxLength(128) productId?: string;
}

export class MrpSiteDto {
  @IsString() @MinLength(1) @MaxLength(128) locationId!: string;
}
export class MrpPolicyDto extends MrpSiteDto {
  @IsString() @MinLength(1) @MaxLength(128) itemId!: string;
  @IsEnum(MrpSourcingMethod) method!: MrpSourcingMethod;
  @IsOptional() @IsString() @MaxLength(128) bomId?: string;
  @IsOptional() @IsString() @MaxLength(128) bomRevisionId?: string;
  @IsInt() @Min(0) @Max(3650) leadDays!: number;
  @Matches(/^\d{1,10}(\.\d{1,3})?$/) safetyStock!: string;
  @Matches(/^\d{1,10}(\.\d{1,3})?$/) minimumOrder!: string;
  @Matches(/^\d{1,10}(\.\d{1,3})?$/) orderMultiple!: string;
  @Equals(true) acknowledgeUnits!: boolean;
  @IsOptional() @IsDateString() expectedUpdatedAt?: string;
}
export class MrpEntryDto extends MrpSiteDto {
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  forecastStart?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) forecastId?: string;
  @IsString() @MinLength(1) @MaxLength(128) itemId!: string;
  @IsEnum(MrpEntryKind) kind!: MrpEntryKind;
  @Matches(/^\d{1,10}(\.\d{1,3})?$/) quantity!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
  @IsString() @MinLength(1) @MaxLength(200) reference!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) receiptId?: string;
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsDateString() expectedUpdatedAt?: string;
}
export class MrpSalesDemandDto extends MrpSiteDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) mappingId?: string;
  @IsOptional() @IsDateString() expectedMappingUpdatedAt?: string;
  @IsString() @MinLength(1) @MaxLength(128) itemId!: string;
  @IsString() @MinLength(1) @MaxLength(128) sourceSalesOrderLineId!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) forecastId?: string;
  @IsDateString() expectedSourceUpdatedAt!: string;
  @IsDateString() expectedOrderUpdatedAt!: string;
  @IsOptional() @IsDateString() expectedUpdatedAt?: string;
  @Equals(true) acknowledgeUnits!: boolean;
  @IsBoolean() isActive!: boolean;
}
export class MrpProductMappingDto {
  @IsString() @MinLength(1) @MaxLength(128) productId!: string;
  @IsString() @MinLength(1) @MaxLength(128) itemId!: string;
  @IsString() @MinLength(1) @MaxLength(40) commercialUnit!: string;
  @Matches(/^\d{1,10}(\.\d{1,6})?$/) numerator!: string;
  @Matches(/^\d{1,10}(\.\d{1,6})?$/) denominator!: string;
  @IsBoolean() isActive!: boolean;
  @Equals(true) acknowledgeUnits!: boolean;
  @IsOptional() @IsDateString() expectedUpdatedAt?: string;
}
export class MrpCalculateDto extends MrpSiteDto {
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) horizonEnd!: string;
}
