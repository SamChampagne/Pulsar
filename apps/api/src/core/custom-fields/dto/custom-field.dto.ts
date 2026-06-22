import { CustomFieldEntity, CustomFieldType } from '@pulsar/shared';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class CustomFieldOptionDto {
  @IsString() value!: string;
  @IsString() label!: string;
}

export class CustomFieldDefinitionDto {
  @IsString() key!: string;
  @IsString() label!: string;
  @IsEnum(CustomFieldType) type!: CustomFieldType;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CustomFieldOptionDto)
  options?: CustomFieldOptionDto[];
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() showInList?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class ReplaceCustomFieldsDto {
  @IsEnum(CustomFieldEntity) entityType!: CustomFieldEntity;
  @IsArray() @ValidateNested({ each: true }) @Type(() => CustomFieldDefinitionDto)
  definitions!: CustomFieldDefinitionDto[];
}
