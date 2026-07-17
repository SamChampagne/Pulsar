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
  IsObject,
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

  @IsOptional()
  @IsObject()
  customData?: Record<string, unknown>;
}

export class UpdateTransportOrderDto extends PartialType(CreateTransportOrderDto) {}

/**
 * Bridge payload: create a transport order from a CONFIRMED CRM sales order.
 * Carries ONLY logistics data — the customer is derived server-side from
 * SalesOrder.customerId (never trusted from the client), and weights/volumes/
 * pallets are supplied explicitly (never inferred from commercial amounts or
 * product quantities). `fulfillmentKey` defaults to "primary"; a distinct key
 * lets one sales order fan out to several transport orders (partial shipments).
 */
export class CreateTransportOrderFromSalesOrderDto {
  @IsOptional()
  @IsString()
  fulfillmentKey?: string;

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

  // Required for the bridge (a shipment must have a mode). The service also
  // re-validates via validateFulfillmentLogistics (source of truth, agent path).
  @IsEnum(TransportMode)
  mode!: TransportMode;

  // Each measure is individually optional, but the service enforces that AT
  // LEAST ONE is strictly positive (validateFulfillmentLogistics). A 0 never
  // satisfies the rule, and nothing is inferred from commercial amounts.
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
  @IsObject()
  customData?: Record<string, unknown>;
}

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

  @IsOptional()
  @IsObject()
  customData?: Record<string, unknown>;
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
