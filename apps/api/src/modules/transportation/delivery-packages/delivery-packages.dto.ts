import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { DeliveryPackageStatus } from '@pulsar/shared';

export class PackageListDto {
  @IsString() @IsNotEmpty() @MaxLength(100) loadId!: string;
}
export class CreateDeliveryPackageDto {
  @IsUUID() operationKey!: string;
  @IsDateString() expectedUpdatedAt!: string;
  @IsString() @MaxLength(120) label!: string;
  @IsArray() contents!: unknown[];
}
export class EditDeliveryPackageDto {
  @IsUUID() operationKey!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MaxLength(120) label!: string;
  @IsArray() contents!: unknown[];
}
export class TransitionDeliveryPackageDto {
  @IsString() @IsNotEmpty() @MaxLength(100) expectedLoadId!: string;
  @IsDateString() expectedLoadUpdatedAt!: string;
  @IsUUID() operationKey!: string;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsEnum(DeliveryPackageStatus) target!: DeliveryPackageStatus;
  @IsOptional() @IsString() @MaxLength(120) recipientName?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
