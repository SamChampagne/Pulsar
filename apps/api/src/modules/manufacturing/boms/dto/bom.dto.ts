import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsDateString,
  Equals,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateBomDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  productRef?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BomVersionDto {
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;
}

export class PublishBomDto extends BomVersionDto {
  @Equals(true)
  acknowledgeUnits!: boolean;
}

export class UpdateBomDto extends PartialType(CreateBomDto) {
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;
}

export class CreateBomLineDto extends BomVersionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  materialRef!: string;

  @IsOptional()
  @IsString()
  materialName?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'number' && Number.isFinite(value) ? String(value) : value,
  )
  @Matches(/^\d{1,15}(\.\d{1,9})?$/)
  quantityPerUnit?: string;
}

export class UpdateBomLineDto extends PartialType(CreateBomLineDto) {}
