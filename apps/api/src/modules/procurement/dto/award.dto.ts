import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class AwardDto {
  @IsUUID()
  rfpLaneId!: string;

  @IsUUID()
  bidId!: string;

  @IsOptional()
  @IsBoolean()
  createRate?: boolean;
}
