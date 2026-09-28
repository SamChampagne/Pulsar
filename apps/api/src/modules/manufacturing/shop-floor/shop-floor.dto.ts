import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';

export class ActualConsumptionDto {
  @ValidateIf((_, v) => v !== undefined) @IsString() @MinLength(1) @MaxLength(100) lotId?: string;
  @IsString() @MinLength(1) itemId!: string;
  @IsString() @MinLength(1) fromBinId!: string;
  @Matches(/^\d{1,9}(\.\d{1,3})?$/) quantity!: string;
}
export class ReverseDeclarationDto {
  @IsUUID() operationKey!: string;
  @IsDateString() expectedUpdatedAt!: string;
  @IsString() @Matches(/^[a-f0-9]{64}$/) reviewToken!: string;
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
export class ProductionDeclarationDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  outputLotId?: string;
  @IsUUID() operationKey!: string;
  @IsDateString() expectedUpdatedAt!: string;
  @IsInt() @Min(0) @Max(1000000000) goodQuantity!: number;
  @IsInt() @Min(0) @Max(1000000000) scrapQuantity!: number;
  @IsString() @MinLength(1) toBinId!: string;
  @IsString() @MinLength(3) @MaxLength(1000) note!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ActualConsumptionDto)
  consumptions!: ActualConsumptionDto[];
}
