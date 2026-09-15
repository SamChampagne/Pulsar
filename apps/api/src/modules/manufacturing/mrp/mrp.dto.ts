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

export class MrpSiteDto {
  @IsString() @MinLength(1) @MaxLength(128) locationId!: string;
}
export class MrpPolicyDto extends MrpSiteDto {
  @IsString() @MinLength(1) @MaxLength(128) itemId!: string;
  @IsEnum(MrpSourcingMethod) method!: MrpSourcingMethod;
  @IsOptional() @IsString() @MaxLength(128) bomId?: string;
  @IsInt() @Min(0) @Max(3650) leadDays!: number;
  @Matches(/^\d{1,10}(\.\d{1,3})?$/) safetyStock!: string;
  @Matches(/^\d{1,10}(\.\d{1,3})?$/) minimumOrder!: string;
  @Matches(/^\d{1,10}(\.\d{1,3})?$/) orderMultiple!: string;
  @Equals(true) acknowledgeUnits!: boolean;
  @IsOptional() @IsDateString() expectedUpdatedAt?: string;
}
export class MrpEntryDto extends MrpSiteDto {
  @IsString() @MinLength(1) @MaxLength(128) itemId!: string;
  @IsEnum(MrpEntryKind) kind!: MrpEntryKind;
  @Matches(/^\d{1,10}(\.\d{1,3})?$/) quantity!: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
  @IsString() @MinLength(1) @MaxLength(200) reference!: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) receiptId?: string;
  @IsBoolean() isActive!: boolean;
  @IsOptional() @IsDateString() expectedUpdatedAt?: string;
}
export class MrpCalculateDto extends MrpSiteDto {
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) horizonEnd!: string;
}
