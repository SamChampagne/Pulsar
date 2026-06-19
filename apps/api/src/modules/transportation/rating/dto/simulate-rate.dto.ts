import { ApiPropertyOptional } from '@nestjs/swagger';
import { LaneEndpointType, TransportMode } from '@pulsar/shared';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/** Raw geo endpoint inputs — mirror of @pulsar/shared LaneEndpointInput. */
export class SimulateEndpointDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  country?: string;
}

/**
 * Hypothetical rate-simulation scenario (no load). The caller supplies EITHER an
 * existing `laneId` OR a raw origin/destination pair (type + endpoint). Validation of
 * that "either/or" is enforced in the service so a clear 400 message can be returned.
 */
export class SimulateRateDto {
  @ApiPropertyOptional({ description: 'Existing lane id — its origin/destination keys are used as-is.' })
  @IsOptional()
  @IsString()
  laneId?: string;

  @ApiPropertyOptional({ enum: LaneEndpointType })
  @IsOptional()
  @IsEnum(LaneEndpointType)
  originType?: LaneEndpointType;

  @ApiPropertyOptional({ type: SimulateEndpointDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SimulateEndpointDto)
  origin?: SimulateEndpointDto;

  @ApiPropertyOptional({ enum: LaneEndpointType })
  @IsOptional()
  @IsEnum(LaneEndpointType)
  destinationType?: LaneEndpointType;

  @ApiPropertyOptional({ type: SimulateEndpointDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SimulateEndpointDto)
  destination?: SimulateEndpointDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  distanceKm?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  palletCount?: number;

  @ApiPropertyOptional({ type: [String], description: 'Requested accessorial codes.' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  accessorialCodes?: string[];

  @ApiPropertyOptional({ description: 'ISO date governing fuel + validity. Defaults to today.' })
  @IsOptional()
  @IsISO8601()
  referenceDate?: string;

  @ApiPropertyOptional({ type: [String], description: 'Restrict the comparison to these carriers.' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  carrierIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ enum: TransportMode })
  @IsOptional()
  @IsEnum(TransportMode)
  mode?: TransportMode;
}
