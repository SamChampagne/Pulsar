import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class DeliveryAllocationQuery {
  @IsString() @IsNotEmpty() @MaxLength(100) shipmentId!: string;
}
export class CreateDeliveryAllocationDto {
  @IsUUID('4') operationKey!: string;
  @IsString() @IsNotEmpty() @MaxLength(100) packageId!: string;
  @IsInt() @Min(0) @Max(49) contentIndex!: number;
  @IsInt() @Min(1) expectedVersion!: number;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) sourceSalesOrderLineId?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(100) sourcePickLineId?: string;
  @IsOptional() @IsBoolean() salesUnitAcknowledged?: boolean;
  @IsOptional() @IsDateString() expectedSalesLineUpdatedAt?: string;
  @IsOptional() @IsDateString() expectedSalesOrderUpdatedAt?: string;
  @IsOptional() @IsDateString() expectedPickUpdatedAt?: string;
}
export class ReleaseDeliveryAllocationDto {
  @IsUUID('4') operationKey!: string;
  @IsInt() @Min(1) expectedVersion!: number;
}
