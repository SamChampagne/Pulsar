import { PartialType } from '@nestjs/swagger';
import { CarrierStatus } from '@pulsar/shared';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';

export class CreateCarrierDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  scacCode?: string;

  @IsOptional()
  @IsString()
  mcNumber?: string;

  @IsOptional()
  @IsString()
  dotNumber?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class UpdateCarrierDto extends PartialType(CreateCarrierDto) {
  @IsOptional()
  @IsEnum(CarrierStatus)
  status?: CarrierStatus;
}
