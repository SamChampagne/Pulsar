import { Type } from 'class-transformer';
import { LaneEndpointType } from '@pulsar/shared';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class LaneEndpointDto {
  /** Required when the endpoint type is LOCATION. */
  @IsOptional()
  @IsString()
  locationId?: string;

  /** Required for CITY (with state + country). */
  @IsOptional()
  @IsString()
  city?: string;

  /** Required for CITY and STATE (with country). */
  @IsOptional()
  @IsString()
  state?: string;

  /** Required for CITY, STATE and COUNTRY. */
  @IsOptional()
  @IsString()
  country?: string;
}

export class CreateLaneDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsEnum(LaneEndpointType)
  originType!: LaneEndpointType;

  @ValidateNested()
  @Type(() => LaneEndpointDto)
  origin!: LaneEndpointDto;

  @IsEnum(LaneEndpointType)
  destinationType!: LaneEndpointType;

  @ValidateNested()
  @Type(() => LaneEndpointDto)
  destination!: LaneEndpointDto;
}

/** Endpoints are immutable (normalized keys + uniqueness): delete/recreate to change them. */
export class UpdateLaneDto {
  @IsOptional()
  @IsString()
  name?: string;
}

export class SetLaneCarriersDto {
  /** Ordered by preference — first carrier is tendered first. */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  carrierIds!: string[];
}
