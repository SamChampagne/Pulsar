import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
export class WmsPageQuery {
  @IsOptional() @IsString() @Length(0, 80) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}
export class WmsWorkspaceQuery extends WmsPageQuery {
  @IsString() @Length(1, 100) locationId!: string;
}
export class WmsSitesQuery extends WmsPageQuery {
  @IsOptional() @IsString() @Length(0, 80) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 100;
}
