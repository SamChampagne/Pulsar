import { StopType, type DeliveryFuelSourceInput } from '@pulsar/shared';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsBoolean,
  Matches,
  Max,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsObject,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class StopInputDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  serviceMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  idleMinutes?: number;
  @IsInt()
  @Min(1)
  sequence!: number;

  @IsEnum(StopType)
  type!: StopType;

  @IsString()
  locationId!: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsOptional()
  @IsDateString()
  plannedArrivalEarly?: string;

  @IsOptional()
  @IsDateString()
  plannedArrivalLate?: string;

  @IsOptional()
  @IsDateString()
  plannedDepartureAt?: string;
}

export class DeliveryPlanOptionsDto {
  @IsOptional() @IsDateString() @Matches(/(Z|[+-]\d{2}:\d{2})$/) startAt?: string;
  @IsOptional() @IsBoolean() returnToStart?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(1440) serviceMinutes?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(200) loadedLitersPer100Km?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(200) emptyLitersPer100Km?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) idleLitersPerHour?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) pricePerLiter?: number;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
}

export class CreateRouteDto {
  @IsOptional() @IsObject() fuelSource?: DeliveryFuelSourceInput;
  @IsOptional() @IsDateString() expectedUpdatedAt?: string;
  @IsOptional() @IsBoolean() optimize?: boolean;
  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryPlanOptionsDto)
  planning?: DeliveryPlanOptionsDto;
  @IsString()
  loadId!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalDistanceKm?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedDurationMin?: number;

  @IsArray()
  @ArrayMinSize(2, { message: 'A route needs at least a pickup and a delivery stop' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => StopInputDto)
  stops!: StopInputDto[];
}
