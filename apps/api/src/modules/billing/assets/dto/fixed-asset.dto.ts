import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';

export class CreateFixedAssetDto {
  @IsString()
  @Length(1, 40)
  assetCode!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsDateString()
  acquisitionDate!: string;

  @IsNumber()
  @Min(0)
  cost!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  salvageValue?: number;

  @IsInt()
  @Min(1)
  @Max(1200)
  usefulLifeMonths!: number;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Z]{1,10}$/)
  depreciationExpenseAccountCode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Z]{1,10}$/)
  accumulatedDepreciationAccountCode?: string;
}

export class UpdateFixedAssetDto extends PartialType(CreateFixedAssetDto) {}

export class DepreciateDto {
  @IsDateString()
  period!: string;
}
