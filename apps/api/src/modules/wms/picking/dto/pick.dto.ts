import { Type } from 'class-transformer';
import { IsNumber, IsObject, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { WmsVersionDto } from '../../document-operations';

export class CreatePickOrderDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsOptional() @IsString() shipmentId?: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsObject() customData?: Record<string, unknown>;
}

export class AddPickLineDto extends WmsVersionDto {
  @IsOptional() @IsString() @MinLength(1) lotId?: string;
  @IsString() @MinLength(1) itemId!: string;
  @IsString() @MinLength(1) fromBinId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @IsPositive() qty!: number;
}

export class PickListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() shipmentId?: string;
}
