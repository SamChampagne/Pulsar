import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { YardDirection } from '@pulsar/shared';

export class CheckInDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsOptional() @IsString() trailerId?: string;
  @IsOptional() @IsString() trailerRef?: string;
  @IsOptional() @IsString() carrierId?: string;
  @IsOptional() @IsString() driverName?: string;
  @IsOptional() @IsEnum(YardDirection) direction?: YardDirection;
  @IsOptional() @IsString() spotId?: string; // optional immediate assignment
  @IsOptional() @IsString() appointmentId?: string; // optional fulfilled appointment
  @IsOptional() @IsString() notes?: string;
}

export class AssignSpotDto {
  @IsString() @MinLength(1) spotId!: string;
  @IsOptional() @IsString() note?: string;
}

export class VisitListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() spotId?: string;
}
