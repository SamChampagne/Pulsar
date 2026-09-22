import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { IsContactPhone } from '../../../../common/validators/contact';
import { Transform } from 'class-transformer';

export class CreateCustomerDto {
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

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto, {
  skipNullProperties: false,
}) {
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}
