import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  IsDateString,
} from 'class-validator';

export class CreateCycleCountDto {
  @IsString() binId!: string;
  @IsOptional() @IsString() note?: string;
}

export class CountLineDto {
  @IsString() lineId!: string;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) countedQty!: number;
}

export class CountActionDto {
  @IsOptional() @IsDateString() expectedUpdatedAt?: string;
}

export class RecordCountsDto extends CountActionDto {
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
