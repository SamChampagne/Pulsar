import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class InventoryListQueryDto {
  @IsOptional() @IsString() itemId?: string;
  @IsOptional() @IsString() binId?: string;
  @IsOptional() @IsString() locationId?: string;
}

export class MoveStockDto {
  @IsString() @MinLength(1) itemId!: string;
  @IsString() @MinLength(1) fromBinId!: string;
  @IsString() @MinLength(1) toBinId!: string;
  @Type(() => Number) @IsNumber() @IsPositive() qty!: number;
  @IsOptional() @IsString() note?: string;
}

export class AdjustStockDto {
  @IsString() @MinLength(1) itemId!: string;
  @IsString() @MinLength(1) binId!: string;
  @Type(() => Number) @IsNumber() qtyDelta!: number; // signed, non-zero
  @IsOptional() @IsString() note?: string;
}
