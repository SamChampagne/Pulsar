import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { MaintenanceType } from '@pulsar/shared';

export class CreateMaintenanceScheduleDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsEnum(MaintenanceType) type?: MaintenanceType;
  @IsOptional() @IsInt() @Min(1) intervalDays?: number;
  @IsOptional() @IsInt() @Min(1) intervalKm?: number;
  @IsOptional() @IsInt() @Min(0) anchorOdometerKm?: number;
  @IsOptional() @IsInt() @Min(0) leadDays?: number;
}

export class UpdateMaintenanceScheduleDto extends PartialType(CreateMaintenanceScheduleDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ScheduleListQueryDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
}
