import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { FuelUnit } from '@pulsar/shared';

export class CreateOdometerReadingDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
  @IsInt() readingKm!: number;
  @IsOptional() @IsDate() @Type(() => Date) readAt?: Date;
  @IsOptional() @IsString() note?: string;
}

export class OdometerListQueryDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
}

export class CreateFuelLogDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
  @IsNumber() volume!: number;
  @IsEnum(FuelUnit) unit!: FuelUnit;
  @IsNumber() totalCost!: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsInt() odometerKm?: number;
  @IsOptional() @IsDate() @Type(() => Date) filledAt?: Date;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() note?: string;
}

export class FuelListQueryDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
}

export class CostReportQueryDto {
  @IsOptional() @IsDate() @Type(() => Date) from?: Date;
  @IsOptional() @IsDate() @Type(() => Date) to?: Date;
}
