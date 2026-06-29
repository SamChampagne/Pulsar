import { PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateRoutingDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  productRef?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateRoutingDto extends PartialType(CreateRoutingDto) {}

export class CreateRoutingStepDto {
  @IsInt()
  sequence!: number;

  @IsString()
  name!: string;

  @IsInt()
  @Min(1)
  durationMinutes!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  setupMinutes?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eligibleWorkCenterIds?: string[];
}

export class UpdateRoutingStepDto extends PartialType(CreateRoutingStepDto) {}
