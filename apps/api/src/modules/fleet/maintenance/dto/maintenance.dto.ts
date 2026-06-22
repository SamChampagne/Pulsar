import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNumber, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { MaintenanceType } from '@pulsar/shared';

export class CreateMaintenanceOrderDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
  @IsEnum(MaintenanceType) type!: MaintenanceType;
  @IsString() @MinLength(1) description!: string;
  @IsOptional() @IsInt() odometerKm?: number;
  @IsOptional() @IsString() vendor?: string;
  @IsOptional() @IsDate() @Type(() => Date) dueDate?: Date;
  @IsOptional() @IsInt() dueOdometerKm?: number;
  @IsOptional() @IsObject() customData?: Record<string, unknown>;
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
