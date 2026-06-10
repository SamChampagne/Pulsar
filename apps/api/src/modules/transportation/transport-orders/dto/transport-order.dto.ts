import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
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
  requestedPickupDate?: string;

  @IsOptional()
  @IsDateString()
  requestedDeliveryDate?: string;

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
  plannedPickupAt?: string;

  @IsOptional()
  @IsDateString()
  plannedDeliveryAt?: string;
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
