import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CrmDealStage } from '@pulsar/shared';

export class CreatePipelineDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
}
export class PipelineColumnDto {
  @IsOptional() @IsString() @MinLength(1) id?: string;
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsEnum(CrmDealStage) kind!: CrmDealStage;
}
export class SavePipelineDto extends CreatePipelineDto {
  @IsInt() @Min(0) revision!: number;
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => PipelineColumnDto)
  stages!: PipelineColumnDto[];
}
