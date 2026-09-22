import { PartialType } from '@nestjs/swagger';
import { LocationType } from '@pulsar/shared';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class CreateLocationDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 50)
  code!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 200)
  name!: string;

  @IsEnum(LocationType)
  type!: LocationType;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsString()
  @Length(1, 250)
  addressLine1!: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  addressLine2?: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 120)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @MaxLength(12)
  postalCode?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Length(2, 2)
  country?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;
}

export class UpdateLocationDto extends PartialType(CreateLocationDto, {
  skipNullProperties: false,
}) {
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

export class LocationsListQueryDto extends ListQueryDto {
  @IsOptional()
  @IsEnum(LocationType)
  type?: LocationType;
}
