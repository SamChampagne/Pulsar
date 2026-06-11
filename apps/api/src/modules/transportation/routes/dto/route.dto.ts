import { StopType } from '@pulsar/shared';
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

export class StopInputDto {
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

export class CreateRouteDto {
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
  @ValidateNested({ each: true })
  @Type(() => StopInputDto)
  stops!: StopInputDto[];
}
