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
  Min,
  Max,
  IsTimeZone,
} from 'class-validator';
import { TOUR_MODULE_KEYS, type TourModuleKey } from '@pulsar/shared';

export class ModuleTourDto {
  @IsIn(TOUR_MODULE_KEYS) moduleKey!: TourModuleKey;
  @IsIn([1, 2]) version!: number;
  @IsInt() @Min(0) @Max(11) step!: number;
  @IsIn(['IN_PROGRESS', 'COMPLETED', 'SKIPPED']) status!: 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
}

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
  @IsTimeZone()
  timeZone?: string | null;

  @IsOptional()
  @ValidateNested()
  @Type(() => ModuleTourDto)
  moduleTour?: ModuleTourDto;

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
