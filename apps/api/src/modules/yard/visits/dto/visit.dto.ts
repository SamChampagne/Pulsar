import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { YardDirection } from '@pulsar/shared';

export class CheckInDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsOptional() @IsString() trailerId?: string;
  // Free text carried over from a YardArrival (unmatched trailer): same cap as
  // the arrival input it replaces.
  @IsOptional() @IsString() @MaxLength(100) trailerRef?: string;
  @IsOptional() @IsString() carrierId?: string;
  @IsOptional() @IsString() driverName?: string;
  @IsOptional() @IsEnum(YardDirection) direction?: YardDirection;
  @IsOptional() @IsString() spotId?: string; // optional immediate assignment
  @IsOptional() @IsString() appointmentId?: string; // optional fulfilled appointment
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsObject() customData?: Record<string, unknown>;
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
