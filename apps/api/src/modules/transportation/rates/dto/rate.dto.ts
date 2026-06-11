import { PartialType } from '@nestjs/swagger';
import { RateStatus, RateType } from '@pulsar/shared';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class RateBreakDto {
  @IsNumber()
  @Min(0.001)
  upToKg!: number;

  @IsNumber()
  @Min(0)
  amount!: number;
}

export class RateAccessorialPriceDto {
  @IsString()
  accessorialId!: string;

  @IsNumber()
  @Min(0)
  amount!: number;
}

export class CreateRateDto {
  @IsString()
  name!: string;

  @IsEnum(RateType)
  rateType!: RateType;

  @IsNumber()
  @Min(0)
  baseAmount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  carrierId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  laneId?: string;

  @IsOptional()
  @IsString()
  fuelTableId?: string;

  /** PER_HUNDREDWEIGHT only — degressive brackets, amount per CWT up to upToKg. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateBreakDto)
  breaks?: RateBreakDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateAccessorialPriceDto)
  accessorialPrices?: RateAccessorialPriceDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  fuelSurchargePct?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minCharge?: number;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;
}

export class UpdateRateDto extends PartialType(CreateRateDto) {
  @IsOptional()
  @IsEnum(RateStatus)
  status?: RateStatus;
}
