import { PartialType } from '@nestjs/swagger';
import { DriverStatus } from '@pulsar/shared';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateDriverDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  /** Omit for internal-fleet drivers. */
  @IsOptional()
  @IsString()
  carrierId?: string;

  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class UpdateDriverDto extends PartialType(CreateDriverDto) {
  @IsOptional()
  @IsEnum(DriverStatus)
  status?: DriverStatus;
}
