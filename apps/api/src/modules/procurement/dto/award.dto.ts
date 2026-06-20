import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AwardDto {
  @IsString()
  rfpLaneId!: string;

  @IsString()
  bidId!: string;

  @IsOptional()
  @IsBoolean()
  createRate?: boolean;
}
