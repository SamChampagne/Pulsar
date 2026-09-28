import {
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CURRENCIES } from '@pulsar/shared';
export class BudgetLineDto {
  @IsString() @Matches(/^[0-9A-Z]{1,10}$/) accountCode!: string;
  @IsString() @Matches(/^-?\d{1,10}(\.\d{1,2})?$/) amount!: string;
}
export class BudgetContentDto {
  @IsUUID('4') operationKey!: string;
  @IsString() @Length(1, 80) name!: string;
  @IsBoolean() isActive!: boolean;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines!: BudgetLineDto[];
}
export class CreateBudgetDto extends BudgetContentDto {
  @IsInt() @Min(2000) @Max(2100) fiscalYear!: number;
  @IsIn(CURRENCIES.map((c) => c.code)) currency!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) periodFrom!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) periodTo!: string;
}
export class UpdateBudgetDto extends BudgetContentDto {
  @IsInt() @Min(1) expectedVersion!: number;
}
