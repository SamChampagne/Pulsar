import { IsNumber, IsOptional, IsString } from 'class-validator';

export class AddLaneDto {
  @IsString()
  laneId!: string;

  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsNumber()
  volumeEstimate?: number;
}
