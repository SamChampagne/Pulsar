import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { TransportMode } from '@pulsar/shared';

export class AddLaneDto {
  @IsString()
  laneId!: string;

  @IsOptional()
  @IsEnum(TransportMode)
  mode?: TransportMode;

  @IsOptional()
  @IsNumber()
  volumeEstimate?: number;
}
