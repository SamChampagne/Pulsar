import { TransportMode } from '@pulsar/shared';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLoadDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  customData?: Record<string, unknown>;
}

export class AssignLoadResourcesDto {
  @IsOptional()
  @IsString()
  carrierId?: string;

  @IsOptional()
  @IsString()
  driverId?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  trailerId?: string;

  @IsOptional()
  @IsString()
  rateId?: string;

  /** Bypasses the capacity check; the override is written to the audit log. */
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  /** Override the load's transport mode (applies to OPEN/PLANNED loads). */
  @IsOptional()
  @IsEnum(TransportMode)
  mode?: TransportMode;
}

export class LoadAccessorialItemDto {
  @IsString()
  accessorialId!: string;

  /** Ignored (forced to 1) for FLAT-unit accessorials. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;
}

export class SetLoadAccessorialsDto {
  /** Replaces the whole set (PUT semantics). Empty array clears all flags. */
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoadAccessorialItemDto)
  items!: LoadAccessorialItemDto[];
}
