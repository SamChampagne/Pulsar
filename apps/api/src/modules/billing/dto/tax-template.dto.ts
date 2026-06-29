import { PartialType } from '@nestjs/swagger';
import { TaxTemplateType } from '@pulsar/shared';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Min, ValidateNested } from 'class-validator';

export class TaxTemplateLineDto {
  @IsString() @Length(1, 60) description!: string;
  @IsNumber() @Min(0) rate!: number;
  @IsString() @Matches(/^[0-9A-Z]{1,10}$/) accountCode!: string;
  @IsOptional() @IsInt() sortOrder?: number;
}
export class CreateTaxTemplateDto {
  @IsString() @Length(1, 80) name!: string;
  @IsEnum(TaxTemplateType) type!: TaxTemplateType;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => TaxTemplateLineDto) lines!: TaxTemplateLineDto[];
}
export class UpdateTaxTemplateDto extends PartialType(CreateTaxTemplateDto) {}
