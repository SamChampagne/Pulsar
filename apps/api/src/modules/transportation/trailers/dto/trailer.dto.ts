import { PartialType } from '@nestjs/swagger';
import { AssetStatus, TrailerType } from '@pulsar/shared';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

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
  @IsString()
  plate?: string;
}

export class UpdateTrailerDto extends PartialType(CreateTrailerDto) {
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;
}
