import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, ValidateNested } from 'class-validator';

export class DeskLayoutDto {
  @IsInt()
  version!: number;

  @IsArray()
  items!: Record<string, unknown>[];
}

export class UpdatePreferencesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DeskLayoutDto)
  deskLayout?: DeskLayoutDto;
}
