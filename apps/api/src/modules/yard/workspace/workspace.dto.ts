import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class WorkspaceQueryDto {
  @IsString() @Length(1, 100) locationId!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
}
class ShapeDto {
  @IsString() @Length(1, 80) id!: string;
  @IsIn(['BUILDING', 'AREA', 'GATE']) kind!: 'BUILDING' | 'AREA' | 'GATE';
  @IsString() @Length(1, 80) label!: string;
  @IsInt() @Min(0) @Max(63) x!: number;
  @IsInt() @Min(0) @Max(63) y!: number;
  @IsInt() @Min(1) @Max(64) width!: number;
  @IsInt() @Min(1) @Max(64) height!: number;
}
class PositionDto {
  @IsString() @Length(1, 100) id!: string;
  @IsOptional() @IsInt() @Min(0) @Max(63) posX!: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(63) posY!: number | null;
}
export class SaveYardPlanDto {
  @Matches(/^[a-f0-9]{64}$/) expectedVersion!: string;
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ShapeDto)
  shapes!: ShapeDto[];
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PositionDto)
  positions!: PositionDto[];
}
