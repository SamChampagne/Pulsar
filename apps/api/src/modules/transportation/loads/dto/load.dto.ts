import { IsOptional, IsString } from 'class-validator';

export class CreateLoadDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AssignLoadResourcesDto {
  @IsOptional()
  @IsString()
  carrierId?: string;

  @IsOptional()
  @IsString()
  driverId?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  trailerId?: string;

  @IsOptional()
  @IsString()
  rateId?: string;
}
