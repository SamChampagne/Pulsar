import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

export class DocumentCenterQueryDto {
  /** entityType filter (e.g. "bill-of-lading"). */
  @IsOptional()
  @IsString()
  category?: string;

  /** fileName contains (case-insensitive). */
  @IsOptional()
  @IsString()
  search?: string;

  /** createdAt >= from (ISO date). */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** createdAt <= to (ISO date). */
  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  /** Hide noisy desk-wallpaper documents (default true). */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value !== 'false' && value !== '0' : Boolean(value),
  )
  @IsBoolean()
  excludeWallpaper?: boolean;
}
