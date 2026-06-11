import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLoadDto {
  @IsOptional()
  @IsString()
  notes?: string;
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
