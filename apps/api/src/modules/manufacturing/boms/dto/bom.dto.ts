import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateBomDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  productRef?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBomDto extends PartialType(CreateBomDto) {}

export class CreateBomLineDto {
  @IsString()
  materialRef!: string;

  @IsOptional()
  @IsString()
  materialName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  quantityPerUnit?: number;
}

export class UpdateBomLineDto extends PartialType(CreateBomLineDto) {}
