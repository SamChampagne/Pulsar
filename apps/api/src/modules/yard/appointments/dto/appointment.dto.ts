import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsObject, IsOptional, IsString, MinLength } from 'class-validator';
import { YardDirection } from '@pulsar/shared';

export class CreateAppointmentDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsOptional() @IsString() spotId?: string;
  @IsOptional() @IsString() carrierId?: string;
  @IsOptional() @IsEnum(YardDirection) direction?: YardDirection;
  @Type(() => Date) @IsDate() windowStart!: Date;
  @Type(() => Date) @IsDate() windowEnd!: Date;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsObject() customData?: Record<string, unknown>;
}

export class AppointmentListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() locationId?: string;
}
