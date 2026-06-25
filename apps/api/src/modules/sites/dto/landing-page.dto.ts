import { ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { ListQueryDto } from '../../../common/dto/list-query.dto';

export class CreateLandingPageDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  content?: unknown[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  captureListId?: string;
}

export class UpdateLandingPageDto extends PartialType(CreateLandingPageDto) {}

export class LandingPageListQueryDto extends ListQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}
