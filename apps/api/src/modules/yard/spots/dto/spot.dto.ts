import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { YardSpotType } from '@pulsar/shared';

export class CreateSpotDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsString() @MinLength(1) code!: string;
  @IsOptional() @IsEnum(YardSpotType) type?: YardSpotType;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() @Min(0) posX?: number;
  @IsOptional() @IsInt() @Min(0) posY?: number;
}

export class UpdateSpotDto extends PartialType(CreateSpotDto) {}

export class SpotListQueryDto {
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsEnum(YardSpotType) type?: YardSpotType;
}

export class LayoutPositionDto {
  @IsString() @MinLength(1) id!: string;
  @IsInt() @Min(0) posX!: number;
  @IsInt() @Min(0) posY!: number;
}

export class LayoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LayoutPositionDto)
  positions!: LayoutPositionDto[];
}
