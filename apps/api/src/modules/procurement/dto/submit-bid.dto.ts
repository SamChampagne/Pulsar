import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class SubmitBidDto {
  @IsString()
  rfpLaneId!: string;

  @IsString()
  rateType!: string;

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
