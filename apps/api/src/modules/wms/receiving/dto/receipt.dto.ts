import { Type } from 'class-transformer';
import { IsNumber, IsObject, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateReceiptDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsObject() customData?: Record<string, unknown>;
}

export class UpdateReceiptDto {
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsObject() customData?: Record<string, unknown>;
}

export class AddReceiptLineDto {
  @IsString() @MinLength(1) itemId!: string;
  @IsString() @MinLength(1) toBinId!: string;
  @Type(() => Number) @IsNumber() @IsPositive() qty!: number;
}

export class ReceiptListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() locationId?: string;
}
