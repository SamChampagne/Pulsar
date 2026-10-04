import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  Min,
} from 'class-validator';
import { DELIVERY_EXCEPTION_KINDS, DeliveryExceptionStatus } from '@pulsar/shared';

export class DeliveryExceptionQuery {
  @IsString() @IsNotEmpty() @MaxLength(100) loadId!: string;
}
export class CreateDeliveryExceptionDto {
  @IsUUID() operationKey!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) packageId!: string;
  @IsInt() @Min(1) expectedPackageVersion!: number;
  @IsDateString() expectedLoadUpdatedAt!: string;
  @IsIn(DELIVERY_EXCEPTION_KINDS) kind!: (typeof DELIVERY_EXCEPTION_KINDS)[number];
  @IsString() @IsNotEmpty() @MaxLength(1000) note!: string;
}
export class TransitionDeliveryExceptionDto {
  @IsUUID() operationKey!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsInt() @Min(1) expectedPackageVersion!: number;
  @IsDateString() expectedLoadUpdatedAt!: string;
  @IsEnum(DeliveryExceptionStatus) target!: DeliveryExceptionStatus;
  @IsString() @IsNotEmpty() @MaxLength(1000) note!: string;
  @IsOptional() @IsDateString() @Matches(/(Z|[+-]\d{2}:\d{2})$/) retryAt?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) returnLocationId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) receivedBy?: string;
}
