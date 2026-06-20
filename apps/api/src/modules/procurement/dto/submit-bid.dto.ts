import { IsDateString, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { RateType } from '@pulsar/shared';

export class SubmitBidDto {
  @IsString()
  rfpLaneId!: string;

  @IsEnum(RateType)
  rateType!: RateType;

  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  transitDays?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @IsOptional()
  @IsDateString()
  validTo?: string;
}
