import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class DeskBackgroundDto {
  @IsIn(['color', 'gradient', 'image'])
  type!: string;

  @IsString()
  value!: string;
}

export class DeskLayoutDto {
  @IsInt()
  version!: number;

  @IsOptional()
  @IsIn(['auto', 'free', 'reorder'])
  mode?: string;

  @IsArray()
  items!: Record<string, unknown>[];

  @IsOptional()
  @IsIn(['sm', 'md', 'lg'])
  tileSize?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeskBackgroundDto)
  background?: DeskBackgroundDto;
}

export class AppearanceDto {
  @IsOptional()
  @IsIn(['warm', 'cool', 'dark'])
  theme?: string;

  @IsOptional()
  @IsHexColor()
  accent?: string;
}

export class UpdatePreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DeskLayoutDto)
  deskLayout?: DeskLayoutDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AppearanceDto)
  appearance?: AppearanceDto;

  @IsOptional()
  @IsDateString()
  releaseNotesSeenAt?: string;
}
