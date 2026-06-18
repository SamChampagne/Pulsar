import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, ValidateNested } from 'class-validator';

export class DeskLayoutDto {
  @IsInt()
  version!: number;

  @IsOptional()
  @IsIn(['auto', 'free', 'reorder'])
  mode?: string;

  @IsArray()
  items!: Record<string, unknown>[];
}

export class UpdatePreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DeskLayoutDto)
  deskLayout?: DeskLayoutDto;
}
