import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { StockMovementType } from '@pulsar/shared';
import { ListQueryDto } from '../../../../common/dto/list-query.dto';

export class InventoryListQueryDto {
  @IsOptional() @IsString() itemId?: string;
  @IsOptional() @IsString() binId?: string;
  @IsOptional() @IsString() locationId?: string;
}

export class MoveStockDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) lotId?: string;
  @IsOptional() @IsUUID('4') operationKey?: string;
  @IsOptional() @IsString() @MinLength(1) locationId?: string;
  @IsString() @MinLength(1) itemId!: string;
  @IsString() @MinLength(1) fromBinId!: string;
  @IsString() @MinLength(1) toBinId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @IsPositive() qty!: number;
  @IsOptional() @IsString() note?: string;
}

export class MovementListQueryDto extends ListQueryDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) lotId?: string;
  @IsOptional() @IsString() @MaxLength(100) itemId?: string;
  @IsOptional() @IsString() @MaxLength(100) binId?: string;
  @IsOptional() @IsString() @MaxLength(100) locationId?: string;
  @IsOptional() @IsEnum(StockMovementType) type?: StockMovementType;
  @IsOptional() @IsString() @MaxLength(100) refId?: string;
  @IsOptional() @IsString() @MaxLength(30) refType?: string;
}

export class AdjustStockDto {
  @IsOptional() @IsUUID('4') operationKey?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) lotId?: string;
  @IsString() @MinLength(1) itemId!: string;
  @IsString() @MinLength(1) binId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) qtyDelta!: number; // signed, non-zero
  @IsOptional() @IsString() note?: string;
}
