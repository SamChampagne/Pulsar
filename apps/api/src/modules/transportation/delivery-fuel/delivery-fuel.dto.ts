import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsObject, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class FuelHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;
}
class FuelRevisionDto {
  @IsUUID('4') operationKey!: string;
  @IsInt() @Min(0) @Max(2147483646) expectedRevision!: number;
}
export class SaveFuelProfileDto extends FuelRevisionDto {
  @IsObject() profile!: Record<string, unknown>;
}
export class SaveFuelPriceDto extends FuelRevisionDto {
  @IsObject() price!: Record<string, unknown>;
}
export class SaveFuelActualDto extends FuelRevisionDto {
  @IsDateString({ strict: true }) expectedLoadUpdatedAt!: string;
  @IsDateString({ strict: true }) expectedRouteUpdatedAt!: string;
  @IsObject() actual!: Record<string, unknown>;
}
