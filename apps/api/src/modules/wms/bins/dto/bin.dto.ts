import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { BinKind } from '@pulsar/shared';

export class CreateBinDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsString() @MinLength(1) code!: string;
  @IsOptional() @IsEnum(BinKind) kind?: BinKind;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateBinDto extends PartialType(CreateBinDto) {}

export class BinListQueryDto {
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() search?: string;
}
