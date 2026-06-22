import { PartialType } from '@nestjs/swagger';
import { AssetStatus, TrailerType } from '@pulsar/shared';
import { IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateTrailerDto {
  @IsString()
  unitNumber!: string;

  @IsEnum(TrailerType)
  type!: TrailerType;

  @IsOptional()
  @IsString()
  carrierId?: string;

  @IsOptional()
  @IsNumber()
  capacityWeightKg?: number;

  @IsOptional()
  @IsNumber()
  capacityVolumeM3?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  capacityPallets?: number;

  @IsOptional()
  @IsString()
  plate?: string;

  @IsOptional()
  @IsObject()
  customData?: Record<string, unknown>;
}

export class UpdateTrailerDto extends PartialType(CreateTrailerDto) {
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;
}
