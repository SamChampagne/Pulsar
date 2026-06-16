import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateReceiptDto {
  @IsString() @MinLength(1) locationId!: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() note?: string;
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
