import { TrackingEventType } from '@pulsar/shared';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateTrackingEventDto {
  @IsEnum(TrackingEventType)
  type!: TrackingEventType;

  @IsOptional()
  @IsString()
  loadId?: string;

  @IsOptional()
  @IsString()
  shipmentId?: string;

  @IsOptional()
  @IsString()
  stopId?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class CreatePodDto {
  @IsString()
  shipmentId!: string;

  @IsOptional()
  @IsString()
  signedByName?: string;

  @IsOptional()
  @IsDateString()
  signedAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
