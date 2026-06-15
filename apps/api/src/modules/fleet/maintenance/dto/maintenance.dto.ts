import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { MaintenanceType } from '@pulsar/shared';

export class CreateMaintenanceOrderDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
  @IsEnum(MaintenanceType) type!: MaintenanceType;
  @IsString() @MinLength(1) description!: string;
  @IsOptional() @IsInt() odometerKm?: number;
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @Type(() => Date) dueDate?: Date;
  @IsOptional() @IsInt() dueOdometerKm?: number;
}

export class CompleteMaintenanceOrderDto {
  @IsOptional() @IsNumber() costAmount?: number;
  @IsOptional() @IsString() costCurrency?: string;
  @IsOptional() @IsInt() odometerKm?: number;
}

export class MaintenanceListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
}
