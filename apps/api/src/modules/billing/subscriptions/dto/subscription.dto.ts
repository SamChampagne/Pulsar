import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/swagger';
import { SubscriptionInterval } from '@pulsar/shared';

export class SubscriptionLineDto {
  @IsString()
  @Length(1, 200)
  description!: string;

  @IsNumber()
  @Min(0)
  amount!: number;
}

export class CreateSubscriptionDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsString()
  customerId!: string;

  @IsEnum(SubscriptionInterval)
  interval!: SubscriptionInterval;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  nextRunDate?: string;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SubscriptionLineDto)
  lines!: SubscriptionLineDto[];
}

export class UpdateSubscriptionDto extends PartialType(CreateSubscriptionDto) {}
