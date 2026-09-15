import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  IsDateString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { BinKind } from '@pulsar/shared';

export class CreateBinDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsString() @MinLength(1) code!: string;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || null : value))
  @IsString()
  @MaxLength(80)
  zone?: string | null;
  @IsOptional() @IsEnum(BinKind) kind?: BinKind;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateBinDto extends PartialType(CreateBinDto) {
  @IsOptional() @IsDateString() expectedUpdatedAt?: string;
}

export class BinListQueryDto {
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() search?: string;
}
