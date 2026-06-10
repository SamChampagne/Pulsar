import { PartialType } from '@nestjs/swagger';
import { RateStatus, RateType } from '@pulsar/shared';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';

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
