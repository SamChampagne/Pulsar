import { Type } from 'class-transformer';
import {
  IsDate,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { MaintenanceType } from '@pulsar/shared';

export class CreateMaintenanceOrderDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
  @IsEnum(MaintenanceType) type!: MaintenanceType;
  @IsString() @MinLength(1) @MaxLength(2000) @Matches(/\S/) description!: string;
  @IsOptional() @IsInt() @Min(0) odometerKm?: number;
  @IsOptional() @IsString() @MaxLength(200) vendor?: string;
  @IsOptional() @IsDate() @Type(() => Date) dueDate?: Date;
  @IsOptional() @IsInt() @Min(0) dueOdometerKm?: number;
  @IsOptional() @IsObject() customData?: Record<string, unknown>;
}

export class MaintenanceVersionDto {
  @IsOptional() @IsDateString() expectedUpdatedAt?: string;
}
export class UpdateMaintenanceOrderDto extends MaintenanceVersionDto {
  @ValidateIf((_o, value) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  @Matches(/\S/)
  description?: string;
  @IsOptional() @IsString() @MaxLength(200) vendor?: string;
  @IsOptional() @IsDate() @Type(() => Date) dueDate?: Date | null;
}
export class CompleteMaintenanceOrderDto extends MaintenanceVersionDto {
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) costAmount?: number;
  @IsOptional() @Matches(/^[A-Z]{3}$/) costCurrency?: string;
  @IsOptional() @IsInt() @Min(0) odometerKm?: number;
}

export class MaintenanceListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() trailerId?: string;
}
