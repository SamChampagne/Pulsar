import { PartialType } from '@nestjs/swagger';
import { TransportMode } from '@pulsar/shared';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateTransportOrderDto {
  @IsString()
  customerId!: string;

  @IsString()
  originLocationId!: string;

  @IsString()
  destinationLocationId!: string;

  @IsOptional()
  @IsString()
  customerReference?: string;

  @IsOptional()
  @IsDateString()
  requestedPickupEarly?: string;

  @IsOptional()
  @IsDateString()
  requestedPickupLate?: string;

  @IsOptional()
  @IsDateString()
  requestedDeliveryEarly?: string;

  @IsOptional()
  @IsDateString()
  requestedDeliveryLate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalWeightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalVolumeM3?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  palletCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsEnum(TransportMode)
  mode?: TransportMode;
}

export class UpdateTransportOrderDto extends PartialType(CreateTransportOrderDto) {}

export class ShipmentSplitDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  volumeM3?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  palletCount?: number;

  @IsOptional()
  @IsDateString()
  plannedPickupEarly?: string;

  @IsOptional()
  @IsDateString()
  plannedPickupLate?: string;

  @IsOptional()
  @IsDateString()
  plannedDeliveryEarly?: string;

  @IsOptional()
  @IsDateString()
  plannedDeliveryLate?: string;
}

export class PlanTransportOrderDto {
  /**
   * Optional split: one shipment is created per entry. Omit for the default
   * single shipment carrying the full order quantities.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShipmentSplitDto)
  shipments?: ShipmentSplitDto[];
}
