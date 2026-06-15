import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { YardSpotType } from '@pulsar/shared';

export class CreateSpotDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsString() @MinLength(1) code!: string;
  @IsOptional() @IsEnum(YardSpotType) type?: YardSpotType;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateSpotDto extends PartialType(CreateSpotDto) {}

export class SpotListQueryDto {
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsEnum(YardSpotType) type?: YardSpotType;
}
