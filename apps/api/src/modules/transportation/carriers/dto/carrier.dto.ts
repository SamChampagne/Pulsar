import { PartialType } from '@nestjs/swagger';
import { CarrierStatus } from '@pulsar/shared';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { IsContactPhone } from '../../../../common/validators/contact';

export class CreateCarrierDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 50)
  code!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{2,4}$/, { message: 'SCAC : 2 à 4 lettres.' })
  scacCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  mcNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  dotNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @IsContactPhone()
  @MaxLength(40)
  phone?: string;
}

export class UpdateCarrierDto extends PartialType(CreateCarrierDto, { skipNullProperties: false }) {
  @ValidateIf((_object, value) => value !== undefined)
  @IsEnum(CarrierStatus)
  status?: CarrierStatus;
}
