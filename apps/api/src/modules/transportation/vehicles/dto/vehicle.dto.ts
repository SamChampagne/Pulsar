import { PartialType } from '@nestjs/swagger';
import { AssetStatus, VehicleType } from '@pulsar/shared';
import { IsEnum, IsInt, IsObject, IsOptional, IsString } from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  unitNumber!: string;

  @IsEnum(VehicleType)
  type!: VehicleType;

  @IsOptional()
  @IsString()
  carrierId?: string;

  @IsOptional()
  @IsString()
  make?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsInt()
  year?: number;

  @IsOptional()
  @IsString()
  vin?: string;

  @IsOptional()
  @IsString()
  plate?: string;

  @IsOptional()
  @IsObject()
  customData?: Record<string, unknown>;
}

export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {
  @IsOptional()
  @IsEnum(AssetStatus)
  status?: AssetStatus;
}
