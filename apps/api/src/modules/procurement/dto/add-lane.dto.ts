import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

export class AddLaneDto {
  @IsUUID()
  laneId!: string;

  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsNumber()
  volumeEstimate?: number;
}
