import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateCycleCountDto {
  @IsString() binId!: string;
  @IsOptional() @IsString() note?: string;
}

export class CountLineDto {
  @IsString() lineId!: string;
  @IsNumber() @Min(0) countedQty!: number;
}

export class RecordCountsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CountLineDto)
  counts!: CountLineDto[];
}

export class CycleCountListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() binId?: string;
}
