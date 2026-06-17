import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateItemDto {
  @IsString() @MinLength(1) sku!: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsInt() @Min(0) reorderPoint?: number;
  @IsOptional() @IsInt() @Min(0) reorderQty?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateItemDto extends PartialType(CreateItemDto) {}
