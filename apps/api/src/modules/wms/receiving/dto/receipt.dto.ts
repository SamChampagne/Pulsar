import { Type } from 'class-transformer';
import { IsNumber, IsObject, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';
import { WmsVersionDto } from '../../document-operations';

export class CreateReceiptDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsObject() customData?: Record<string, unknown>;
}

export class UpdateReceiptDto extends WmsVersionDto {
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsObject() customData?: Record<string, unknown>;
}

export class AddReceiptLineDto extends WmsVersionDto {
  @IsString() @MinLength(1) itemId!: string;
  @IsString() @MinLength(1) toBinId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @IsPositive() qty!: number;
}

export class ReceiptListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() locationId?: string;
}
