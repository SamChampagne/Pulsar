import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class FuelEntryDto {
  @IsDateString()
  effectiveFrom!: string;

  @IsNumber()
  @Min(0)
  pct!: number;
}

export class CreateFuelTableDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FuelEntryDto)
  entries?: FuelEntryDto[];
}

export class UpdateFuelTableDto {
  @IsOptional()
  @IsString()
  name?: string;

  /** When provided, REPLACES the whole entry set (PUT semantics on the nested collection). */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FuelEntryDto)
  entries?: FuelEntryDto[];
}
